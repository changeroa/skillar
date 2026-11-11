import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const expected = { Textarea: 5, Combobox: 5, MultiSelect: 4, Switch: 16, Radio: 5, Spinner: 48,
  Toast: 6, Avatar: 13, MarkdownViewer: 4, CodeBlock: 3, DiffViewer: 2, DateRangeInput: 3, TimePeriodSelect: 1 };
const states = Object.entries(expected).flatMap(([component, count]) =>
  Array.from({ length: count }, (_, state) => ({ component, state })));
const rows = ["site", "local"].flatMap(surface => [390, 1440].flatMap(width => ["light", "dark"].flatMap(theme =>
  states.flatMap(state => ["rest", "hover", "active"].map(interaction => ({
    ...state, surface, width, theme, interaction, status: "PASS", differences: [],
  }))))));

for (const mode of ["partial", "duplicate", "filtered"]) {
  test(`P1 publication rejects a ${mode} matrix`, async t => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "p1-finalize-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const results = mode === "partial" ? rows.slice(0, 632) : [...rows];
    if (mode === "duplicate") results[0] = results[1];
    const report = { expected, selectedComponents: "all", selectedProfile: mode === "filtered" ? "site:390:light" : "all",
      interactions: ["rest", "hover", "active"], results, captures: results, errors: [] };
    await writeFile(join(directory, "p1-final-head.json"), JSON.stringify(report));
    // When / Then
    await assert.rejects(promisify(execFile)(process.execPath,
      [new URL("../../scripts/uxb/p1-finalize.mjs", import.meta.url).pathname, directory]),
    error => error instanceof Error && "code" in error && error.code === 1);
  });
}
