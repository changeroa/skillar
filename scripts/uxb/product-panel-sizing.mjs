import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { arm, press, ready, signal } from "./trusted-keys.mjs";

const [site, local, output] = process.argv.slice(2);
if (!site || !local || !output || !process.env.OMOWRIGHT_HELPER)
  throw Error("Usage: OMOWRIGHT_HELPER=... node product-panel-sizing.mjs site local output");
const { loadOmowright } = await import(pathToFileURL(resolve(process.env.OMOWRIGHT_HELPER)).href);
await mkdir(output, { recursive: true });
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank"), page = tab.page, results = [], measurements = [];
let checks = 0;
const cases = [
  { id: "hosted-peek", url: new URL("/skills/?sort=updated&order=desc&density=compact", site).href, opener: "tbody tr:nth-child(2)", panel: ".ui-peek", kind: "native" },
  { id: "embedded-peek", url: new URL("/dashboard/#/sessions", site).href, opener: ".rowlink", panel: ".session-peek", kind: "aside" },
  { id: "local-peek", url: new URL("/#/sessions", local).href, opener: ".rowlink", panel: ".session-peek", kind: "aside" },
];
async function capture(name, panel) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  const details = await page.evaluate(selector => {
    const panel = document.querySelector(selector), style = getComputedStyle(panel);
    return { box: panel.getBoundingClientRect().toJSON(), color: style.color, background: style.backgroundColor,
      fontSize: style.fontSize, overflow: document.documentElement.scrollWidth > innerWidth,
      viewport: innerWidth, coarse: matchMedia("(pointer:coarse)").matches,
      controls: [...panel.querySelectorAll('button,a.button,a.pe-button,a.lf-button,a.tab,[role="button"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],input:not([type="checkbox"],[type="radio"]),select,summary')].filter(e => e.checkVisibility()).map(e => ({
        text: e.innerText, id: e.id, classes: e.className, square: e.matches(".pe-icon-button,.lf-icon-button,[aria-busy=true]") || e.tagName === "BUTTON" && !e.textContent.trim(), height: e.getBoundingClientRect().height, width: e.getBoundingClientRect().width,
      })) };
  }, panel);
  const target = details.coarse || details.viewport <= 768 ? 44 : 32;
  for (const control of details.controls) {
    const label = `${name}: ${control.id || control.text || control.classes}`;
    assert.equal(control.height, target, `${label}: owner control height`); checks++;
    assert.equal(control.square ? control.width === target : control.width >= target, true, `${label}: owner control width`); checks++;
  }
  measurements.push({ id: name, target, ...details });
  const shot = await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(output, `${name}.png`), Buffer.from(shot.data, "base64"));
  return details;
}
try {
  for (const target of cases) for (const [width, coarse] of [[1440, false], [1440, true], [390, false], [390, true]])
    for (const theme of ["light", "dark"]) {
      const variant = "after";
      const id = `${target.id}-${width}-${coarse ? "coarse" : "fine"}-${theme}`;
      try {
        await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
        await page._sendToTarget("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390 });
        await page._sendToTarget("Emulation.setTouchEmulationEnabled", { enabled: coarse });
        await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
        await page._sendToTarget("Emulation.setEmulatedMedia", { features: [
          { name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" },
        ] });
        await page._sendToTarget("Network.setCookie", { name: "__qa_pr0_build", value: variant, url: target.url });
        await page.goto("about:blank", { waitUntil: "domcontentloaded" });
        await page.goto(target.url, { waitUntil: "domcontentloaded" });
        await page._sendToTarget("Emulation.setTouchEmulationEnabled", { enabled: coarse });
        assert.equal(await page.evaluate(() => matchMedia("(pointer:coarse)").matches), coarse, "actual input mode"); checks++;
        if (target.id === "embedded-peek") {
          await ready(page, ".dash-source-picker summary");
          await page.click(".dash-source-picker summary");
          await ready(page, ".source-list button");
          await arm(page, { kind: "attribute", selector: ".rowlink", attribute: "class", value: "rowlink" });
          await page.click(".source-list button"); await signal(page);
        }
        await ready(page, target.opener);
        await page._sendToTarget("Page.bringToFront");
        await page.evaluate(selector => document.querySelector(selector).focus(), target.opener);
        const original = await page.evaluate(() => location.href);
        await arm(page, target.kind === "native"
          ? { kind: "attribute", selector: target.panel, attribute: "open", value: "" }
          : { kind: "attribute", selector: target.panel, attribute: "role", value: "dialog" });
        await press(page, "Enter"); await signal(page);
        const selected = await page.evaluate(() => location.href);
        assert.notEqual(selected, original, "Peek selection is reflected in the URL");
        await ready(page, `${target.panel} button`);
        await ready(page, target.kind === "native" ? "#skill-detail-tab-versions" : `${target.panel} .trace-summary`);
        const details = await capture(id, target.panel);
        await page.evaluate(selector => {
          const body = document.querySelector(`${selector} .ui-peek-body,${selector} .session-peek__body`);
          if (body) body.scrollTop = body.scrollHeight;
        }, target.panel);
        await capture(`${id}-end`, target.panel);
        await arm(page, { kind: "focus", selector: target.opener }); await press(page, "Escape"); await signal(page);
        assert.equal(await page.evaluate(() => location.href), original, "Closing clears selection without dropping filters");
        let sheet;
        if (width === 390 && target.kind === "aside") {
          await page.evaluate(() => document.querySelector(".session-facets-toggle").focus());
          await arm(page, { kind: "attribute", selector: "#session-filter-sheet", attribute: "role", value: "dialog" });
          await press(page, "Enter"); await signal(page);
          sheet = await capture(`${id}-console-sheet`, "#session-filter-sheet");
          await page.evaluate(() => {
            const body = document.querySelector("#session-filter-sheet .pe-sheet__body");
            body.scrollTop = body.scrollHeight;
          });
          await capture(`${id}-console-sheet-end`, "#session-filter-sheet");
          await page.evaluate(() => {
            const nodes = [...document.querySelectorAll("#session-filter-sheet button:not([disabled]),#session-filter-sheet select:not([disabled]),#session-filter-sheet input:not([disabled])")]
              .filter(e => e.checkVisibility());
            nodes.at(-1).focus();
          });
          await arm(page, { kind: "focus", selector: "#session-filter-sheet header button" });
          await press(page, "Tab"); await signal(page);
          await arm(page, { kind: "focus", selector: ".session-facets-toggle" }); await press(page, "Escape"); await signal(page);
          // Hosted embeds intentionally omit LocalShell's source drawer; their parent owns source selection.
          if (target.id === "local-peek") {
            await page.evaluate(() => document.querySelector(".pe-source-toggle").focus());
            await arm(page, { kind: "attribute", selector: "#pe-source-drawer", attribute: "role", value: "dialog" });
            await press(page, "Enter"); await signal(page);
            await capture(`${id}-source-drawer`, "#pe-source-drawer");
            await page.evaluate(() => {
              const body = document.querySelector("#pe-source-drawer .pe-sheet__body");
              body.scrollTop = body.scrollHeight;
            });
            await capture(`${id}-source-drawer-end`, "#pe-source-drawer");
            await arm(page, { kind: "focus", selector: ".pe-source-toggle" }); await press(page, "Escape"); await signal(page);
          }
        }
        results.push({ id, pass: true, original, selected, details, sheet });
      } catch (error) { results.push({ id, pass: false, error: String(error) }); }
    }
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ checks, results, measurements }, null, 2));
  await tabs.close(tab); await browser.close();
}
console.log(JSON.stringify({ checks, cases: results.length, passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass) }));
if (results.some(r => !r.pass)) process.exitCode = 1;
