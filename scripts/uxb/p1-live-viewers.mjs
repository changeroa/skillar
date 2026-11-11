import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { applyViewport } from "./viewport.mjs";
import { ready } from "./trusted-keys.mjs";
import { captureLiveStates } from "./p1-live-states.mjs";
const [out] = process.argv.slice(2);
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser), { page } = await tabs.create("about:blank");
const origin = "https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646";
const trace = `${origin}/traces?peek=4c869ec4f5478358&observation=4c869ec4f5478358&traceId=88aec2873588cb963b19a70c15f93036&timestamp=2026-11-11T01%3A07%3A35.374Z`;
const previous = JSON.parse(await readFile(`${out}/demo-records.json`, "utf8"));
const rows = previous.filter(row => !["MarkdownViewer", "CodeBlock", "DiffViewer"].includes(row.component));
await mkdir(`${out}/demo`, { recursive: true });
async function prepare(theme) {
  await page.evaluate(async theme => {
    // next-themes consumers need the transient theme event as well as CSS classes.
    dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: theme, storageArea: localStorage }));
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    const style = document.createElement("style");
    style.textContent = '[data-sidebar="footer"]{display:none!important}';
    document.head.append(style);
    await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      if (typeof animation.currentTime !== "number") animation.pause();
      else if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish();
      else { animation.pause(); animation.currentTime = 0; }
    }
  }, theme);
}
async function capture(component, theme) {
  const selector = `[data-pr8-source="${component}"]`;
  const file = `${out}/demo/${component}-${theme}.png`;
  const states = await captureLiveStates(page, { selector, file,
    specimen: { component, state: component === "CodeBlock" ? "default" : component === "MarkdownViewer" ? "formatted" : "changed" } });
  const geometry = states.rest.style.geometry;
  assert.ok(geometry.width > 0 && geometry.height > 0);
  rows.push({ component, theme, width: 1440, viewportWidth: 1440, selector, file, states,
    style: states.rest.style, geometry, accountFooterHidden: true, provenance: "REAL-DEMO",
    url: await page.evaluate(() => location.href) });
  console.log(`P1_LIVE_VIEWER ${component} ${theme}`);
}
try {
  for (const theme of ["light", "dark"]) {
    await applyViewport(page, { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, coarse: false });
    await page.goto(trace, { waitUntil: "domcontentloaded" });
    await ready(page, '[role=dialog] [role=tab]');
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('[role=dialog] [role=tab]')].find(n => n.textContent === "Formatted");
      if (!tab) throw new RangeError("Missing read-only Formatted tab");
      tab.dataset.pr8Formatted = "";
    });
    await page.click("[data-pr8-formatted]");
    await ready(page, ".codeblock");
    await prepare(theme);
    await page.evaluate(() => {
      const code = [...document.querySelectorAll(".codeblock")].find(n => n.checkVisibility() && n.textContent.includes("from langfuse import get_client"));
      const markdown = [...document.querySelectorAll('[role=dialog] .space-y-2')].find(n =>
        n.checkVisibility() && n.textContent === "how does langfuse compute the model cost - so - kubecon");
      if (!code || !markdown) throw new RangeError("Original public cost-question viewers are missing");
      code.dataset.pr8Source = "CodeBlock"; markdown.dataset.pr8Source = "MarkdownViewer";
    });
    await capture("CodeBlock", theme); await capture("MarkdownViewer", theme);
    await page.goto(`${origin}/prompts/answer%20question`, { waitUntil: "domcontentloaded" });
    await ready(page, 'button[aria-label="Compare with selected prompt"]:not(:disabled)');
    await page.click('button[aria-label="Compare with selected prompt"]');
    await ready(page, '[role=dialog] .rounded-lg.border');
    await prepare(theme);
    await page.evaluate(() => {
      const node = [...document.querySelectorAll('[role=dialog] .rounded-lg.border')].find(n =>
        n.checkVisibility() && n.textContent.includes("Answer the following questions:"));
      if (!node) throw new RangeError("Missing read-only prompt comparison");
      node.dataset.pr8Source = "DiffViewer";
    });
    await capture("DiffViewer", theme);
  }
  await writeFile(`${out}/demo-records.json`, JSON.stringify(rows, null, 2));
} finally { await tabs.closeAll(); await browser.close(); }
assert.equal(rows.filter(row => row.states).length, 6);
