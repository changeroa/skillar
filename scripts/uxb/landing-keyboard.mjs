import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ready, arm, press, signal } from "./trusted-keys.mjs";
import { applyViewport } from "./viewport.mjs";

const [output, origin = "http://127.0.0.1:5186"] = process.argv.slice(2);
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank"), page = tab.page, results = [];
await mkdir(output, { recursive: true });
await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
try {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
    await page._sendToTarget("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await applyViewport(page, { width, height: width === 390 ? 844 : 900, mobile: width === 390, coarse: width === 390 });
    await ready(page, "#landing-actions:not([hidden])");
    const selectors = await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      const nodes = [...document.querySelectorAll("a[href],select")].filter(node => node.checkVisibility());
      nodes.forEach((node, index) => { node.dataset.qaTab = String(index); });
      const start = document.createElement("span"); start.tabIndex = 0; start.id = "qa-tab-start";
      document.body.prepend(start); start.focus();
      window.__landingTrustedKeys = [];
      document.addEventListener("keydown", event => window.__landingTrustedKeys.push({ key: event.key, trusted: event.isTrusted }));
      return nodes.map((node, index) => `[data-qa-tab="${index}"]`);
    }, theme);
    assert.equal(selectors.length, 14);
    const targets = [];
    for (const selector of selectors) {
      await arm(page, { kind: "focus", selector }); await press(page, "Tab"); await signal(page);
      const target = await page.evaluate(selector => {
        const node = document.querySelector(selector), css = getComputedStyle(node), box = node.getBoundingClientRect();
        return { selector, tag: node.tagName, label: node.getAttribute("aria-label") || node.textContent.trim(),
          href: node.getAttribute("href"), role: node.getAttribute("role"), focused: node.matches(":focus-visible"),
          width: box.width, height: box.height, outlineWidth: parseFloat(css.outlineWidth),
          outlineStyle: css.outlineStyle, outlineOffset: parseFloat(css.outlineOffset),
          migrated: node.matches(".lf-button,.lf-link") };
      }, selector);
      assert.equal(target.focused, true);
      assert.ok(target.label || target.tag === "SELECT");
      assert.equal(target.outlineWidth, 2);
      assert.equal(target.outlineStyle, "solid");
      assert.equal(target.outlineOffset, 2);
      if (target.migrated) assert.equal(target.height, width === 390 ? 44 : 32);
      if (target.tag === "A") assert.notEqual(target.role, "button", "Native destination semantics survive");
      targets.push(target);
    }
    await page.evaluate(() => document.querySelector("#qa-tab-start").remove());
    await page.evaluate(() => {
      window.__landingHash = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Native anchor did not navigate")), 5000);
        addEventListener("hashchange", () => { clearTimeout(timer); resolve(location.hash); }, { once: true });
      });
      document.querySelector("#landing-secondary").focus();
    });
    await press(page, "Enter");
    assert.equal(await page.evaluate(() => window.__landingHash), "#example");
    const structure = await page.evaluate(() => ({
      h1: document.querySelectorAll("h1").length, main: document.querySelectorAll("main").length,
      primary: document.querySelectorAll("#landing-actions .lf-button--primary").length,
      emailInMain: /fixture@example\.test/.test(document.querySelector("main").textContent),
      documentScrollOwner: document.scrollingElement === document.documentElement,
      overflowing: document.documentElement.scrollWidth > innerWidth,
      events: document.querySelectorAll(".trace-events > li").length,
      sections: [...document.querySelectorAll("main > section")].map(node => node.id || node.className),
      trustedKeys: window.__landingTrustedKeys,
    }));
    assert.equal(structure.h1, 1); assert.equal(structure.main, 1);
    assert.equal(structure.primary, 1); assert.equal(structure.emailInMain, false);
    assert.equal(structure.documentScrollOwner, true); assert.equal(structure.overflowing, false);
    assert.equal(structure.events, 3); assert.equal(structure.sections.length, 3);
    assert.ok(structure.trustedKeys.every(event => event.trusted));
    results.push({ width, theme, targets, nativeAnchorEnter: true, structure });
    console.log(`KEYBOARD ${width} ${theme} ${targets.length} native targets`);
  }
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
  await page._sendToTarget("Page.close"); await browser.close();
}
