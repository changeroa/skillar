import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { applyViewport } from "./viewport.mjs";
import { ready } from "./trusted-keys.mjs";
import { observePaint } from "./widget-paint.mjs";
import { componentStyleFields, normalizeComponentStyle, compareComponentStyle } from "./component-style.mjs";
const root = process.argv[2];
if (!root || !process.env.OMOWRIGHT_HELPER) throw Error("Usage: OMOWRIGHT_HELPER=/path/to/omowright.mjs node local-json-primitives.mjs evidence-root");
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
const sources = JSON.parse(await readFile(`${root}/cert-source.json`, "utf8")).records;
const pinned = JSON.parse(await readFile(`${root}/state-references.json`, "utf8")).results;
const { omowright } = await loadOmowright(), browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser), { page } = await tabs.create("about:blank");
const records = [];
await mkdir(`${root}/json-primitives`, { recursive: true });
try {
  for (const app of ["site", "local"])
  for (const width of [1440, 390])
  for (const theme of ["light", "dark"]) {
    const id = `${app}-${width}-${theme}`;
    await applyViewport(page, { width, height: width === 390 ? 844 : 900,
      deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390, coarse: width === 390 });
    await page.goto(`http://127.0.0.1:${app === "site" ? 5183 : 5184}/__gallery.html?traces=1&theme=${theme}`, { waitUntil: "domcontentloaded" });
    await ready(page, '[data-specimen=json-primitives] .json-value[data-json-type=null]');
    const sample = pinned.find(r => r.id === `mit-Json-mixed-primitives-${width}-${theme}`);
    const refs = Object.fromEntries(["number", "boolean", "null"].map(type =>
      [type, sample.parts.find(p => p.class === `json-view--${type}`)]));
    refs.string = sources.find(r => r.name === "json" && r.width === width &&
      r.theme === theme && r.position === "top").parts["json-string"];
    const observed = await page.evaluate(({ refs, normalizer, observer, fields }) => {
      const normalize = (0, eval)(`(${normalizer})`), paint = (0, eval)(`(${observer})`);
      const root = document.querySelector('[data-specimen=json-primitives]');
      root.scrollIntoView({ block: "center", behavior: "instant" });
      const values = [], probes = [];
      for (const type of ["number", "boolean", "null", "string"]) {
        const nodes = [...root.querySelectorAll(`.json-value[data-json-type=${type}]`)];
        if (nodes.length !== 1 || !nodes[0].checkVisibility()) throw Error(`Missing required ${type} leaf`);
        const node = nodes[0], reference = refs[type];
        if (!reference) throw Error(`Missing real source for ${type}`);
        const expected = normalize(reference.styles, "auto");
        const read = () => normalize(getComputedStyle(node), node.computedStyleMap().get("height").toString());
        const actual = read(), ink = paint(node).color;
        values.push({ type, actual, expected, ink, expectedInk: reference.paint.color });
        for (const field of [...fields, "color"]) {
          const old = node.getAttribute("style");
          try {
            if (field.startsWith("outline")) node.style.setProperty("outline", "7px solid rgb(1,2,3)", "important");
            if (/^border.*Width$/.test(field)) node.style.setProperty("border-style", "solid", "important");
            const value = /Color$|^color$/.test(field) ? "rgb(1,2,3)" : field === "fontWeight" ? "900" :
              field === "boxShadow" ? "0 0 0 7px rgb(1,2,3)" : field === "outlineStyle" ? "dashed" : "111px";
            node.style.setProperty(field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), value, "important");
            probes.push({ type, field, applied: node.getAttribute("style") !== old,
              actual: read(), expected, ink: paint(node).color, expectedInk: reference.paint.color });
          } finally { if (old === null) node.removeAttribute("style"); else node.setAttribute("style", old); }
        }
      }
      return { values, probes };
    }, { refs, normalizer: normalizeComponentStyle.toString(), observer: observePaint.toString(), fields: componentStyleFields });
    const measurements = observed.values.flatMap(v => [...compareComponentStyle(v.actual, v.expected).map(m => ({ type: v.type, ...m })),
      { type: v.type, field: "color", actual: v.ink, expected: v.expectedInk, pass: JSON.stringify(v.ink) === JSON.stringify(v.expectedInk) }]);
    const mutations = observed.probes.map(p => ({ type: p.type, field: p.field, rejected: p.applied &&
      (compareComponentStyle(p.actual, p.expected).some(m => !m.pass) || JSON.stringify(p.ink) !== JSON.stringify(p.expectedInk)) }));
    await page.screenshot({ path: `${root}/json-primitives/${id}.png` });
    records.push({ id, measurements, mutations });
  }
} finally {
  await writeFile(`${root}/json-primitives.json`, JSON.stringify({ records }, null, 2));
  await tabs.closeAll(); await browser.close();
}
const failures = records.flatMap(r => r.measurements.filter(m => !m.pass).map(m => ({ id: r.id, ...m })));
console.log(`JSON_PRIMITIVES_COMPLETE cases=${records.length} leaves=${records.length * 4} failures=${failures.length}`);
assert.equal(records.length, 8);
assert.equal(failures.length, 0, JSON.stringify(failures));
assert.ok(records.every(r => r.mutations.every(m => m.rejected)));
