import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { arm, press, ready, signal } from "./trusted-keys.mjs";
import { nativeDialogs } from "./native-dialogs.mjs";

const [site, output] = process.argv.slice(2);
if (!site || !output || !process.env.OMOWRIGHT_HELPER)
  throw Error("Usage: OMOWRIGHT_HELPER=... node peek-keyboard.mjs site output");
const { loadOmowright } = await import(pathToFileURL(resolve(process.env.OMOWRIGHT_HELPER)).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank"), page = tab.page;
const dialogs = await nativeDialogs(page);
const sessionId = await page.resolveSessionId(), requests = [], results = [], measurements = [];
const offRequests = page.cdp.on("Network.requestWillBeSent", (event, meta) => {
  if (meta.sessionId !== sessionId || !event.request.url.startsWith(new URL(site).origin + "/api/")) return;
  requests.push({ method: event.request.method, path: new URL(event.request.url).pathname });
});
await page._sendToTarget("Network.enable");
await mkdir(output, { recursive: true });
let checks = 0, focusTokens;
const verify = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
function ring(control, label) {
  verify(control.outlineWidth, focusTokens.width, `${label}:outlineWidth`);
  verify(control.outlineStyle, "solid", `${label}:outlineStyle`);
  verify(control.outlineColor, focusTokens.color, `${label}:outlineColor`);
  verify(control.outlineOffset, focusTokens.offset, `${label}:outlineOffset`);
}
async function focus(selector) {
  await page.evaluate(selector => {
    const node = document.querySelector(selector);
    if (!node) throw Error(`Missing focus target ${selector}`);
    node.focus();
  }, selector);
}
async function keyFocus(key, selector, modifiers = 0) {
  await arm(page, { kind: "focus", selector });
  await press(page, key, modifiers);
  await signal(page);
}
async function activate(selector, condition) {
  await focus(selector);
  await arm(page, condition);
  await press(page, "Enter");
  await signal(page);
}
async function size(id, stage, selector, expectedHeight) {
  const controls = await page.evaluate(selector => [...document.querySelectorAll(selector)]
    .filter(node => node.checkVisibility() && !node.matches('input[type="checkbox"],input[type="radio"]'))
    .map(node => {
      const style = getComputedStyle(node);
      return { tag: node.tagName, id: node.id, class: node.className,
        role: node.getAttribute("role"), height: node.getBoundingClientRect().height,
        fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily, appearance: style.appearance,
        outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor, outlineOffset: style.outlineOffset,
        boxShadow: style.boxShadow, focusVisible: node.matches(":focus-visible") };
    }), selector);
  measurements.push({ id, stage, expectedHeight, controls });
  verify(controls.length > 0, true, `${stage}:controls-present`);
  for (const control of controls) {
    const label = `${stage}:${control.id || control.class || control.tag}`;
    verify(control.height, expectedHeight, `${label}:height`);
    verify(control.fontSize, "13px", `${label}:fontSize`);
    // Chromium's native menulist reports normal even with a declared 20px line
    // height. Assert that native value, not a custom appearance replacement.
    verify(control.lineHeight, control.tag === "SELECT" ? "normal" : "20px", `${label}:lineHeight`);
    if (control.focusVisible) ring(control, label);
  }
}
async function capture(id, stage) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: join(output, `${id}-${stage}.png`) });
}
async function openEditor() {
  await focus("#skill-detail-tab-versions");
  await keyFocus("ArrowLeft", "#skill-detail-tab-document");
  verify(await page.evaluate(() => new URL(location.href).searchParams.get("tab")), "document");
  await ready(page, "#edit-skill-document");
  await activate("#skill-peek .skill-editor-disclosure > summary",
    { kind: "attribute", selector: "#skill-peek .skill-editor-disclosure", attribute: "open", value: "" });
}
async function dirty(marker) {
  await focus("#edit-skill-document");
  await page.evaluate(() => {
    const node = document.querySelector("#edit-skill-document");
    node.setSelectionRange(node.value.length, node.value.length);
  });
  await arm(page, { kind: "attribute", selector: "form.publish > p.note[role=status]", attribute: "role", value: "status" });
  await page._sendToTarget("Input.insertText", { text: marker });
  await signal(page);
  return page.evaluate(() => document.querySelector("#edit-skill-document").value);
}

