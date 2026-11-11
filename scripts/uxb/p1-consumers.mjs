import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { applyViewport } from "./viewport.mjs";
import { arm, ready, signal } from "./trusted-keys.mjs";
import { mountHostedEmbed } from "./mount-hosted-embed.mjs";
const [out] = process.argv.slice(2);
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank"), { page } = tab;
const rows = [];
const fixtures = JSON.parse(await readFile(new URL("../../local/dashboard/dev-fixtures.json", import.meta.url), "utf8"));
const localSession = Object.keys(fixtures.traces).find(id => fixtures.traces[id].length > 0);
assert.ok(localSession, "Existing local fixture must contain trace events");
await mkdir(`${out}/consumers`, { recursive: true });
async function capture(name, surface, width, theme) {
  const metrics = await page.evaluate(() => ({
    width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
    periods: [...document.querySelectorAll(".lf-time-period select")].map(n => n.getBoundingClientRect().height),
    code: document.querySelectorAll(".lf-codeblock").length,
    sourceText: [...document.querySelectorAll(".lf-codeblock pre")].map(n => n.textContent.length),
  }));
  assert.equal(metrics.width, width);
  assert.equal(metrics.overflow, false);
  for (const height of metrics.periods) assert.equal(height, width === 390 ? 44 : 32);
  const file = `${out}/consumers/${surface}-${name}-${width}-${theme}.png`;
  const image = await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(file, Buffer.from(image.data, "base64"));
  rows.push({ name, surface, width, theme, metrics, file, status: "PASS" });
}
try {
  for (const surface of ["local", "hosted"]) for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    try {
      await page.goto(surface === "local" ? "http://localhost:5182/?fixtures=1#/sessions" : "http://localhost:5181/dashboard/",
        { waitUntil: "domcontentloaded" });
      await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
      await applyViewport(page, { width, height: width === 390 ? 844 : 900,
        deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390, coarse: width === 390 });
      if (surface === "hosted") await mountHostedEmbed(page);
      await ready(page, ".pe-sessions-region [data-session-id]");
      await page.evaluate(async theme => {
        document.documentElement.dataset.theme = theme;
        await document.fonts.ready;
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 0; }
      }, theme);
      await capture("sessions", surface, width, theme);
      const session = surface === "local" ? localSession
        : await page.evaluate(() => document.querySelector("[data-session-id]").dataset.sessionId);
      await page.evaluate(session => { location.hash = `#/sessions/${session}`; }, session);
      await ready(page, ".trace-event-row");
      await capture("trace", surface, width, theme);
      await arm(page, { kind: "present", selector: ".event-inspector:not([hidden])" });
      await page.click(".trace-event-row"); await signal(page);
      await arm(page, { kind: "attribute", selector: ".event-inspector:not([hidden]) [role=tab][id$=attributes-tab]", attribute: "aria-selected", value: "true" });
      await page.click(".event-inspector:not([hidden]) [role=tab][id$=attributes-tab]");
      await signal(page);
      await ready(page, ".event-attributes .lf-codeblock");
      await capture("attributes", surface, width, theme);
    } catch (error) { rows.push({ surface, width, theme, status: "FAIL", error: String(error) }); }
    console.log(`P1_CONSUMERS ${surface} ${width} ${theme}`);
  }
} finally {
  await writeFile(`${out}/consumers.json`, JSON.stringify(rows, null, 2));
  await tabs.closeAll(); await browser.close();
}
console.log(`P1_CONSUMERS_RESULT ${rows.filter(row => row.status === "PASS").length}/${rows.length} PASS`);
process.exitCode = rows.some(row => row.status !== "PASS") ? 1 : 0;
