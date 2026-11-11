import assert from "node:assert/strict";
import test from "node:test";
import { compareP1Style, P1_STYLE_FIELDS } from "../../scripts/uxb/p1-style.mjs";
const values = Object.fromEntries(P1_STYLE_FIELDS.map(key => [key, "0px"]));
values.height = "32px";
const reference = { values, glyphs: [] };
test("P1 parity rejects every absent required style field", () => {
  // Given / When / Then: each missing measurement must independently fail.
  for (const field of P1_STYLE_FIELDS) {
    const actual = { values: { ...values }, glyphs: [] };
    delete actual.values[field];
    assert.ok(compareP1Style(reference, actual).some(row => row.field === field));
  }
});
test("P1 parity rejects 60px even when source and product both drift", () => {
  // Given
  const wrong = { values: { ...values, height: "60px" }, glyphs: [] };
  // When
  const failures = compareP1Style(wrong, wrong, { height: "32px" });
  // Then
  assert.ok(failures.some(row => row.field === "height"));
});
test("P1 parity cannot pass with no labelled source reference", () => {
  // Given / When
  const failures = compareP1Style(null, reference);
  // Then
  assert.equal(failures[0].field, "reference");
});
test("P1 parity rejects missing or transparent painted glyphs", () => {
  // Given
  const source = { values, glyphs: [{ tag: "path", stroke: "rgb(23, 23, 23)", opacity: "1", strokeWidth: "2px" }] };
  // When / Then
  for (const change of [{ stroke: "transparent" }, { opacity: "0" }, { strokeWidth: "0px" }]) {
    assert.ok(compareP1Style(source, { values, glyphs: [{ ...source.glyphs[0], ...change }] }).length > 0);
  }
  assert.ok(compareP1Style(source, { values, glyphs: [] }).length > 0);
});