try {
  for (const theme of ["light", "dark"])
    for (const [width, height, pointer] of [[1440, 900, "mouse"], [1440, 900, "touch"], [390, 844, "touch"]]) {
      const id = `${theme}-${width}-${pointer}`, before = checks, native = [];
      try {
        await tabs.repin(tab, { width, height });
        await page._sendToTarget("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width === 390 });
        await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
        await page._sendToTarget("Emulation.setTouchEmulationEnabled", { enabled: pointer === "touch" });
        await page.goto(new URL("/skills/", site).href, { waitUntil: "domcontentloaded" });
        await ready(page, "[id^=skill-row-]");
        await page.evaluate(theme => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.classList.toggle("dark", theme === "dark");
          document.documentElement.style.colorScheme = theme;
          window.__realPeekEvents = [];
          for (const type of ["keydown", "input"])
            document.addEventListener(type, event => window.__realPeekEvents.push({
              type, key: event.key ?? null, target: event.target.id, trusted: event.isTrusted,
            }), true);
        }, theme);
        focusTokens = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement), probe = document.createElement("span");
          probe.style.color = "var(--lf-primary-accent)"; probe.hidden = true;
          document.documentElement.append(probe);
          const color = getComputedStyle(probe).color; probe.remove();
          return { width: root.getPropertyValue("--lf-focus-width").trim(),
            offset: root.getPropertyValue("--lf-focus-offset").trim(), color };
        });
        const row = await page.evaluate(() => document.querySelector("[id^=skill-row-]").id);
        const rowSelector = `#${row}`, selected = row.slice("skill-row-".length);
        const expectedHeight = pointer === "touch" ? 44 : 32;
        verify(await page.evaluate(() => matchMedia("(pointer:coarse)").matches), pointer === "touch");
        await focus(rowSelector);
        await keyFocus("Enter", "#skill-peek > header > button");
        await ready(page, "#skill-peek .version");
        const initial = await page.evaluate(() => ({
          selected: new URL(location.href).searchParams.get("skill"),
          tab: new URL(location.href).searchParams.get("tab"),
          modal: document.querySelector("#skill-peek").matches(":modal"),
          labelled: Boolean(document.getElementById(document.querySelector("#skill-peek").getAttribute("aria-labelledby"))),
        }));
        verify(initial, { selected, tab: "versions", modal: width < 1024, labelled: true });
        await size(id, "versions", "#skill-peek button,#skill-peek a.button,#skill-peek summary,.skills-version-label select", expectedHeight);
        await capture(id, "versions");

        if (width < 1024) {
          await page.evaluate(() => {
            const nodes = [...document.querySelectorAll("#skill-peek button,#skill-peek a[href],#skill-peek input,#skill-peek select,#skill-peek textarea,#skill-peek summary,#skill-peek [tabindex='0']")]
              .filter(node => node.tabIndex >= 0 && !node.disabled && node.checkVisibility());
            nodes[0].dataset.qaPeekEdge = "first";
            nodes.at(-1).dataset.qaPeekEdge = "last";
          });
          await focus("[data-qa-peek-edge=last]");
          await keyFocus("Tab", "[data-qa-peek-edge=first]");
          await keyFocus("Tab", "[data-qa-peek-edge=last]", 8);
          verify(await page.evaluate(() => document.querySelector("#skill-peek").contains(document.activeElement)), true);
        }
        await activate("#skill-peek .version__actions > summary",
          { kind: "attribute", selector: "#skill-peek .version__actions", attribute: "open", value: "" });
        await size(id, "version-actions", "#skill-peek .version__actions[open] > summary,#skill-peek .version__actions[open] .button", expectedHeight);
        await capture(id, "version-actions");
        await activate("#skill-peek .version__actions > summary",
          { kind: "attribute", selector: "#skill-peek .version__actions", attribute: "open", value: null });

        await openEditor();
        await size(id, "editor", "#skill-peek #skill-detail-panel-document button,#skill-peek #skill-detail-panel-document input,#skill-peek #skill-detail-panel-document select,#skill-peek .skill-editor-disclosure > summary", expectedHeight);
        verify(await page.evaluate(() => {
          const style = getComputedStyle(document.querySelector("#edit-skill-document"));
          return [style.fontSize, style.lineHeight];
        }), ["13px", "20px"]);
        const baseline = await page.evaluate(() => document.querySelector("#edit-skill-document").value);
        const draft = await dirty("\nOwned QA unsaved draft");
        const focused = await page.evaluate(() => {
          const node = document.activeElement, style = getComputedStyle(node);
          return { focusVisible: node.matches(":focus-visible"), outlineWidth: style.outlineWidth,
            outlineStyle: style.outlineStyle, outlineColor: style.outlineColor, outlineOffset: style.outlineOffset };
        });
        verify(focused.focusVisible, true);
        ring(focused, "dirty-textarea");
        await capture(id, "dirty-draft");
        const dirtyUrl = await page.evaluate(() => location.href);
        await focus("#skill-peek > header > button");
        native.push(await dialogs.confirm(false, () => press(page, "Enter")));
        verify(await page.evaluate(() => ({
          url: location.href, open: Boolean(document.querySelector("#skill-peek[open]")),
          draft: document.querySelector("#edit-skill-document").value,
        })), { url: dirtyUrl, open: true, draft });
        await arm(page, { kind: "focus", selector: rowSelector });
        native.push(await dialogs.confirm(true, () => press(page, "Escape")));
        await signal(page);
        verify(await page.evaluate(() => ({
          selected: new URL(location.href).searchParams.get("skill"),
          open: Boolean(document.querySelector("#skill-peek[open]")), focus: document.activeElement.id,
        })), { selected: null, open: false, focus: row });

        await focus(rowSelector);
        await keyFocus("Enter", "#skill-peek > header > button");
        await ready(page, "#skill-peek .version");
        await openEditor();
        verify(await page.evaluate(() => document.querySelector("#edit-skill-document").value), baseline);
        const fullDraft = await dirty("\nOwned QA full-page draft");
        const fullHref = await page.evaluate(() => document.querySelector("#skill-peek > header > a").href);
        await activate("#skill-peek > header > a",
          { kind: "attribute", selector: ".skills-list-workspace", attribute: "hidden", value: "" });
        verify(await page.evaluate(() => ({
          url: location.href, full: Boolean(document.querySelector(".skill--full")),
          peek: Boolean(document.querySelector("#skill-peek")),
          draft: document.querySelector("#edit-skill-document").value,
        })), { url: fullHref, full: true, peek: false, draft: fullDraft });
        await focus(".skill--full .skill-title-row > button");
        native.push(await dialogs.confirm(false, () => press(page, "Enter")));
        verify(await page.evaluate(() => ({
          url: location.href, draft: document.querySelector("#edit-skill-document").value,
        })), { url: fullHref, draft: fullDraft });
        await arm(page, { kind: "attribute", selector: rowSelector, attribute: "data-selected", value: null });
        native.push(await dialogs.confirm(true, () => press(page, "Enter")));
        await signal(page);
        verify(await page.evaluate(() => new URL(location.href).searchParams.get("skill")), null);
        verify(native, [false, true, false, true].map(accepted => ({ type: "confirm", accepted })));
        const events = await page.evaluate(() => window.__realPeekEvents);
        verify(events.length > 12 && events.every(event => event.trusted), true);
        verify(events.filter(event => event.type === "input").length >= 2, true);
        results.push({ id, pass: true, checks: checks - before, native, trustedEvents: events.length });
      } catch (error) {
        results.push({ id, pass: false, checks: checks - before, native, error: String(error) });
      }
    }
  verify(requests.every(request => ["GET", "HEAD", "OPTIONS"].includes(request.method)), true);
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ checks, results, measurements, requests,
    nativeExemptions: [{ property: "SELECT.lineHeight", expected: "normal",
      reason: "Chromium native appearance owns line-height; 13px font and 32/44px box remain asserted." }] }, null, 2));
  offRequests();
  await dialogs.close();
  await tabs.close(tab);
  await browser.close();
}
console.log(JSON.stringify({ checks, cases: results.length, passed: results.filter(result => result.pass).length,
  failed: results.filter(result => !result.pass), nativeConfirmations: results.reduce((sum, result) => sum + result.native.length, 0) }));
if (results.some(result => !result.pass)) process.exitCode = 1;
