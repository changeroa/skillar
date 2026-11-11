import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const root = process.argv[2];
if (!root || !process.env.OMOWRIGHT_HELPER) throw Error("Usage: OMOWRIGHT_HELPER=/path/to/omowright.mjs node local-full-style.mjs evidence-root [pr6-source-records.json]");
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
import { componentStyleFields, normalizeComponentStyle, compareComponentStyle } from "./component-style.mjs";
const { loadSurface, screens } = await import(pathToFileURL(`${root}/cert-surfaces.mjs`).href);
import { ready } from "./trusted-keys.mjs";
const inventory = JSON.parse(await readFile(new URL("./local-style-inventory.json", import.meta.url), "utf8"));
const sources = JSON.parse(await readFile(`${root}/cert-source.json`, "utf8")).records;
const buttonSources = JSON.parse(await readFile(process.argv[3], "utf8"));
const tabSources = JSON.parse(await readFile(`${root}/tab-style-source.json`, "utf8"));
const sortSources = JSON.parse(await readFile(`${root}/sort-style-source.json`, "utf8"));
function controlPart(record) {
  assert.ok(record?.reference, "Missing real control reference");
  const reference = record.reference, styles = {};
  for (const field of componentStyleFields) {
    const value = field === "borderRadius" ? reference.borderTopLeftRadius : reference[field];
    styles[field] = Array.isArray(value) ? `rgba(${value.slice(0, 3).join(",")},${value[3] / 255})` :
      typeof value === "number" ? `${value}${field === "fontWeight" ? "" : "px"}` : value;
  }
  assert.deepEqual(reference.shadows, [], "Default outline reference has no painted shadow");
  styles.boxShadow = "none";
  return { styles, provenance: record.provenance, url: record.url, path: record.path };
}
const mappings = {
  ".sessions-console .page-title :is(h1,h2)": "heading",
  ".analysis.pe-console>header>:is(h1,h2)": "heading",
  '[role=treeitem][aria-selected=false] .trace-event-row__kind': "tree-label-default",
  '[role=treeitem][aria-selected=true] .trace-event-row__kind': "tree-label",
  '[role=gridcell] .trace-event-row__kind': "tree-label",
  ".trace-event-row time": "tree-time",
  ".trace-event-row__summary": "tree-time",
  ".trace-compact-row code": "tree-time",
  '[role=treeitem][aria-selected=false]': "tree-default",
  '[role=treeitem][aria-selected=true]': "tree-selected",
  ".event-gantt-bar": "bar-span",
  ".json-line code": "json-property",
  '.json-value[data-json-type=string]': "json-string",
  '.json-value-preview[data-json-type=string]': "json-string",
  ".lf-card": "card", ".lf-card__title": "card-title",
  ".lf-card__header": "card-header", ".lf-card__content": "card-content",
  ".lf-metric__value": "metric", ".session-table th": "table-header",
  ".session-table .lf-table-sort": "table-sort",
  ".session-table .lf-table-sort>span": "table-header-label",
  ".session-toolbar summary.pe-button": "button",
  ".analysis-toolbar .lf-button": "button", ".seg__btn,.seg__b": "tab",
  ".analysis-table th": "table-header", ".flow__chart": "card",
  ".hmc": "card", ".hmc__title": "card-title", ".ws .card": "card",
};
const { omowright } = await loadOmowright(), browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser), { page } = await tabs.create("about:blank");
const records = [];
try {
  for (const kind of (process.env.KINDS ?? "local,hosted").split(","))
  for (const screen of screens.filter(s => !(kind === "hosted" && s.name === "analysis") &&
    (!process.env.SCREENS || process.env.SCREENS.split(",").includes(s.name))))
  for (const width of (process.env.WIDTHS ?? "1440,390").split(",").map(Number))
  for (const theme of (process.env.THEMES ?? "light,dark").split(",")) {
    const id = `${kind}-${screen.name}-${width}-${theme}`;
    await loadSurface(page, { kind, screen, width, theme });
    for (const selector of inventory.cases[id]) await ready(page, `${screen.scope} :is(${selector})`);
    const referenceParts = Object.assign({}, ...sources.filter(r => r.width === width && r.theme === theme && r.position === "top").map(r => r.parts));
    referenceParts.button = controlPart(buttonSources.find(r => r.id === `secondary-default-${theme}-${width}`));
    referenceParts.tab = tabSources.find(r => r.theme === theme);
    referenceParts["table-sort"] = sortSources.find(r => r.width === width && r.theme === theme);
    const profiles = inventory.cases[id].map(selector => {
      const source = mappings[selector];
      const part = referenceParts[source === "heading" ? "tree-label" : source];
      assert.ok(part, `${id}: missing independent source ${source}`);
      return { selector, source, part, count: inventory.counts[id][selector] };
    });
    const observed = await page.evaluate(({ scope, profiles, normalizer, fields, width }) => {
      const normalize = (0, eval)(`(${normalizer})`), root = document.querySelector(scope), values = [], mutations = [];
      const stable = document.createElement("style");
      stable.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
      document.head.append(stable);
      try {
        for (const profile of profiles) {
          const nodes = [...root.querySelectorAll(profile.selector)].filter(node =>
            node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
          if (nodes.length !== profile.count) throw Error(`Missing required full-style target ${profile.selector}: ${nodes.length}/${profile.count}`);
          for (const [index, node] of nodes.entries()) {
            if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
              throw Error(`Hidden required full-style target ${profile.selector}`);
            const css = getComputedStyle(node);
            const expected = normalize(profile.part.styles, profile.part.styles.typedHeight ?? "auto");
            const owner = [];
            if (node.matches('[role=treeitem],button,summary,.seg__btn,.seg__b')) {
              expected.height = `${width === 390 ? 44 : 32}px`;
              owner.push("Absolute owner 32/44px control");
            }
            if (profile.source === "heading") {
              Object.assign(expected, { height: "auto", fontSize: "16px", lineHeight: "24px", fontWeight: "600" });
              owner.push("wireframes-v3 heading composition");
            }
            if (["card", "card-content", "card-header"].includes(profile.source)) {
              expected.height = "auto";
              owner.push("Native content-dependent height; CSS auto is asserted, not source data height");
            }
            if (profile.source.startsWith("bar-")) expected.height = profile.part.styles.height;
            if (profile.source === "table-header") {
              expected.height = `${(width === 390 ? 44 : 32) + 8}px`;
              expected.paddingLeft = node.matches(":first-child") ? "8px" : "4px";
              owner.push("Source p-1 first:pl-2 header variants; owner control height plus 8px header inset");
            }
            if (profile.source === "card" && !node.matches(".lf-card")) {
              for (const side of ["Top", "Right", "Bottom", "Left"]) expected[`padding${side}`] = "16px";
              owner.push("Native single-box Card combines actual Card root and CardHeader inset");
            }
            const actual = normalize(css, node.computedStyleMap().get("height").toString());
            values.push({ ...profile, part: undefined, index, actual, expected, owner });
            for (const field of fields) {
              const old = node.getAttribute("style");
              const property = field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
              const value = field.includes("Color") ? "rgb(1, 2, 3)" : field === "fontWeight" ? "900" :
                field === "outlineStyle" ? "dashed" : field === "boxShadow" ? "0 0 0 7px rgb(1,2,3)" : "111px";
              try {
                if (field.startsWith("border") && field.endsWith("Width")) node.style.setProperty(property.replace("-width", "-style"), "solid", "important");
                if (field.startsWith("outline")) node.style.setProperty("outline", "7px solid rgb(1,2,3)", "important");
                node.style.setProperty(property, value, "important");
                mutations.push({ selector: profile.selector, index, field,
                  actual: normalize(getComputedStyle(node), node.computedStyleMap().get("height").toString()), expected,
                  applied: old !== node.getAttribute("style") });
              } finally { if (old === null) node.removeAttribute("style"); else node.setAttribute("style", old); }
            }
          }
        }
      } finally { stable.remove(); }
      return { values, mutations };
    }, { scope: screen.scope, profiles, normalizer: normalizeComponentStyle.toString(), fields: componentStyleFields, width });
    const measurements = observed.values.flatMap(v => compareComponentStyle(v.actual, v.expected).map(m => ({ selector: v.selector, index: v.index, ...m })));
    const mutations = observed.mutations.map(m => ({ ...m, rejected: m.applied && compareComponentStyle(m.actual, m.expected).some(v => !v.pass) }));
    records.push({ id, measurements, mutations, overrides: observed.values.filter(v => v.owner.length).map(v => ({ selector: v.selector, owner: v.owner })) });
    console.log(`FULL_STYLE_CASE ${id} failures=${measurements.filter(m => !m.pass).length}`);
  }
} finally {
  await writeFile(`${root}/full-style.json`, JSON.stringify({ records }, null, 2));
  await tabs.closeAll(); await browser.close();
}
const failures = records.flatMap(r => r.measurements.filter(m => !m.pass).map(m => ({ id: r.id, ...m })));
assert.deepEqual(records.map(r => r.id).sort(), Object.keys(inventory.cases).sort());
console.log(`FULL_STYLE_COMPLETE cases=${records.length} failures=${failures.length}`);
assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 20)));
assert.ok(records.every(r => r.mutations.every(m => m.rejected)));
