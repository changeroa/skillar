import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { measureStateStyles } from "./local-state-style.mjs";
const root = process.argv[2];
if (!root || !process.env.OMOWRIGHT_HELPER) throw Error("Usage: OMOWRIGHT_HELPER=/path/to/omowright.mjs node local-nonready-style.mjs evidence-root");
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
const { loadSurface, screens } = await import(pathToFileURL(`${root}/cert-surfaces.mjs`).href);
const sourceRecords = JSON.parse(await readFile(`${root}/cert-source.json`, "utf8")).records;
const references = JSON.parse(await readFile(`${root}/state-references.json`, "utf8")).results;
const membership = JSON.parse(await readFile(new URL("./local-state-style-inventory.json", import.meta.url), "utf8")).cases;
const { omowright } = await loadOmowright(), browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser), { page } = await tabs.create("about:blank");
const records = [];
try {
  for (const kind of ["local", "hosted"])
  for (const screen of screens.filter(s => !(kind === "hosted" && s.name === "analysis")))
  for (const state of ["loading", "error", "empty"])
  for (const width of [1440, 390])
  for (const theme of ["light", "dark"]) {
    const id = `${kind}-after-${screen.name}-${state}-${width}-${theme}`;
    let surface;
    try {
      surface = await loadSurface(page, { kind, screen, state, width, theme });
      const style = await measureStateStyles(page, { scope: screen.scope, references, sourceRecords, width, theme, caseId: id });
      records.push({ id, ...style, passed: style.measurements.every(m => m.pass) && style.mutations.every(m => m.rejected) });
    } finally { await surface?.release(); }
  }
} finally {
  await writeFile(`${root}/full-state-style.json`, JSON.stringify({ records }, null, 2));
  await tabs.closeAll(); await browser.close();
}
assert.deepEqual(records.map(r => r.id).sort(), Object.keys(membership).sort());
const failures = records.flatMap(r => r.measurements.filter(m => !m.pass).map(m => ({ id: r.id, ...m })));
console.log(`NONREADY_STYLE_COMPLETE cases=${records.length} failures=${failures.length}`);
assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 20)));
assert.ok(records.every(r => r.mutations.every(m => m.rejected)));
