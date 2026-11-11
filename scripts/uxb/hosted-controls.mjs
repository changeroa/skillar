import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { ready, press } from "./trusted-keys.mjs";
import { applyViewport } from "./viewport.mjs";
import { focusPaint, proveFocusMutation } from "./table-keyboard.mjs";
import { captureCrop } from "./image-diff.mjs";
import { measureHostedStyle, demoHostedStyle, hostedDemoRecord, expectedHostedStyle, assertHostedStyle, metricFields } from "./hosted-control-style.mjs";
import { inspectReferenceImage } from "./reference-pixels.mjs";

const [base, reference, out, demoFile, freshFile] = process.argv.slice(2);
if (!base || !reference || !out || !demoFile || !freshFile || [base, reference].some(url => !["localhost", "127.0.0.1"].includes(new URL(url).hostname)))
  throw Error("Usage: hosted-controls.mjs localhost-app localhost-pinned-reference output-directory pr1-demo-records.json hosted-demo-records.json");
const demoRecords = JSON.parse(await readFile(demoFile, "utf8"));
const freshRecords = JSON.parse(await readFile(freshFile, "utf8"));
if (!process.env.OMOWRIGHT_HELPER) throw Error("OMOWRIGHT_HELPER required");
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const nativeTab = await tabs.create("about:blank"), sourceTab = await tabs.create("about:blank");
const page = nativeTab.page, sourcePage = sourceTab.page;
const specs = [
  ...["primary", "secondary", "danger", "danger-quiet"].flatMap(control => ["default", "hover", "active", "focus-visible"].map(state => ({ control, state }))),
  { control: "disabled", state: "disabled" },
  ...["input", "select", "summary"].flatMap(control => ["default", "hover", "focus-visible"].map(state => ({ control, state }))),
  ...["unchecked", "checked", "focus-visible"].map(state => ({ control: "checkbox", state })),
  { control: "checkbox", state: "focus-visible", checked: true, caseName: "focus-visible-checked" },
  ...["panel", "status", "skeleton"].map(control => ({ control, state: "default" })),
];
function sourceTarget(spec) {
  const button = { primary: "primary", secondary: "outline", danger: "destructive", "danger-quiet": "outline",
    disabled: "disabled", summary: "secondary" }[spec.control];
  if (button) return { selector: `[data-specimen="button-${button}"] .sample > button`, recipe: `Button/${button}` };
  if (spec.control === "input") return { selector: '[data-specimen="input-default"] input', recipe: "Input/plain" };
  if (spec.control === "select") return { selector: '[data-specimen="select-default"] [role="combobox"]', recipe: "SelectInput/default" };
  if (spec.control === "checkbox") return { selector: `[data-specimen="${spec.state === "checked" || spec.checked ? "checkbox-small" : "hosted-checkbox-unchecked"}"] [role="checkbox"]`, recipe: "Checkbox/sm, the actual live-Demo caller variant" };
  if (spec.control === "panel") return { selector: '[data-specimen="hosted-panel"] .sample > div',
    paddingSelector: '[data-specimen="hosted-panel"] .sample > div > div', recipe: "Card + CardHeader" };
  if (spec.control === "status") return { selector: '[data-specimen="hosted-status"] [role="alert"]', recipe: "Alert/sm, identical one-line content" };
  assert.equal(spec.control, "skeleton");
  return { selector: '[data-specimen="skeleton-default"] .skeleton-stack > div', recipe: "Skeleton/h-4" };
}
async function prepare(targetPage, selector, spec) {
  await targetPage.evaluate(({ selector, state }) => {
    document.activeElement?.blur();
    const node = document.querySelector(selector);
    node.scrollIntoView({ block: "center", behavior: "instant" });
    if (node.type === "checkbox") node.checked = state === "checked";
  }, { selector, state: spec.checked ? "checked" : spec.state });
  await targetPage.mouse.move(0, 0);
  if (spec.state === "focus-visible") {
    await press(targetPage, "Tab");
    await targetPage.evaluate(selector => document.querySelector(selector).focus(), selector);
  }
  if (["hover", "active"].includes(spec.state)) {
    const point = await targetPage.evaluate(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, selector);
    await targetPage.mouse.move(point.x, point.y);
    if (spec.state === "active") await targetPage.mouse.down();
  }
}
async function probe(selector, expected, property, id) {
  const original = await page.evaluate(selector => document.querySelector(selector).getAttribute("style"), selector);
  try {
    const value = expected[property] + (property === "paddingLeft" ? 4 : 2);
    await page.evaluate(({ selector, property, value }) => { document.querySelector(selector).style[property] = `${value}px`; },
      { selector, property, value });
    const mutated = await measureHostedStyle(page, { selector });
    assert.equal(mutated[property], value, `${id}: mutation must apply`);
    assert.throws(() => assertHostedStyle(mutated, expected, `${id}: ${property} mutation`), error =>
      error instanceof assert.AssertionError && Array.isArray(error.actual) && error.actual.some(row => row.property === property));
    return { property, measured: value, rejected: true };
  } finally {
    await page.evaluate(({ selector, original }) => {
      const node = document.querySelector(selector);
      if (original === null) node.removeAttribute("style"); else node.setAttribute("style", original);
    }, { selector, original });
    assertHostedStyle(await measureHostedStyle(page, { selector }), expected, `${id}: restored`);
  }
}
const records = [], failures = [];
await mkdir(out, { recursive: true });
try {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    for (const [tab, url, selector] of [[nativeTab, `${base}/__gallery.html?hostedNative=1`, "#hosted-native-gallery:not([hidden])"],
      [sourceTab, `${reference}/?theme=${theme}`, '[data-specimen="hosted-panel"]']]) {
      await tab.page.goto(url, { waitUntil: "domcontentloaded" });
      await ready(tab.page, selector);
      await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
      await applyViewport(tab.page, { width, height: width === 390 ? 844 : 900, mobile: width === 390, coarse: width === 390 });
      await tab.page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
      await tab.page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        const style = document.createElement("style");
        style.textContent = "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}";
        document.head.append(style);
      }, theme);
      await tab.page.evaluate(() => document.fonts.ready);
    }
    const tokens = await sourcePage.evaluate(() => {
      const result = {}, canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      for (const name of ["primary-accent", "destructive"]) {
        if (!getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()) throw Error(`Missing pinned token ${name}`);
        const probe = document.createElement("span"); probe.style.color = `hsl(var(--${name}))`; document.body.append(probe);
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = getComputedStyle(probe).color; ctx.fillRect(0, 0, 1, 1);
        result[name] = [...ctx.getImageData(0, 0, 1, 1).data]; probe.remove();
      }
      return result;
    });
    for (const spec of specs) {
      const id = `${spec.control}-${spec.caseName ?? spec.state}-${theme}-${width}`, selector = `#native-${spec.control}`, target = sourceTarget(spec);
      const row = { id, ...spec, width, theme };
      try {
        const demo = hostedDemoRecord({ ...spec, width, theme }, demoRecords, freshRecords);
        if (demo) {
          assert.equal(demo.accountFooterHidden, true, `${id}: source account footer hidden`);
          const acceptance = await inspectReferenceImage(sourcePage, demo);
          assert.equal(acceptance.pass, true, `${id}: nonblank real reference`);
          row.reference = demo.reference ?? await demoHostedStyle(sourcePage, demo);
          row.source = { recipe: target.recipe, provenance: "REAL-DEMO", url: demo.url, path: demo.path,
            liveDemo: { id: demo.id, url: demo.url, path: demo.path, acceptance, requiredMetricConcordance: true } };
          if (spec.control === "checkbox" && spec.state === "focus-visible" && !spec.checked)
            row.source.liveDemo.condition = "Live unchecked paint with the exact owner keyboard-focus override; no pinned style substitutes for Demo fields.";
          await copyFile(demo.path, `${out}/${id}-source.png`);
        } else {
          assert.equal(spec.control, "status", `${id}: no standing-rule exception; real Demo evidence required`);
          await prepare(sourcePage, target.selector, spec);
          row.reference = await measureHostedStyle(sourcePage, target);
          row.source = { ...target, url: reference,
            provenance: "ACTUAL-PINNED-MIT 69181812b87169df157841fce1314ec96ecd2c5a",
            exception: "Alert/sm: /skills exposes default/default Alerts with no size selector; exact per-case routes in GATE-STATUS.md" };
          await writeFile(`${out}/${id}-source.png`, Buffer.from((await captureCrop(sourcePage, target.selector, { align: false })).data, "base64"));
        }
        assert.equal(row.reference.disabled, spec.control === "disabled", `${id}: source disabled state`);
        if (spec.control === "checkbox") assert.equal(row.reference.checked, spec.state === "checked" || Boolean(spec.checked), `${id}: source checked state`);
      } finally { if (spec.state === "active") await sourcePage.mouse.up(); }
      try {
        await prepare(page, selector, spec);
        const policy = { ...spec, width, interactive: !["panel", "status", "skeleton"].includes(spec.control),
          accent: tokens["primary-accent"], destructive: tokens.destructive };
        Object.assign(row, expectedHostedStyle(row.reference, policy));
        row.actual = await measureHostedStyle(page, { selector });
        assertHostedStyle(row.actual, row.expected, id);
        row.styleStatus = "PASS";
        row.mutations = [await probe(selector, row.expected, "paddingLeft", id),
          await probe(selector, row.expected, ["checkbox", "skeleton"].includes(spec.control) ? "borderTopLeftRadius" : "fontSize", id)];
        if (spec.state === "focus-visible") {
          row.paint = await focusPaint(page, selector);
          assert.equal(row.paint.pass, true, `${id}: visible contrasting painted focus`);
          await proveFocusMutation(page, selector);
          row.ringRemovalRejected = true;
        }
      } catch (error) {
        row.styleStatus = "FAIL"; row.error = String(error);
        if (error instanceof assert.AssertionError) row.differences = error.actual;
        failures.push({ id, error: row.error, differences: row.differences });
      } finally {
        await writeFile(`${out}/${id}.png`, Buffer.from((await captureCrop(page, selector, { align: false })).data, "base64"));
        if (spec.state === "active") await page.mouse.up();
      }
      records.push(row);
      console.log(`HOSTED_STYLE ${id} ${row.styleStatus}${row.styleStatus === "FAIL" ? ` ${row.error.split("\n")[0]}` : ""}`);
    }
  }
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify({ records, failures, count: records.length, expected: specs.length * 4,
    metricFields, metricComparisons: records.length * metricFields.length,
    realReferences: records.filter(row => row.source?.provenance === "REAL-DEMO").length,
    mitReferences: records.filter(row => row.source?.exception).length,
    styleMutationRejections: records.reduce((sum, row) => sum + (row.mutations?.filter(probe => probe.rejected).length ?? 0), 0),
    ringRemovalRejections: records.filter(row => row.ringRemovalRejected).length }, null, 2));
  await tabs.closeAll();
}
console.log(`HOSTED_CONTROLS_STRICT ${records.length}/${specs.length * 4} failures=${failures.length}`);
process.exit(records.length === specs.length * 4 && failures.length === 0 &&
  records.every(row => row.mutations?.length === 2 && row.styleStatus === "PASS") ? 0 : 1);
