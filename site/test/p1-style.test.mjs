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
test("P1 parity rejects a difference in every required style field", () => {
  // Given
  for (const field of P1_STYLE_FIELDS) {
    const actual = { values: { ...values, [field]: "60px" }, glyphs: [] };
    // When
    const failures = compareP1Style(reference, actual);
    // Then
    assert.ok(failures.some(row => row.field === field), field);
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
test("P1 parity enforces both absolute mouse and touch dimensions", () => {
  // Given
  for (const field of ["height", "width"]) for (const dimension of ["32px", "44px"]) {
    for (const received of ["60px", `${parseFloat(dimension) + 1}px`]) {
      const wrong = { values: { ...values, [field]: received }, glyphs: [] };
      // When
      const failures = compareP1Style(wrong, wrong, { [field]: dimension });
      // Then
      assert.ok(failures.some(row => row.field === field));
    }
  }
});
test("P1 parity cannot pass with no labelled source reference", () => {
  // Given / When
  const failures = compareP1Style(null, reference);
  // Then
  assert.equal(failures[0].field, "reference");
});
test("P1 parity rejects an unpainted target with otherwise matching styles", () => {
  // Given
  const actual = { ...reference, visible: false };
  // When
  const failures = compareP1Style(reference, actual);
  // Then
  assert.ok(failures.some(row => row.field === "visible"));
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
test("P1 parity enforces every style field on non-SVG painted parts", () => {
  const source = { ...reference, parts: [{ role: "thumb", x: 2, y: 2,
    style: { values: { ...values }, glyphs: [], visible: true } }] };
  for (const field of P1_STYLE_FIELDS) {
    for (const missing of [false, true]) {
      const actual = structuredClone(source);
      if (missing) delete actual.parts[0].style.values[field];
      else actual.parts[0].style.values[field] = "60px";
      assert.ok(compareP1Style(source, actual).some(row => row.field === `parts.0.${field}`), field);
    }
  }
});
test("P1 parity rejects missing, hidden, or displaced non-SVG paint", () => {
  const source = { ...reference, parts: [{ role: "dot", x: 4, y: 4,
    style: { values: { ...values, opacity: "1" }, glyphs: [], visible: true } }] };
  for (const mutate of [
    actual => { actual.parts = []; },
    actual => { actual.parts[0].style.visible = false; },
    actual => { actual.parts[0].style.values.opacity = "0"; },
    actual => { actual.parts[0].x = 60; },
  ]) {
    const actual = structuredClone(source);
    mutate(actual);
    assert.ok(compareP1Style(source, actual).some(row => row.field.startsWith("parts.")));
  }
});
test("P1 parity ignores only unpainted zero-area shadow entries", () => {
  const shadow = "rgba(0, 0, 0, 0.1) 0px 10px 15px -3px";
  const source = { values: { ...values, boxShadow: `rgb(39, 39, 42) 0px 0px 0px 0px, ${shadow}` }, glyphs: [] };
  assert.deepEqual(compareP1Style(source, { values: { ...values, boxShadow: shadow }, glyphs: [] }), []);
  const shifted = { values: { ...values, boxShadow: `rgb(39, 39, 42) 2px 0px 0px 0px, ${shadow}` }, glyphs: [] };
  assert.ok(compareP1Style(source, shifted).some(row => row.field === "boxShadow"));
});
