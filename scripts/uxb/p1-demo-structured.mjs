import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { applyViewport } from "./viewport.mjs";
import { ready } from "./trusted-keys.mjs";
import { readP1Style } from "./p1-style.mjs";
import { captureLiveStates } from "./p1-live-states.mjs";

// Read-only: an existing public trace's formatted output; no edit, error or write.
const [out] = process.argv.slice(2);
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank"), page = tab.page;
const url = "https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646/traces?peek=4c869ec4f5478358" +
  "&observation=4c869ec4f5478358&traceId=88aec2873588cb963b19a70c15f93036&timestamp=2026-11-11T01%3A07%3A35.374Z" +
  "&viewId=cmo6yrbti0006ad07v1r1xyva&orderBy=order-DESC_column-startTime";
const specimen = { component: "MarkdownViewer", state: "structured" };
const rows = [];
await mkdir(`${out}/demo-structured`, { recursive: true });
try {
  for (const theme of ["light", "dark"]) {
    await tabs.repin(tab, { width: 1440, height: 3200 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // Tall viewport so the whole document fits the peek panel without an inner scroll.
    await applyViewport(page, { width: 1440, height: 3200, deviceScaleFactor: 1, mobile: false, coarse: false });
    await ready(page, ".space-y-2 > h1");
    await page.evaluate(async theme => {
      // next-themes consumers (syntax highlighting) need the transient theme event as well as CSS classes.
      dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: theme, storageArea: localStorage }));
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.documentElement.classList.toggle("light", theme === "light");
      const sheet = document.createElement("style");
      sheet.textContent = '[data-sidebar="footer"]{display:none!important}';
      document.head.append(sheet);
      await document.fonts.ready;
      // The theme event re-renders the viewer; mark the settled node, not the replaced one.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const root = [...document.querySelectorAll(".space-y-2")].find(node =>
        node.querySelector(":scope > h1")?.textContent === "How Langfuse computes model cost");
      if (!root) throw new RangeError("Missing live structured Markdown");
      root.dataset.pr8Structured = "";
      for (const animation of document.getAnimations()) {
        if (typeof animation.currentTime !== "number") animation.pause();
        else if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish();
        else { animation.pause(); animation.currentTime = 0; }
      }
    }, theme);
    assert.equal(await page.evaluate(() => innerHeight), 3200, "tall viewport must apply");
    const footerHidden = await page.evaluate(() =>
      [...document.querySelectorAll('[data-sidebar="footer"]')].every(n => !n.checkVisibility()));
    assert.equal(footerHidden, true);
    const selector = "[data-pr8-structured]", file = `${out}/demo-structured/markdown-1440-${theme}.png`;
    const style = await readP1Style(page, selector, specimen);
    const geometry = await page.evaluate(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }, selector);
    const states = await captureLiveStates(page, { selector, file, specimen });
    console.log(`P1_DEMO_STRUCTURED ${theme} ${style.descendants.map(part => `${part.role}:${part.styles.length}`).join(" ")}`);
    rows.push({ component: "MarkdownViewer", state: "structured", theme, width: 1440, geometry, style, file, states,
      accountFooterHidden: footerHidden, provenance: "REAL-DEMO", url, selector });
  }
} finally {
  await writeFile(`${out}/demo-records-structured.json`, JSON.stringify(rows, null, 2));
  await tabs.closeAll(); await browser.close();
}
assert.equal(rows.length, 2);
