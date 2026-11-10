import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { arm, press, ready, signal, typeahead } from "./trusted-keys.mjs";

const [site, local, output] = process.argv.slice(2);
if (!site || !local || !output || !process.env.OMOWRIGHT_HELPER)
  throw Error("Usage: OMOWRIGHT_HELPER=... node overlays-keyboard.mjs site local output");
const { loadOmowright } = await import(pathToFileURL(resolve(process.env.OMOWRIGHT_HELPER)).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank");
const page = tab.page, results = [], captures = [];
await mkdir(output, { recursive: true });
let checks = 0;
const verify = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
async function focus(selector) {
  await page.evaluate(selector => document.querySelector(selector).focus(), selector);
}
async function keyFocus(key, selector, modifiers = 0) {
  await arm(page, { kind: "focus", selector }); await press(page, key, modifiers); await signal(page);
}
async function open(trigger, selector) {
  await focus(trigger); await keyFocus("Enter", selector);
}
async function capture(id, selector) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const details = await page.evaluate(selector => {
    const element = document.querySelector(selector), s = getComputedStyle(element), r = element.getBoundingClientRect();
    return { selector, box: r.toJSON(), fontSize: s.fontSize, lineHeight: s.lineHeight,
      padding: s.padding, radius: s.borderRadius, borderColor: s.borderColor, color: s.color,
      background: s.backgroundColor, shadow: s.boxShadow, outline: s.outline,
      active: document.activeElement?.id, focusVisible: document.activeElement?.matches(":focus-visible"),
      viewport: [innerWidth, innerHeight], coarse: matchMedia("(pointer:coarse)").matches,
      overflow: document.documentElement.scrollWidth > innerWidth };
  }, selector);
  verify(details.box.width > 0 && details.box.height > 0, true);
  const frame = await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(output, `${id}.png`), Buffer.from(frame.data, "base64"));
  captures.push({ id, ...details });
}
try {
  for (const [app, url] of [["site", site], ["local", local]])
    for (const width of [1440, 390, 1920]) for (const theme of ["light", "dark"]) {
      const id = `${app}-${width}-${theme}`, before = checks;
      try {
        await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
        await page._sendToTarget("Emulation.setDeviceMetricsOverride", {
          width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390,
        });
        await page._sendToTarget("Emulation.setTouchEmulationEnabled", { enabled: width === 390 });
        await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
        await page._sendToTarget("Emulation.setEmulatedMedia", { features: [
          { name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" },
        ] });
        await page.goto(`${url}?theme=${theme}`, { waitUntil: "domcontentloaded" });
        await ready(page, "#open-dialog");
        await page._sendToTarget("Page.bringToFront");
        await page.evaluate(() => {
          window.__overlayKeys = [];
          document.addEventListener("keydown", e => window.__overlayKeys.push({ key: e.key, trusted: e.isTrusted }), true);
        });
        await capture(`${id}-rest`, "#overlays-gallery");
        const height = await page.evaluate(() => document.querySelector("#open-dialog").getBoundingClientRect().height);
        verify(height, width === 390 ? 44 : 32);
        verify(await page.evaluate(() => document.querySelector("#disabled-menu-trigger").disabled), true);
        // Given a closed menu, opening enters the first enabled item.
        await open("#standalone-menu-trigger", "#standalone-menu-alpha");
        await capture(`${id}-menu-focus`, "#standalone-menu");
        verify(await page.evaluate(() => getComputedStyle(document.querySelector("#standalone-menu-alpha")).minHeight), `${height}px`);
        await keyFocus("ArrowDown", "#standalone-menu-beta");
        await keyFocus("End", "#standalone-menu-delete");
        await keyFocus("Home", "#standalone-menu-alpha");
        await arm(page, { kind: "focus", selector: "#standalone-menu-beta" });
        await typeahead(page, "b", "KeyB", 66); await signal(page);
        await arm(page, { kind: "focus", selector: "#standalone-menu-bravo" });
        await typeahead(page, "b", "KeyB", 66); await signal(page);
        await capture(`${id}-menu-typeahead`, "#standalone-menu");
        await keyFocus("Escape", "#standalone-menu-trigger");
        verify(await page.evaluate(() => document.querySelector("#standalone-menu") === null), true);
        await focus("#standalone-menu-trigger");
        await keyFocus("ArrowUp", "#standalone-menu-delete");
        await keyFocus("Escape", "#standalone-menu-trigger");
        await open("#standalone-menu-trigger", "#standalone-menu-alpha");
        await arm(page, { kind: "text", selector: "#overlay-result", value: "Alpha" });
        await press(page, "Enter"); await signal(page);
        verify(await page.evaluate(() => document.activeElement.id), "standalone-menu-trigger");
        await open("#standalone-menu-trigger", "#standalone-menu-alpha");
        await keyFocus("Tab", "#empty-menu-trigger");
        // Dialog owns modality; inner Escape cannot dismiss its parent.
        await open("#open-dialog", "#dialog-name");
        verify(await page.evaluate(() => document.querySelector("#sample-dialog").matches(":modal")), true);
        await capture(`${id}-dialog`, "#sample-dialog");
        await focus("#dialog-done"); await keyFocus("Tab", "#sample-dialog .lf-overlay-close");
        await keyFocus("Tab", "#dialog-done", 8);
        await open("#nested-menu-trigger", "#nested-menu-alpha");
        await capture(`${id}-nested-menu`, "#nested-menu");
        await keyFocus("Escape", "#nested-menu-trigger");
        verify(await page.evaluate(() => document.querySelector("#sample-dialog").open), true);
        await open("#nested-confirm", "#sample-confirm-cancel");
        await capture(`${id}-confirm`, "#sample-confirm");
        verify(await page.evaluate(() => document.querySelector("#sample-confirm").getAttribute("role")), "alertdialog");
        await keyFocus("Escape", "#nested-confirm");
        verify(await page.evaluate(() => document.querySelector("#sample-dialog").open), true);
        await keyFocus("Escape", "#open-dialog");
        await open("#confirm-loading", "#sample-confirm-title");
        verify(await page.evaluate(() => document.querySelector("#sample-confirm-cancel").disabled), true);
        verify(await page.evaluate(() => document.querySelector('#sample-confirm [aria-busy="true"]').disabled), true);
        await capture(`${id}-confirm-loading`, "#sample-confirm");
        await press(page, "Escape");
        verify(await page.evaluate(() => document.querySelector("#sample-confirm").open), true);
        const beforeBusyReload = await page.evaluate(() => window.__overlayKeys);
        await page.goto(`${url}?theme=${theme}`, { waitUntil: "domcontentloaded" });
        await ready(page, "#open-dialog");
        await page.evaluate(() => {
          window.__overlayKeys = [];
          document.addEventListener("keydown", e => window.__overlayKeys.push({ key: e.key, trusted: e.isTrusted }), true);
        });
        await open("#confirm-error", "#sample-confirm-cancel");
        verify(await page.evaluate(() => Boolean(document.querySelector("#sample-confirm [role=alert]"))), true);
        await capture(`${id}-confirm-error`, "#sample-confirm");
        await keyFocus("Escape", "#confirm-error");
        await focus("#open-sheet");
        await arm(page, { kind: "attribute", selector: "#sample-sheet", attribute: "open", value: "" });
        await press(page, "Enter"); await signal(page);
        await capture(`${id}-sheet`, "#sample-sheet");
        await page.evaluate(() => {
          const body = document.querySelector("#sample-sheet .lf-dialog__body");
          body.scrollTop = body.scrollHeight;
        });
        await capture(`${id}-sheet-end`, "#sample-sheet");
        verify(await page.evaluate(() => {
          const head = document.querySelector("#sample-sheet .lf-dialog__head").getBoundingClientRect();
          const footer = document.querySelector("#sample-sheet .lf-dialog__actions").getBoundingClientRect();
          return head.top >= 0 && footer.bottom <= innerHeight;
        }), true);
        await keyFocus("Escape", "#open-sheet");
        await focus("#tooltip-trigger");
        await ready(page, "#sample-tooltip:popover-open");
        await capture(`${id}-tooltip`, "#sample-tooltip");
        verify(await page.evaluate(() => document.querySelector("#tooltip-trigger").getAttribute("aria-describedby")), "sample-tooltip");
        await press(page, "Escape");
        verify(await page.evaluate(() => document.querySelector("#sample-tooltip").matches(":popover-open")), false);
        const trusted = [...beforeBusyReload, ...await page.evaluate(() => window.__overlayKeys)];
        verify(trusted.length > 25 && trusted.every(e => e.trusted), true);
        const ax = await page._sendToTarget("Accessibility.getFullAXTree");
        await writeFile(join(output, `${id}-ax.json`), JSON.stringify(ax, null, 2));
        results.push({ id, pass: true, checks: checks - before, trustedKeys: trusted.length });
      } catch (error) {
        results.push({ id, pass: false, checks: checks - before, error: String(error) });
      }
    }
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ checks, results, captures }, null, 2));
  await tabs.close(tab); await browser.close();
}
console.log(JSON.stringify({ checks, cases: results.length, passed: results.filter(r => r.pass).length,
  failed: results.filter(r => !r.pass), captures: captures.length }));
if (results.some(r => !r.pass)) process.exitCode = 1;
