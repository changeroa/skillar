import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { applyViewport } from "./viewport.mjs";
import { ready } from "./trusted-keys.mjs";
import { readP1Style } from "./p1-style.mjs";
import { captureP1 } from "./p1-capture.mjs";
import { captureLiveStates } from "./p1-live-states.mjs";

const [out] = process.argv.slice(2);
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank"), page = tab.page;
const rows = [];
await mkdir(`${out}/demo-matched`, { recursive: true });
try {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page.goto("https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646",
      { waitUntil: "domcontentloaded" });
    await applyViewport(page, { width, height: width === 390 ? 844 : 900,
      deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390, coarse: width === 390 });
    await ready(page, "tbody tr");
    await page.evaluate(async theme => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.documentElement.classList.toggle("light", theme === "light");
      const sheet = document.createElement("style");
      sheet.textContent = '[data-sidebar="footer"]{display:none!important}';
      document.head.append(sheet);
      await document.fonts.ready;
      const button = [...document.querySelectorAll("main button")].find(n => /Past \d+ day/.test(n.textContent));
      if (!button) throw new RangeError("Missing live period control");
      button.dataset.pr8Period = "";
      for (const animation of document.getAnimations()) {
        if (typeof animation.currentTime !== "number") animation.pause();
        else if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish();
        else { animation.pause(); animation.currentTime = 0; }
      }
    }, theme);
    const footerHidden = await page.evaluate(() =>
      [...document.querySelectorAll('[data-sidebar="footer"]')].every(n => !n.checkVisibility()));
    assert.equal(footerHidden, true);
    const selector = "[data-pr8-period]", file = `${out}/demo-matched/period-${width}-${theme}.png`;
    const style = await readP1Style(page, selector);
    const geometry = await page.evaluate(selector => {
      const node = document.querySelector(selector), rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, text: node.textContent };
    }, selector);
    const capture = await captureP1(page, selector, file);
    const states = await captureLiveStates(page, { selector, file });
    rows.push({ component: "TimePeriodSelect", state: "default", theme, width, geometry,
      style, file, capture, states, accountFooterHidden: footerHidden, provenance: "REAL-DEMO",
      url: await page.evaluate(() => location.href), selector });
  }
} finally {
  await writeFile(`${out}/demo-records-matched.json`, JSON.stringify(rows, null, 2));
  await tabs.closeAll(); await browser.close();
}
console.log(`P1_REFERENCE_REFRESH ${rows.length}/4`);
assert.equal(rows.length, 4);
