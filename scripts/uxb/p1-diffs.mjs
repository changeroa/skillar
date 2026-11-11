import { mkdir, readFile, writeFile } from "node:fs/promises";
import { diffImages } from "./image-diff.mjs";
const [out] = process.argv.slice(2);
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const { page } = await tabs.create("about:blank");
const report = JSON.parse(await readFile(`${out}/${process.env.P1_REPORT ?? "p1-gate"}.json`, "utf8"));
const results = [];
await mkdir(`${out}/diffs`, { recursive: true });
try {
  for (const row of report.results) {
    const name = `${row.surface}-${row.component}-${row.state}-${row.width}-${row.theme}`;
    try {
      const paths = { reference: row.reference.screenshot, actual: row.capture,
        sideBySide: `${out}/diffs/${name}-side.png`, diff: `${out}/diffs/${name}-raw.png` };
      results.push({ name, ...paths, ...await diffImages(page, paths) });
    } catch (error) { results.push({ name, error: String(error) }); }
  }
} finally {
  await writeFile(`${out}/pixel-diffs.json`, JSON.stringify(results, null, 2));
  await tabs.closeAll(); await browser.close();
}
console.log(`P1_DIFFS ${results.length} comparisons; ${results.filter(row => row.error).length} errors`);
process.exitCode = results.some(row => row.error) ? 1 : 0;
