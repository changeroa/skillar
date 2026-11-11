import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ready, press, arm, signal } from "./trusted-keys.mjs";
import { applyViewport } from "./viewport.mjs";
import { captureCrop, diffImages } from "./image-diff.mjs";
import { measureHostedStyle, demoHostedStyle, metricFields } from "./hosted-control-style.mjs";
import { assertLandingControl } from "./landing-control-contract.mjs";
import { paintedFocus } from "./focus-paint.mjs";
import { inspectReferenceImage } from "./reference-pixels.mjs";

const [output, primaryPath, controlsPath, origin = "http://127.0.0.1:5185"] = process.argv.slice(2);
const primary = JSON.parse(await readFile(primaryPath, "utf8"));
const controls = JSON.parse(await readFile(controlsPath, "utf8"));
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank");
const page = tab.page, results = [], focus = [], mutations = [];
await mkdir(output, { recursive: true });
await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
try {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
    await applyViewport(page, { width, height: width === 390 ? 844 : 900, mobile: width === 390, coarse: width === 390 });
    await page._sendToTarget("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await applyViewport(page, { width, height: width === 390 ? 844 : 900, mobile: width === 390, coarse: width === 390 });
    await ready(page, "#landing-actions:not([hidden])");
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const targets = await page.evaluate(() => [...document.querySelectorAll(".lf-button,.lf-link")].map((node, index) => {
      node.dataset.landingQa = String(index);
      return { selector: `[data-landing-qa="${index}"]`,
        onMuted: Boolean(node.closest(".docs-links")),
        control: node.id === "landing-primary" ? "primary" : node.id === "landing-secondary" ? "outline" : "link" };
    }));
    assert.equal(targets.length, 11, "Every migrated landing consumer must be covered");
    for (const [index, target] of targets.entries()) for (const state of ["default", "hover", "active", "focus-visible"]) {
      const id = `${width}-${theme}-${index}-${state}`;
      const policy = { id, width, theme, state, control: target.control, onMuted: target.onMuted };
      const sourceState = width === 390 && (state === "hover" || (state === "active" && target.control !== "primary")) ? "default" : state;
      if (target.control === "primary") policy.primaryFill = await page.evaluate(({ theme, state }) => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const brand = theme === "light" ? "#B4321C" : "#FF8F70";
        const alpha = state === "active" ? 80 : state === "hover" ? 90 : 100;
        const probe = document.createElement("span");
        probe.style.backgroundColor = `color-mix(in oklab, ${brand} ${alpha}%, transparent)`;
        document.body.append(probe);
        ctx.fillStyle = getComputedStyle(probe).backgroundColor;
        probe.remove();
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      }, { theme, state: sourceState });
      const source = target.control === "primary" ? primary.find(row => row.theme === theme && row.state === sourceState) :
        controls.find(row => row.theme === theme && row.id === (target.control === "outline" ?
          `01-button-${sourceState}` : `link-docs-${sourceState === "active" ? "hover" : sourceState}`));
      assert.ok(source, `${id}: real Demo state is required`);
      assert.equal((await inspectReferenceImage(page, source)).pass, true);
      const reference = source.reference ?? await demoHostedStyle(page, { ...source,
        styles: { ...source.styles, height: `${source.bounds.height}px` } });
      const selector = target.selector;
      await page.evaluate(selector => {
        document.activeElement?.blur();
        document.querySelector(selector).scrollIntoView({ block: "center", behavior: "instant" });
      }, selector);
      await page.mouse.move(width - 1, 1);
      if (state === "focus-visible") {
        await page.evaluate(selector => {
          const node = document.querySelector(selector), origin = document.createElement("span");
          origin.tabIndex = 0; origin.dataset.qaFocusOrigin = "true"; node.before(origin); origin.focus();
        }, selector);
        await arm(page, { kind: "focus", selector }); await press(page, "Tab"); await signal(page);
        await page.evaluate(() => document.querySelector("[data-qa-focus-origin]").remove());
      }
      if (["hover", "active"].includes(state)) {
        const box = await page.evaluate(selector => document.querySelector(selector).getBoundingClientRect().toJSON(), selector);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      }
      if (state === "active") await page.mouse.down();
      try {
        const actual = await measureHostedStyle(page, target);
        assertLandingControl(actual, reference, policy);
        const file = join(output, `${id}.png`);
        const crop = await captureCrop(page, selector, { align: false });
        await writeFile(file, Buffer.from(crop.data, "base64"));
        const pixels = await diffImages(page, { reference: source.path, actual: file,
          sideBySide: join(output, `${id}-side.png`), diff: join(output, `${id}-diff.png`) });
        results.push({ id, ...target, state, width, theme, source: source.path, actual, reference,
          fields: metricFields.length, pixels, pass: true });
        const css = state === "focus-visible" ? "outline:none!important;box-shadow:none!important" :
          state === "default" ? "height:60px!important" : "padding-left:60px!important";
        const original = await page.evaluate(({ selector, css }) => {
          const node = document.querySelector(selector), original = node.getAttribute("style");
          node.style.cssText += `;${css}`; return original;
        }, { selector, css });
        const mutated = await measureHostedStyle(page, target);
        assert.throws(() => assertLandingControl(mutated, reference, policy), `${id}: mutation must fail`);
        await page.evaluate(({ selector, original }) => {
          const node = document.querySelector(selector);
          if (original === null) node.removeAttribute("style"); else node.setAttribute("style", original);
        }, { selector, original });
        assertLandingControl(await measureHostedStyle(page, target), reference, policy);
        mutations.push({ id, css, rejected: true, restored: true });
        if (state === "focus-visible") {
          const painted = await paintedFocus(page, selector, join(output, `${id}-paint`));
          assert.equal(painted.pass, true, `${id}: contrasting painted focus`);
          await page.evaluate(selector => document.querySelector(selector).style.setProperty("outline", "none", "important"), selector);
          const removed = await paintedFocus(page, selector);
          assert.equal(removed.pass, false, `${id}: invisible focus must fail`);
          await page.evaluate(selector => document.querySelector(selector).style.removeProperty("outline"), selector);
          focus.push({ id, painted, removed });
        }
        console.log(`CONTROL ${id}`);
      } finally {
        if (state === "active") { await page.mouse.move(width - 1, 1); await page.mouse.up(); }
      }
    }
  }
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ results, mutations, focus }, null, 2));
  await page._sendToTarget("Page.close"); await browser.close();
}
assert.equal(results.length, 176);
console.log(`CONTROLS_COMPLETE ${results.length} cases ${focus.length} painted-focus probes`);
