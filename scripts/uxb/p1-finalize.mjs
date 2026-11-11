import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
const [out] = process.argv.slice(2);
const report = JSON.parse(await readFile(`${out}/${process.env.P1_REPORT ?? "p1-final-head"}.json`, "utf8"));
const expected = { Textarea: 5, Combobox: 5, MultiSelect: 4, Switch: 16, Radio: 5, Spinner: 48,
  Toast: 6, Avatar: 13, MarkdownViewer: 4, CodeBlock: 3, DiffViewer: 2, DateRangeInput: 3, TimePeriodSelect: 1 };
const states = Object.values(expected).reduce((sum, count) => sum + count, 0), total = states * 3 * 8;
assert.deepEqual(report.expected, expected);
assert.equal(report.selectedComponents, "all");
assert.equal(report.selectedProfile, "all");
assert.deepEqual(report.interactions, ["rest", "hover", "active"]);
assert.equal(report.results.length, total);
assert.equal(report.captures.length, total);
assert.equal(report.errors.length, 0);
assert.ok(report.results.every(row => row.status === "PASS" && row.differences.length === 0));
assert.equal(new Set(report.results.map(row =>
  [row.surface, row.width, row.theme, row.component, row.state, row.interaction].join(":"))).size, total);
for (const surface of ["site", "local"]) for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
  const rows = report.results.filter(row => row.surface === surface && row.width === width && row.theme === theme);
  assert.equal(rows.length, states * 3);
  assert.ok(rows.every(row => report.interactions.includes(row.interaction)));
  assert.equal(new Set(rows.map(row => `${row.component}:${row.state}`)).size, states);
  for (const [component, count] of Object.entries(expected))
    assert.equal(rows.filter(row => row.component === component).length, count * 3);
}
const { stdout } = await promisify(execFile)("git", ["rev-parse", "HEAD"]);
const summary = { pass: report.results.length, fail: 0, captures: report.captures.length,
  painted: report.results.filter(row => row.painted).length,
  emptyNonpainted: report.results.filter(row => !row.painted).length };
await writeFile(`${out}/p1-final.json`, JSON.stringify({ ...report, head: stdout.trim(), summary }, null, 2));
console.log(`P1_FINAL ${summary.pass}/${total} style PASS; ${summary.painted} painted; ${summary.emptyNonpainted} empty`);
