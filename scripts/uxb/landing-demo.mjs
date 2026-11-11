import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ready, press, arm, signal } from "./trusted-keys.mjs";
import { captureCrop } from "./image-diff.mjs";
import { measureHostedStyle } from "./hosted-control-style.mjs";
import { inspectReferenceImage } from "./reference-pixels.mjs";

const [output] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank", { viewport: { width: 1440, height: 900 } });
const page = tab.page, records = [];
const selector = 'a[href="https://langfuse.com/docs/demo"]';
try {
  await page.goto("https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646/traces",
    { waitUntil: "domcontentloaded" });
  await ready(page, selector);
  await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
  for (const theme of ["light", "dark"]) for (const state of ["default", "hover", "active", "focus-visible"]) {
    await page._sendToTarget("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    await page.evaluate(({ theme, selector }) => {
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(theme);
      document.documentElement.style.colorScheme = theme;
      for (const footer of document.querySelectorAll('[data-sidebar="footer"]')) footer.style.visibility = "hidden";
      document.activeElement?.blur();
      document.querySelector(selector).scrollIntoView({ block: "center", behavior: "instant" });
    }, { theme, selector });
    await page.mouse.move(1000, 1);
    if (state === "focus-visible") {
      await page.evaluate(selector => {
        const node = document.querySelector(selector);
        const items = [...document.querySelectorAll("a[href],button,input,select,[tabindex]")]
          .filter(item => item.tabIndex >= 0 && !item.disabled && item.checkVisibility());
        const previous = items[items.indexOf(node) - 1];
        if (!previous) throw Error("No real preceding tab stop");
        previous.focus();
      }, selector);
      await arm(page, { kind: "focus", selector });
      await press(page, "Tab"); await signal(page);
    }
    if (["hover", "active"].includes(state)) {
      const box = await page.evaluate(selector => document.querySelector(selector).getBoundingClientRect().toJSON(), selector);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }
    if (state === "active") await page.mouse.down();
    try {
      await page.evaluate(async selector => {
        await Promise.all(document.querySelector(selector).getAnimations({ subtree: true })
          .filter(animation => animation.effect.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, selector);
      const context = await page.evaluate(selector => ({
        url: location.href, html: document.querySelector(selector).outerHTML,
        accountFooterHidden: [...document.querySelectorAll('[data-sidebar="footer"]')]
          .every(footer => getComputedStyle(footer).visibility === "hidden"),
        active: document.querySelector(selector).matches(":active"),
        hover: document.querySelector(selector).matches(":hover"),
      }), selector);
      assert.equal(context.accountFooterHidden, true);
      assert.equal(context.active, state === "active");
      assert.equal(context.hover, ["hover", "active"].includes(state));
      const reference = await measureHostedStyle(page, { selector });
      assert.equal(reference.focusVisible, state === "focus-visible");
      const path = join(output, `primary-${theme}-${state}.png`);
      const crop = await captureCrop(page, selector, { align: false });
      await writeFile(path, Buffer.from(crop.data, "base64"));
      const acceptance = await inspectReferenceImage(page, { control: "Button", path });
      assert.equal(acceptance.pass, true);
      records.push({ id: `primary-${theme}-${state}`, control: "Button", theme, state,
        path, reference, ...context, acceptance, provenance: "REAL-DEMO",
        capturedAt: new Date().toISOString() });
      console.log(`DEMO ${theme} ${state}`);
    } finally {
      if (state === "active") { await page.mouse.move(1000, 1); await page.mouse.up(); }
    }
  }
} finally {
  await writeFile(join(output, "records.json"), JSON.stringify(records, null, 2));
  await page._sendToTarget("Page.close"); await browser.close();
}
