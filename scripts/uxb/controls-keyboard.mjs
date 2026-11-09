import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { arm, press, ready, signal, typeahead } from "./trusted-keys.mjs";

const [site, local, output] = process.argv.slice(2);
if (!site || !local || !output || !process.env.OMOWRIGHT_HELPER)
  throw Error("Usage: OMOWRIGHT_HELPER=... node controls-keyboard.mjs site local output");
const { loadOmowright } = await import(pathToFileURL(resolve(process.env.OMOWRIGHT_HELPER)).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank");
const page = tab.page, results = [];
await mkdir(output, { recursive: true });
const target = (id, child = "button") => `[data-specimen="${id}"] ${child}`;

async function focus(selector) {
  await page.evaluate(selector => document.querySelector(selector).focus(), selector);
  await press(page, "Tab", 8);
  await arm(page, { kind: "focus", selector });
  await press(page, "Tab");
  await signal(page);
}

async function eventSignal(selector, event) {
  await page.evaluate(({ selector, event }) => {
    window.__controlEvent = new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      const done = e => { clearTimeout(timer); resolve({ trusted: e.isTrusted, checked: element.checked, value: element.value }); };
      const timer = setTimeout(() => { element.removeEventListener(event, done); reject(Error(`Missing ${event}`)); }, 8000);
      element.addEventListener(event, done, { once: true });
    });
  }, { selector, event });
}

try {
  for (const [app, url] of [["site", site], ["local", local]]) for (const theme of ["light", "dark"]) {
    await tabs.repin(tab, { width: 1440, height: 900 });
    await page.goto(`${url}?theme=${theme}`, { waitUntil: "domcontentloaded" });
    await page._sendToTarget("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page._sendToTarget("Emulation.setTouchEmulationEnabled", { enabled: false });
    await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
    await ready(page, '[data-specimen="button-primary"] button');
    await page._sendToTarget("Page.bringToFront");
    await page.evaluate(() => {
      window.__controlKeys = [];
      document.addEventListener("keydown", e => window.__controlKeys.push({ key: e.key, trusted: e.isTrusted }), true);
    });
    await focus(target("button-primary"));
    await arm(page, { kind: "text", selector: "#controls-result", value: "확인 1회 / 검색: 아직 없음 / 항목: a" });
    await press(page, "Enter"); await signal(page);
    await arm(page, { kind: "text", selector: "#controls-result", value: "확인 2회 / 검색: 아직 없음 / 항목: a" });
    await press(page, " "); await signal(page);
    await focus(target("button-small"));
    await arm(page, { kind: "focus", selector: target("button-selected") });
    await press(page, "Tab"); await signal(page);
    const checkbox = target("checkbox-unchecked", "input");
    await focus(checkbox);
    await eventSignal(checkbox, "change");
    await press(page, " ");
    assert.deepEqual(await page.evaluate(() => window.__controlEvent), { trusted: true, checked: true, value: "on" });
    const mixed = target("checkbox-mixed", "input");
    await focus(mixed);
    const axMixed = await page._sendToTarget("Accessibility.getFullAXTree");
    assert.ok(axMixed.nodes.some(node => node.role?.value === "checkbox" && node.properties?.some(p => p.name === "checked" && p.value.value === "mixed")));
    await eventSignal(mixed, "change");
    await press(page, " ");
    assert.equal((await page.evaluate(() => window.__controlEvent)).trusted, true);
    assert.equal(await page.evaluate(selector => document.querySelector(selector).indeterminate, mixed), false);
    const select = target("select-default", "select");
    await focus(select);
    await eventSignal(select, "change");
    await typeahead(page, "b", "KeyB", 66);
    assert.equal((await page.evaluate(() => window.__controlEvent)).value, "b");
    await press(page, "Escape");
    assert.equal(await page.evaluate(selector => document.activeElement === document.querySelector(selector), select), true);
    const search = target("search-default", "input");
    await focus(search);
    await arm(page, { kind: "text", selector: "#controls-result", value: "확인 2회 / 검색: skillar / 항목: b" });
    await press(page, "Enter"); await signal(page);
    await arm(page, { kind: "focus", selector: target("search-default", 'button[aria-label$="지우기"]') });
    await press(page, "Tab"); await signal(page);
    await arm(page, { kind: "focus", selector: search });
    await press(page, "Enter"); await signal(page);
    assert.equal(await page.evaluate(selector => document.querySelector(selector).value, search), "");
    await page._sendToTarget("Browser.grantPermissions", { origin: new URL(url).origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    await focus(target("copy-default"));
    await arm(page, { kind: "attribute", selector: target("copy-default"), attribute: "aria-label", value: "ID 복사됨" });
    await press(page, "Enter"); await signal(page);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "skillar-original-value");
    const ax = await page._sendToTarget("Accessibility.getFullAXTree");
    const controls = ax.nodes.filter(node => !node.ignored && ["button", "textbox", "searchbox", "combobox", "checkbox", "link"].includes(node.role?.value));
    assert.ok(controls.length >= 45 && controls.every(node => node.name?.value?.trim()));
    const keys = await page.evaluate(() => window.__controlKeys);
    assert.ok(keys.length > 20 && keys.every(key => key.trusted));
    await writeFile(join(output, `${app}-${theme}-ax.json`), JSON.stringify(ax, null, 2));
    results.push({ app, theme, pass: true, checks: ["trusted Enter/Space", "disabled skipped", "native mixed checkbox", "native select typeahead/Escape", "search submit/clear/focus", "clipboard readback", "named AX controls"], keys: keys.length });
    for (const width of [390, 1440]) {
      await page._sendToTarget("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390 });
      await page._sendToTarget("Emulation.setTouchEmulationEnabled", { enabled: true });
      const geometry = await page.evaluate(() => {
        const root = document.querySelector("#basic-controls");
        const selectors = [".lf-button", ".lf-icon-button", ".lf-input-wrap", ".lf-select", ".lf-search", ".lf-checkbox", "button.lf-badge", ".lf-tag:has(button)", ".lf-link"];
        return selectors.flatMap(selector => [...root.querySelectorAll(selector)].map(node => ({ selector, height: node.getBoundingClientRect().height })));
      });
      assert.ok(geometry.every(item => item.height >= 44), JSON.stringify(geometry.filter(item => item.height < 44)));
      results.push({ app, theme, width, coarse: true, pass: true, geometry });
    }
    console.log(`PASS controls ${app} ${theme}`);
  }
} catch (error) {
  if (!(error instanceof Error)) throw error;
  results.push({ pass: false, error: error.stack });
  throw error;
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
  await tabs.closeAll(); await browser.close();
}
