import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { applyViewport } from "./viewport.mjs";
import { ready } from "./trusted-keys.mjs";
import { captureP1 } from "./p1-capture.mjs";
import { compareP1Style, readP1Style } from "./p1-style.mjs";
import { p1Keyboard, p1KeyboardTrace } from "./p1-keyboard.mjs";
import { p1Focus } from "./p1-focus.mjs";
import { p1Mutations } from "./p1-mutations.mjs";
import { p1Inventory } from "./p1-inventory.mjs";
import { p1Pointer, releaseP1Pointer } from "./p1-pointer.mjs";
import { p1OwnerPolicy } from "./p1-policy.mjs";
import { checkP1Native, readP1Native } from "./p1-native.mjs";
import { closeP1Popup, openP1Popup } from "./p1-open.mjs";
const [site, local, out] = process.argv.slice(2);
if (!site || !local || !out || !process.env.OMOWRIGHT_HELPER) throw Error("site local evidence and OMOWRIGHT_HELPER required");
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const product = (await tabs.create("about:blank", { viewport: { width: 1440, height: 900 } })).page;
const source = (await tabs.create("about:blank", { viewport: { width: 1440, height: 900 } })).page;
const expected = { Textarea: 5, Combobox: 5, MultiSelect: 4, Switch: 16, Radio: 5, Spinner: 48,
  Toast: 6, Avatar: 13, MarkdownViewer: 4, CodeBlock: 3, DiffViewer: 2, DateRangeInput: 3, TimePeriodSelect: 1 };
