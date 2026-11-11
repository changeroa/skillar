import assert from "node:assert/strict";
import test from "node:test";
import { compareP1Style, P1_STYLE_FIELDS } from "../../scripts/uxb/p1-style.mjs";
import { P1_PAINT_FIELDS, p1Inventory } from "../../scripts/uxb/p1-inventory.mjs";
import { P1_TEXT_FIELDS, compareTextPaint } from "../../scripts/uxb/p1-text-paint.mjs";
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

test("P1 parity rejects absent paint fields even when both records omit them", () => {
  // Given
  const glyph = Object.fromEntries(P1_PAINT_FIELDS.map(field => [field, null]));
  const source = { values, glyphs: [{ ...glyph, tag: "path" }] };
  for (const field of P1_PAINT_FIELDS) {
    const incomplete = structuredClone(source);
    delete incomplete.glyphs[0][field];
    // When
    const failures = compareP1Style(incomplete, incomplete);
    // Then
    assert.ok(failures.some(row => row.field === `glyphs.0.${field}`), field);
  }
});

test("P1 parity rejects symmetrically missing descendants against fixed anatomy", () => {
  // Given
  const empty = { values, glyphs: [], parts: [] };
  for (const [component, state] of [["Switch", "default-default-checked-enabled"],
    ["Radio", "unchecked-enabled"], ["Avatar", "image"], ["CodeBlock", "default"],
    ["Spinner", "md-inherit"], ["Toast", "loading"], ["Textarea", "empty"], ["Combobox", "default"],
    ["Combobox", "open"], ["MultiSelect", "open"], ["DateRangeInput", "error"], ["TimePeriodSelect", "default"],
    ["MarkdownViewer", "structured"]]) {
    // When
    const failures = compareP1Style(empty, empty, { inventory: p1Inventory(component, state) });
    // Then
    assert.ok(failures.some(row => row.field.endsWith(".inventory")), component);
  }
});

test("P1 text-only control parts reject hidden or transparent text", () => {
  // Given
  const run = { text: "Alpha", values: Object.fromEntries(P1_TEXT_FIELDS.map(field => [field, "rgb(39, 39, 42)"])) };
  const part = visible => ({ role: "text", expectedCount: 1, textOnly: true,
    styles: [{ visible, values: {}, glyphs: [], textPaint: [structuredClone(run)] }] });
  const source = { values, glyphs: [], descendants: [part(true)] };
  for (const mutate of [actual => { actual.descendants[0].styles[0].visible = false; },
    actual => { actual.descendants[0].styles[0].textPaint[0].values.webkitTextFillColor = "rgba(0, 0, 0, 0)"; },
    actual => { actual.descendants[0].styles[0].textPaint = []; }]) {
    const actual = structuredClone(source);
    mutate(actual);
    // When
    const failures = compareP1Style(source, actual);
    // Then
    assert.ok(failures.some(row => row.field.startsWith("descendants.text.0.")));
  }
});

test("P1 native control parts reject hidden, inert or exposed inner controls", () => {
  // Given
  const hit = { shown: true, visibility: "visible", rendered: true, pointerEvents: "auto", opacity: "1",
    ...Object.fromEntries(P1_TEXT_FIELDS.filter(field => field !== "opacity" && field !== "visibility")
      .map(field => [field, "rgb(39, 39, 42)"])) };
  const part = (flags, value) => ({ role: "control", expectedCount: 1, hit: true, ...flags,
    styles: [{ visible: true, values: {}, glyphs: [], textPaint: [], hit: { ...hit, ...value } }] });
  for (const [flags, sourceHit, actualHit, ok] of [
    [{}, {}, {}, true], [{}, {}, { shown: false, visibility: "hidden" }, false],
    [{}, {}, { rendered: false }, false], [{}, {}, { pointerEvents: "none" }, false],
    [{}, {}, { opacity: "0" }, false], [{}, {}, { color: "rgba(0, 0, 0, 0)" }, false],
    [{ overlay: true, transparent: true }, {}, { opacity: "0", color: "rgba(0, 0, 0, 0)" }, true],
    [{ overlay: true, transparent: true }, {}, { opacity: "1" }, false],
    [{ overlay: true, transparent: true }, { opacity: "0" }, { opacity: "0" }, false],
    [{}, { dateInternals: { "::-webkit-calendar-picker-indicator": { "line-height": "1" } } },
      { dateInternals: { "::-webkit-calendar-picker-indicator": { "line-height": "1", opacity: "0" } } }, false],
    [{}, { dateInternals: { "::-webkit-datetime-edit": { display: "inline-flex" } } }, { dateInternals: {} }, false],
  ]) {
    // When
    const failures = compareP1Style({ values, glyphs: [], descendants: [part(flags, sourceHit)] },
      { values, glyphs: [], descendants: [part(flags, actualHit)] });
    // Then
    assert.equal(failures.some(row => row.field.startsWith("descendants.control.0.hit.")), !ok, JSON.stringify(actualHit));
  }
});

test("P1 text paint checks every required channel across different token boundaries", () => {
  // Given
  const values = Object.fromEntries(P1_TEXT_FIELDS.map(field => [field, "original"]));
  const source = [{ text: "abcd", values }];
  const product = [{ text: "ab", values }, { text: "cd", values }];
  assert.deepEqual(compareTextPaint(source, product), []);
  for (const field of P1_TEXT_FIELDS) {
    const mutant = structuredClone(product);
    mutant[1].values[field] = "changed";
    // When
    const failures = compareTextPaint(source, mutant);
    // Then
    assert.ok(failures.some(row => row.field.endsWith(`.${field}`)), field);
  }
});
