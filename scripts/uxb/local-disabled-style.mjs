import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { normalizeComponentStyle, compareComponentStyle } from "./component-style.mjs";
const root = process.argv[2];
const { loadSurface, screens } = await import(pathToFileURL(`${root}/cert-surfaces.mjs`).href);
const sources = JSON.parse(await readFile(`${root}/disabled-outline-demo/records.json`, "utf8")).records;
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser), { page } = await tabs.create("about:blank");
const records = [];
try {
  for (const kind of ["local", "hosted"]) for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    const reference = sources.find(r => r.width === width && r.theme === theme);
    assert.ok(reference?.disabled && reference.footerHidden && reference.acceptance.pass);
    let surface;
    try {
      surface = await loadSurface(page, { kind, screen: screens.find(s => s.name === "flow"),
        state: "loading", width, theme });
      const measured = await page.evaluate(({ reference, normalizer, width }) => {
        const normalize = (0, eval)(`(${normalizer})`);
        const node = document.querySelector(".analysis-toolbar .lf-button--outline:disabled");
        if (!node?.checkVisibility()) throw Error("Missing visible native disabled outline toolbar");
        const height = `${width === 390 ? 44 : 32}px`;
        const expected = normalize(reference.parts[0].styles, height);
        const padding = normalize(reference.supplement.parts[0].styles, height);
        for (const side of ["Top", "Right", "Bottom", "Left"]) expected[`padding${side}`] = padding[`padding${side}`];
        return { actual: normalize(getComputedStyle(node), node.computedStyleMap().get("height").toString()),
          expected, disabled: node.disabled };
      }, { reference, normalizer: normalizeComponentStyle.toString(), width });
      const measurements = compareComponentStyle(measured.actual, measured.expected);
      records.push({ id: `${kind}-disabled-outline-${width}-${theme}`, reference: reference.id,
        source: reference.url, supplement: "Text-button padding only; owner absolute 32/44px height",
        measurements, pass: measured.disabled && measurements.every(m => m.pass) });
    } finally { await surface?.release(); }
  }
} finally {
  await writeFile(`${root}/disabled-outline-style.json`, JSON.stringify({ records }, null, 2));
  await tabs.closeAll(); await browser.close();
}
assert.equal(records.length, 8);
assert.ok(records.every(r => r.pass), JSON.stringify(records.filter(r => !r.pass)));
console.log(`DISABLED_OUTLINE_STYLE_COMPLETE cases=${records.length} comparisons=${records.reduce((n, r) => n + r.measurements.length, 0)}`);
