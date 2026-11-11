import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const [out] = process.argv.slice(2);
const initial = JSON.parse(await readFile(`${out}/p1-gate.json`, "utf8"));
const corrected = JSON.parse(await readFile(`${out}/p1-avatar-correction.json`, "utf8"));
assert.equal(corrected.results.length, 104);
assert.equal(corrected.errors.length, 0);
assert.ok(corrected.results.every(row => row.component === "Avatar" && row.status === "PASS"));
const results = [...initial.results.filter(row => row.component !== "Avatar"), ...corrected.results];
assert.equal(results.length, 632);
const report = { ...initial, results,
  captures: [...initial.captures.filter(row => row.component !== "Avatar"), ...corrected.captures],
  corrections: ["p1-avatar-correction.json"],
  summary: { pass: results.filter(row => row.status === "PASS").length,
    fail: results.filter(row => row.status === "FAIL").length, captures: results.length },
};
await writeFile(`${out}/p1-final.json`, JSON.stringify(report, null, 2));
console.log(`P1_FINAL ${report.summary.pass}/${results.length} style PASS; ${report.summary.fail} FAIL`);
