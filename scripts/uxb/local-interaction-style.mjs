import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const root = process.argv[2];
if (!root || !process.env.OMOWRIGHT_HELPER) throw Error("Usage: OMOWRIGHT_HELPER=/path/to/omowright.mjs node local-interaction-style.mjs evidence-root [pr6-source-records.json]");
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
import { componentStyleFields, normalizeComponentStyle, compareComponentStyle } from "./component-style.mjs";
import { focusWidgetControl } from "./widget-visual-guards.mjs";
import { paintedFocus } from "./focus-paint.mjs";
import { press, ready } from "./trusted-keys.mjs";
import { applyViewport } from "./viewport.mjs";
const { loadSurface, screens } = await import(pathToFileURL(`${root}/cert-surfaces.mjs`).href);
const source = JSON.parse(await readFile(`${root}/cert-source.json`, "utf8")).records;
const stateSource = JSON.parse(await readFile(`${root}/state-references.json`, "utf8")).results;
const tabSource = JSON.parse(await readFile(`${root}/tab-style-source.json`, "utf8"));
const graphSource = JSON.parse(await readFile(`${root}/graph-disabled-source.json`, "utf8"));
const specs = [
  { component: "Tree", screen: "session-detail", selector: '[role=treeitem][aria-selected=false]', source: "tree-default",
    states: ["default", "hover", "focus-visible", "active"] },
  { component: "Tree", screen: "session-detail", selector: '[role=treeitem][aria-selected=true]', source: "tree-selected", states: ["selected"] },
  { component: "Timeline", screen: "session-timeline", selector: '[role=gridcell][aria-selected=false]', source: "tree-default",
    states: ["default", "hover", "focus-visible", "active"] },
  { component: "Timeline", screen: "session-timeline", selector: '[role=gridcell][aria-selected=true]', source: "tree-selected", states: ["selected"] },
  { component: "JsonViewer", screen: "session-json", selector: "summary.json-line", source: "json-property",
    states: ["default", "hover", "focus-visible", "active", "expanded", "collapsed"] },
  { component: "EventViewTabs", screen: "session-detail", selector: ".event-console__tabs button:disabled",
    source: "tab", states: ["disabled"] },
  { component: "EventViewTabs", screen: "session-detail", selector: ".event-console__tabs button[aria-selected=false]:not(:disabled)",
    source: "tab", states: ["default", "hover", "focus-visible", "active"] },
  { component: "EventViewTabs", screen: "session-detail", selector: ".event-console__tabs button[aria-selected=true]",
    source: "tab", states: ["selected"] },
];
const records = [], expectedCases = [], samplingProbes = [];
const { omowright } = await loadOmowright(), browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser), { page } = await tabs.create("about:blank");
await mkdir(`${root}/interaction-styles`, { recursive: true });
try {
  await page.evaluate(() => {
    document.body.style.background = "white";
    document.body.style.height = "2400px";
    const style = document.createElement("style");
    style.textContent = "#sampling:focus-visible{outline:2px solid black;outline-offset:-2px}";
    document.head.append(style);
    const button = document.createElement("button");
    button.id = "sampling"; button.textContent = "Focus sampling";
    button.style.cssText = "position:fixed;left:20.25px;top:20.75px;width:120px;height:44px;border:0;background:white";
    document.body.append(button);
  });
  for (const dpr of [1, 3]) {
    await applyViewport(page, { width: dpr === 3 ? 390 : 1440, height: dpr === 3 ? 844 : 900,
      deviceScaleFactor: dpr, mobile: dpr === 3, coarse: dpr === 3 });
    for (const scroll of [0, 53]) {
      await page.evaluate(scroll => window.scrollTo({ top: scroll, behavior: "instant" }), scroll);
      await press(page, "Tab");
      const normalSampling = await paintedFocus(page, "#sampling");
      assert.equal(normalSampling.pass, true, "Fractional-origin 2px indicator");
      assert.equal(normalSampling.captureScroll.y, scroll, "Actual scrolled capture context");
      for (const [property, value] of [["outline-width", "1px"], ["outline-color", "white"]]) {
        await page.evaluate(({ property, value }) => document.querySelector("#sampling").style.setProperty(property, value, "important"), { property, value });
        const corrupted = await paintedFocus(page, "#sampling");
        assert.equal(corrupted.pass, false, `${property} must fail the unchanged pixel predicate`);
        samplingProbes.push({ dpr, scroll, property, normal: normalSampling, corrupted, rejected: true });
        await page.evaluate(property => document.querySelector("#sampling").style.removeProperty(property), property);
      }
    }
  }
  for (const kind of ["local", "hosted"])
  for (const width of [1440, 390])
  for (const theme of ["light", "dark"])
  for (const spec of specs)
  for (const state of spec.states) {
    const id = `${kind}-${spec.component}-${state}-${width}-${theme}`;
    expectedCases.push(id);
    await loadSurface(page, { kind, screen: screens.find(s => s.name === spec.screen), width, theme });
    await ready(page, `.trace :is(${spec.selector})`);
    const selector = `[data-full-style-target]`;
    const point = await page.evaluate(selector => {
      const node = [...document.querySelectorAll(selector)].find(n => n.checkVisibility());
      if (!node) throw Error(`Missing required interaction target ${selector}`);
      node.dataset.fullStyleTarget = "";
      node.scrollIntoView({ block: "center", behavior: "instant" });
      const css = document.createElement("style");
      css.id = "full-style-stable";
      css.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
      document.head.append(css);
      const r = node.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, `.trace :is(${spec.selector})`);
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur());
    if (state === "focus-visible") {
      await press(page, "Tab");
      await page.evaluate(selector => document.querySelector(selector).focus({ preventScroll: true }), selector);
    }
    if (["hover", "active"].includes(state)) {
      await page.mouse.move(point.x, point.y);
      if (state === "active") await page.mouse.down();
    }
    if (["expanded", "collapsed"].includes(state)) {
      await focusWidgetControl(page, selector);
      const open = await page.evaluate(selector => document.querySelector(selector).parentElement.open, selector);
      if (open !== (state === "expanded")) await press(page, "Enter");
      await page.evaluate(() => document.activeElement?.blur());
    }
    const refs = Object.assign({}, ...source.filter(r => r.width === width && r.theme === theme && r.position === "top").map(r => r.parts));
    const record = spec.component === "EventViewTabs" ? (state === "selected" ? tabSource : graphSource).find(r => r.theme === theme) :
      state === "hover" && spec.component !== "JsonViewer" ?
      stateSource.find(r => r.id === `tree-hover-${width}-${theme}`)?.parts[0] : refs[spec.source];
    assert.ok(record, `${id}: missing source`);
    let result;
    try {
      result = await page.evaluate(({ selector, reference, normalizer, width, theme, state, component, fields }) => {
        const normalize = (0, eval)(`(${normalizer})`), node = document.querySelector(selector);
        const expected = normalize(reference.styles, `${width === 390 ? 44 : 32}px`);
        if (component === "JsonViewer") {
          Object.assign(expected, { paddingTop: `${((width === 390 ? 44 : 32) - 18) / 2}px`,
            paddingBottom: `${((width === 390 ? 44 : 32) - 18) / 2}px` });
        }
        const focus = state === "focus-visible";
        if (focus) {
          const ink = normalize({ ...reference.styles, outlineStyle: "solid", outlineWidth: "2px",
            outlineOffset: "-2px", outlineColor: theme === "light" ? "rgb(113,113,122)" : "rgb(138,138,138)" }, expected.height);
          for (const field of fields.filter(f => f.startsWith("outline"))) expected[field] = ink[field];
        }
        const read = () => normalize(getComputedStyle(node), node.computedStyleMap().get("height").toString());
        const actual = read(), mutations = [];
        for (const field of fields) {
          const old = node.getAttribute("style");
          try {
            if (field.startsWith("outline")) node.style.setProperty("outline", "7px dashed rgb(1,2,3)", "important");
            if (/^border.*Width$/.test(field)) node.style.setProperty("border-style", "solid", "important");
            const value = field.endsWith("Color") ? "rgb(1,2,3)" : field === "fontWeight" ? "900" :
              field === "boxShadow" ? "0 0 0 7px rgb(1,2,3)" : field === "outlineStyle" ? "dotted" : "111px";
            node.style.setProperty(field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), value, "important");
            mutations.push({ field, applied: node.getAttribute("style") !== old, actual: read() });
          } finally { if (old === null) node.removeAttribute("style"); else node.setAttribute("style", old); }
        }
        return { actual, expected, mutations, focusVisible: node.matches(":focus-visible"),
          hover: node.matches(":hover"), active: node.matches(":active"), disabled: node.matches(":disabled"),
          expanded: component === "JsonViewer" ? node.parentElement.open : undefined };
      }, { selector, reference: record, normalizer: normalizeComponentStyle.toString(), width, theme, state,
        component: spec.component, fields: componentStyleFields });
      const measurements = compareComponentStyle(result.actual, result.expected);
      const mutations = result.mutations.map(m => ({ field: m.field, applied: m.applied,
        rejected: m.applied && measurements.every(m => m.pass) && compareComponentStyle(m.actual, result.expected).some(v => !v.pass) }));
      const painted = state === "focus-visible" ? await paintedFocus(page, selector, `${root}/interaction-styles/${id}`) : null;
      await page.screenshot({ path: `${root}/interaction-styles/${id}.png` });
      const missing = await page.evaluate(selector => {
        const node = document.querySelector(selector), parent = node.parentNode, next = node.nextSibling;
        try { node.remove(); return document.querySelector(selector) === null; }
        finally { parent.insertBefore(node, next); }
      }, selector);
      const removedRejected = missing && measurements.every(m => m.pass) &&
        compareComponentStyle(null, result.expected).every(m => !m.pass);
      records.push({ id, component: spec.component, state, measurements, mutations, removedRejected,
        painted, stateObserved: { hover: result.hover, focusVisible: result.focusVisible, active: result.active,
          disabled: result.disabled, expanded: result.expanded },
        passed: measurements.every(m => m.pass) && mutations.every(m => m.rejected) && removedRejected &&
          (!painted || painted.pass) && (state !== "hover" || result.hover) && (state !== "active" || result.active) &&
          (state !== "focus-visible" || result.focusVisible) && (state !== "disabled" || result.disabled) &&
          (!["expanded", "collapsed"].includes(state) || result.expanded === (state === "expanded")) });
    } finally {
      if (state === "active") { await page.mouse.move(0, 0); await page.mouse.up(); }
    }
  }
} catch (error) {
  if (!(error instanceof Error)) throw error;
  const failedSurface = await page.evaluate(() => ({
    url: location.href, readyState: document.readyState, body: document.body.innerText,
    inspectors: [...document.querySelectorAll(".event-inspector")].map(n => ({
      hidden: n.hidden, id: n.id, formats: n.querySelector(".event-inspector__formats")?.outerHTML,
      json: Boolean(n.querySelector(".json-viewer")),
    })),
  }));
  await writeFile(`${root}/interaction-styles/failure.json`, JSON.stringify({ error: error.message, completed: records.map(r => r.id), failedSurface }, null, 2));
  await page.screenshot({ path: `${root}/interaction-styles/failure.png` });
  throw error;
} finally {
  await writeFile(`${root}/interaction-style.json`, JSON.stringify({ expectedCases, records, samplingProbes }, null, 2));
  await tabs.closeAll(); await browser.close();
}
assert.deepEqual(records.map(r => r.id), expectedCases);
console.log(`INTERACTION_STYLE_COMPLETE cases=${records.length} failures=${records.filter(r => !r.passed).length}`);
assert.ok(records.every(r => r.passed), JSON.stringify(records.filter(r => !r.passed).map(r => ({ id: r.id,
  differences: r.measurements.filter(m => !m.pass), state: r.stateObserved, painted: r.painted }))));