const selectors = {
  Textarea: "textarea", Combobox: ".lf-combobox__input", MultiSelect: ".lf-combobox__input", Switch: ".lf-switch__track",
  Radio: ".lf-radio__ring", Spinner: ".lf-loading svg", Toast: ".lf-toast", Avatar: ".lf-avatar",
  MarkdownViewer: ".lf-markdown", CodeBlock: ".lf-codeblock", DiffViewer: ".lf-diff-scroll",
  DateRangeInput: ".lf-date-range input", TimePeriodSelect: ".lf-select-wrap",
};
const mitSelectors = {
  Textarea: '[data-component="Textarea"] textarea', Switch: '[data-component="Switch"] [role=switch]',
  Radio: '[data-component="Radio"] > span > span', Spinner: '[data-component="Spinner"] svg',
  Avatar: '[data-component="Avatar"] .relative', Toast: '[data-sonner-toast][data-front=true]',
  Combobox: '[data-component="Combobox"] [role=combobox]',
  MultiSelect: '[data-component="MultiSelect"] [role=combobox]',
  DateRangeInput: '[data-component="NativeDate"] input',
  CodeBlock: '[data-component="CodeBlock"] .codeblock',
  MarkdownViewer: '[data-component="MarkdownViewer"] .space-y-2',
  DiffViewer: '[data-component="DiffViewer"] .rounded-lg.border',
};
const retainedExamples = JSON.parse(await readFile(`${out}/viewer-examples.json`, "utf8"));
// The cited Demo PNG has one blank line here; text extraction doubled it.
const examples = { ...retainedExamples, code: retainedExamples.code.replace("\n\n\nlf = get_client()", "\n\nlf = get_client()") };
const demo = JSON.parse(await readFile(`${out}/demo-records.json`, "utf8"));
const refreshed = JSON.parse(await readFile(`${out}/demo-records-matched.json`, "utf8"));
const extra = JSON.parse(await readFile(`${out}/demo-records-extra.json`, "utf8"));
const structured = JSON.parse(await readFile(`${out}/demo-records-structured.json`, "utf8"));
assert.equal(structured.length, 2, "Live structured Markdown is required in both themes");
examples.structured = await readFile(`${out}/demo-markdown.md`, "utf8");
assert.equal(extra.length, 4, "Live Avatar and Spinner reconciliation is required");
const [js, css, fontCss] = await Promise.all(["mit.js", "mit.css", "reference-font.css"].map(path => readFile(`${out}/${path}`, "utf8")));
const results = [], captures = [], structure = [], keyboard = [], focus = [], mutations = [], errors = [];
const referenceCache = new Map();
await mkdir(`${out}/matrix`, { recursive: true }); await mkdir(`${out}/mit-captures`, { recursive: true });
async function mountSource(theme) {
  const tree = await source._sendToTarget("Page.getFrameTree");
  await source._sendToTarget("Page.setDocumentContent", { frameId: tree.frameTree.frame.id,
    html: `<!doctype html><html class="${theme}" style="color-scheme:${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
      <aside>ACTUAL PINNED MIT 69181812b87169df157841fce1314ec96ecd2c5a; NOT DEMO</aside><div id="reference"></div></body></html>` });
  await source.evaluate(({ js, css, fontCss }) => {
    const style = document.createElement("style"); style.textContent = css + fontCss + `
      #mit-ready>section{width:min(356px,calc(100% - 32px));margin:16px}
      #mit-ready>[data-component="CodeBlock"]{font-size:13px;line-height:20px;color:hsl(var(--foreground-secondary))}
      :root{--font-plex-mono:plexMono,"plexMono Fallback"}`;
    document.head.append(style);
    const script = document.createElement("script"); script.type = "module"; script.textContent = js; document.body.append(script);
  }, { js, css, fontCss });
  await ready(source, "#mit-ready");
}
async function reference({ component, state, interaction, theme, width }) {
  const key = [component, state, interaction, theme, width].join(":");
  if (referenceCache.has(key)) return referenceCache.get(key);
  const remember = record => { referenceCache.set(key, record); return record; };
  const audited = extra.find(row => row.component === component && row.state === state && row.theme === theme);
  if (audited) {
    assert.ok(audited.states?.[interaction], `Missing live ${component} ${interaction}`);
    return remember({ ...audited, ...audited.states[interaction] });
  }
  const live = !mitSelectors[component] ||
    component === "MarkdownViewer" && ["formatted", "structured"].includes(state) && width === 1440 ||
    component === "CodeBlock" && state === "default" && width === 1440 ||
    component === "DiffViewer" && state === "changed" && width === 1440;
  if (live) {
    const source = state === "structured" ? structured.find(row => row.theme === theme && row.width === width)
      : refreshed.find(row => row.component === component && row.theme === theme && row.width === width) ??
      demo.find(row => row.component === component && row.theme === theme);
    if (!source) return null;
    const sourceWidth = source.geometry?.width ?? (component === "DiffViewer" ? 1242 : 596);
    assert.ok(source.states?.[interaction], `Missing live ${component} ${interaction}`);
    const measured = source.states[interaction];
    return remember({ ...source, ...measured, style: { ...measured.style,
      values: { ...measured.style.values, width: `${sourceWidth}px` } } });
  }
  const sourceState = component === "Radio" && state === "group" ? "checked-enabled" : state;
  await source.evaluate(settings => window.renderReference(settings), { state: sourceState, theme, examples });
  await source.evaluate(({ state, theme }) => new Promise((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => { observer.disconnect(); reject(Error(`MIT state ${state}`)); }, 8000);
    function check() {
      const node = document.querySelector("#mit-ready");
      if (node?.dataset.refState !== state || node?.dataset.refTheme !== theme) return;
      observer.disconnect(); clearTimeout(timer); resolve();
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true }); check();
  }), { state: sourceState, theme });
  if (component === "Toast") {
    await source.evaluate(variant => window.showReferenceToast(variant), state);
    await ready(source, `[data-sonner-toast][data-front=true][data-mounted=true]${state === "default" ? ":not([data-type])" : `[data-type="${state}"]`}`);
  }
  if (component === "DateRangeInput" && state === "error") await ready(source, '[data-component="NativeDate"] p.text-destructive');
  await source.evaluate(async () => {
    document.body.getBoundingClientRect();
    await document.fonts.load("12px plexMono");
    await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      const end = animation.effect.getComputedTiming().endTime;
      if (Number.isFinite(end)) animation.finish(); else { animation.pause(); animation.currentTime = 0; }
    }
  });
  const opened = state === "open"
    ? await openP1Popup(source, { side: "mit", root: null, component, interaction }) : null;
  const selector = opened ? opened.selector : component === "DiffViewer" && state === "empty"
    ? '[data-component="DiffViewer"] > .text-muted-foreground' : mitSelectors[component];
  const pointer = opened ? opened.pointer : await p1Pointer(source, selector, interaction);
  const style = await readP1Style(source, selector, { component, state });
  const screenshot = `${out}/mit-captures/${component}-${state}-${width}-${theme}-${interaction}.png`;
  await source.evaluate(selector => {
    const node = document.querySelector(selector);
    node.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = node.getBoundingClientRect(), label = document.createElement("aside");
    label.id = "mit-evidence-label"; label.textContent = "ACTUAL PINNED MIT 69181812 (not Demo)";
    label.style.cssText = `position:fixed;left:${Math.max(4, rect.left)}px;top:${Math.max(0, rect.top - 15)}px;font:10px/12px system-ui;color:CanvasText;background:Canvas;z-index:2147483647;pointer-events:none`;
    document.body.append(label);
  }, selector);
  await captureP1(source, selector, screenshot);
  if (interaction === "active") await releaseP1Pointer(source);
  await source.evaluate(() => document.querySelector("#mit-evidence-label").remove());
  if (opened) await closeP1Popup(source, "mit", null, component);
  return remember({ provenance: "ACTUAL-PINNED-MIT", sourceSHA: "69181812b87169df157841fce1314ec96ecd2c5a",
    component, state, theme, style, screenshot, pointer });
}
try {
  for (const [surface, base] of [["site", site], ["local", local]]) {
    for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
      if (process.env.P1_PROFILE && process.env.P1_PROFILE !== `${surface}:${width}:${theme}`) continue;
      const viewport = { width, height: 900, deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390, coarse: width === 390 };
      await applyViewport(product, viewport); await applyViewport(source, viewport);
      await mountSource(theme);
      const params = new URLSearchParams({ p1: "", atomic: "", theme, code: examples.code, markdown: examples.markdown,
        before: examples.before ?? "", after: examples.after ?? "", language: "python", structured: examples.structured });
      await product.goto(`${base}/__gallery.html?${params}`, { waitUntil: "domcontentloaded" });
      await applyViewport(product, viewport);
      await ready(product, "#gallery[data-ready=true]");
      // The range error is produced by the real apply action on an inverted range.
      const apply = await product.evaluate(() => {
        const button = document.querySelector('[data-component="DateRangeInput"][data-state="error"] .lf-button');
        button.scrollIntoView({ block: "center", behavior: "instant" });
        const box = button.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
      for (const type of ["mousePressed", "mouseReleased"])
        await product._sendToTarget("Input.dispatchMouseEvent", { type, ...apply, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      await ready(product, '[data-component="DateRangeInput"][data-state="error"] p[role=alert]');
      await product.evaluate(async theme => {
        document.documentElement.dataset.theme = theme;
        await document.fonts.ready;
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 0; }
      }, theme);
      const cases = await product.evaluate(() => [...document.querySelectorAll("[data-specimen]")].map(n =>
        ({ component: n.dataset.component, state: n.dataset.state })));
      assert.equal(cases.length, Object.values(expected).reduce((sum, count) => sum + count, 0));
      assert.equal(new Set(cases.map(row => `${row.component}:${row.state}`)).size, cases.length);
      for (const [component, count] of Object.entries(expected)) assert.equal(cases.filter(row => row.component === component).length, count, component);
      const owner = await product.evaluate(() => ({
        coarse: matchMedia("(pointer:coarse)").matches, width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        manualPrism: window.Prism?.manual === true,
        controls: [...document.querySelectorAll('[data-specimen] :is(button,input:not([type=hidden]),select)')].filter(n => n.checkVisibility())
          .map(n => ({ tag: n.tagName, role: n.getAttribute("role"), height: n.getBoundingClientRect().height })),
      }));
      structure.push({ surface, requestedWidth: width, theme, ...owner,
        status: owner.width === width && owner.coarse === (width === 390) &&
          owner.scrollWidth <= width && owner.manualPrism ? "PASS" : "FAIL" });
      for (const item of cases.filter(item => !process.env.P1_COMPONENTS ||
        process.env.P1_COMPONENTS.split(",").includes(item.component))) for (const interaction of ["rest", "hover", "active"]) {
        const root = `[data-component="${item.component}"][data-state="${item.state}"]`;
        const selector = `${root} ${selectors[item.component]}`;
        try {
          const sourceRecord = await reference({ ...item, interaction, theme, width });
          const comparableWidth = item.component === "TimePeriodSelect" ? sourceRecord.geometry.width
            : width === 1440 && (
            item.component === "CodeBlock" && item.state === "default" ||
            item.component === "MarkdownViewer" && ["formatted", "structured"].includes(item.state)) ? parseFloat(sourceRecord.style.values.width)
            : width === 1440 && item.component === "DiffViewer" && item.state === "changed" ? parseFloat(sourceRecord.style.values.width) : null;
          if (comparableWidth) await product.evaluate(({ root, width }) => {
            document.querySelector(`${root} [data-probe]`).style.width = `${width}px`;
          }, { root, width: comparableWidth });
          const opened = item.state === "open"
            ? await openP1Popup(product, { side: "product", root, component: item.component, interaction }) : null;
          const target = opened ? opened.selector : selector;
          const pointer = opened ? opened.pointer : await p1Pointer(product, selector, interaction);
          const actual = await readP1Style(product, target, item);
          const native = opened ? null : await readP1Native(product, selector, item.component);
          const referenceStyle = sourceRecord?.style ?? null;
          const policy = await p1OwnerPolicy(product,
            { ...item, reference: referenceStyle, actual, coarse: owner.coarse });
          const differences = compareP1Style(referenceStyle, actual,
            { ...policy, inventory: p1Inventory(item.component, item.state) });
          if (!opened) differences.push(...checkP1Native(native, item.component));
          if (opened && interaction !== "rest" && !pointer.stillActive)
            differences.push({ field: "pointer.activeRow", expected: "Beta", actual: pointer });
          const painted = actual.geometry.width > 0 && actual.geometry.height > 0;
          if (interaction !== "rest" && painted && !pointer.hover && !opened)
            differences.push({ field: "pointer.hover", expected: true, actual: pointer });
          if (opened && interaction !== "rest" && !pointer.hover)
            differences.push({ field: "pointer.hover", expected: true, actual: pointer });
          if (!pointer.trustedPointer || interaction === "active" && painted && !pointer.disabled && !pointer.nativePicker && !pointer.active)
            differences.push({ field: "pointer.active/trusted", expected: "trusted real state", actual: pointer });
          if (item.component === "DiffViewer" && item.state === "changed" && width === 390) {
            const expectedText = referenceStyle.text.replace(/\s+/g, " ").trim();
            const actualText = actual.text.replace(/\s+/g, " ").trim();
            if (expectedText !== actualText) differences.push({ field: "visibleContent", expected: expectedText, actual: actualText });
          }
          const path = `${out}/matrix/${surface}-${item.component}-${item.state}-${width}-${theme}${interaction === "rest" ? "" : `-${interaction}`}.png`;
          const capture = await captureP1(product, target, path);
          captures.push({ surface, width, theme, ...item, ...capture });
          if (opened) await closeP1Popup(product, "product", root, item.component);
          results.push({ surface, width, theme, ...item, interaction, pointer, painted, reference: sourceRecord, actual, native, policy, differences,
            status: differences.length ? "FAIL" : "PASS", capture: path });
          if (comparableWidth) await product.evaluate(root => {
            document.querySelector(`${root} [data-probe]`).style.removeProperty("width");
          }, root);
        } catch (error) {
          await product.evaluate(root => {
            document.querySelector(`${root} [data-probe]`)?.style.removeProperty("width");
          }, root);
          errors.push({ surface, width, theme, ...item, interaction, error: String(error) });
        } finally {
          if (interaction === "active") await releaseP1Pointer(product);
        }
      }
      await product.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      const end = await product._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(`${out}/matrix/${surface}-${width}-${theme}-end.png`, Buffer.from(end.data, "base64"));
      console.log(`P1_MATRIX ${surface} ${width} ${theme} ${results.length} cases, ${results.filter(row => row.status === "PASS").length} passing, ${errors.length} evidence errors`);
      mutations.push(...(await p1Mutations(product, owner)).map(row => ({ surface, width, theme, ...row })));
    }
    try { keyboard.push({ surface, results: await p1Keyboard(product, base), activeDescendants: p1KeyboardTrace(), status: "PASS" }); }
    catch (error) { keyboard.push({ surface, status: "FAIL", error: String(error), activeDescendants: p1KeyboardTrace() }); }
    focus.push(...await p1Focus(product, { base, out: `${out}/focus`, surface }));
  }
} finally {
  await writeFile(`${out}/${process.env.P1_REPORT ?? "p1-gate"}.json`, JSON.stringify({
    expected, interactions: ["rest", "hover", "active"], selectedProfile: process.env.P1_PROFILE ?? "all",
    selectedComponents: process.env.P1_COMPONENTS ?? "all", results, captures, structure, keyboard, focus, mutations, errors,
  }, null, 2));
  await tabs.closeAll(); await browser.close();
}
const passed = results.filter(row => row.status === "PASS").length;
console.log(`P1_GATE_RESULT ${passed}/${results.length} style comparisons PASS; ${captures.length} captures; ${errors.length} evidence errors`);
process.exitCode = errors.length || passed !== results.length || keyboard.some(row => row.status !== "PASS") ||
  structure.some(row => row.status !== "PASS") || focus.some(row => row.status !== "PASS") ? 1 : 0;
