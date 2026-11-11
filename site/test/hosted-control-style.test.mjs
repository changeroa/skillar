import assert from "node:assert/strict";
import { test } from "node:test";
import { assertHostedStyle, assertDemoConcordance, hostedDemoRecord, expectedHostedStyle, metricFields, numericFields, colorFields } from "../../scripts/uxb/hosted-control-style.mjs";

const source = {
  height: 32, ...Object.fromEntries(numericFields.map(key => [key, 4])),
  fontSize: 13, lineHeight: 20, fontWeight: 400, opacity: 1,
  ...Object.fromEntries(colorFields.map(key => [key, [24, 24, 27, 255]])),
  focusVisible: false, outlineWidth: 0, outlineStyle: "none", outlineOffset: 0, outlineColor: null,
  shadows: [], disabled: false, checked: false,
};

test("hosted style gate rejects every missing or changed metric", () => {
  // Given a complete reference and matching computed values.
  for (const required of ["height", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "fontSize", "lineHeight", "fontWeight", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
    "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
    "focusVisible", "outlineWidth", "outlineStyle", "outlineOffset", "outlineColor", "shadows"])
    assert.ok(metricFields.includes(required), required);
  assertHostedStyle(source, source);
  for (const key of metricFields) {
    // When one machine-consumed metric is missing or changed.
    const missing = { ...source }; delete missing[key];
    const changed = { ...source, [key]: typeof source[key] === "number" ? source[key] + 2 :
      typeof source[key] === "boolean" ? !source[key] : Array.isArray(source[key]) ? [1, 2, 3, 4] : "changed" };
    // Then neither omission nor a difference can pass.
    assert.throws(() => assertHostedStyle(missing, source), assert.AssertionError);
    assert.throws(() => assertHostedStyle(changed, source), assert.AssertionError);
  }
});

test("owner policy changes only exact authorized metrics", () => {
  // Given measured source values and an explicit coarse-pointer/focus policy.
  const policy = { control: "primary", state: "focus-visible", interactive: true, width: 390, accent: [78, 70, 229, 255] };
  // When owner overrides are applied.
  const { expected } = expectedHostedStyle(source, policy);
  // Then geometry and ring change, while all type/padding/radius/border metrics remain source-exact.
  assert.equal(expected.height, 44);
  assert.equal(expected.outlineWidth, 2);
  assert.deepEqual(expected.outlineColor, policy.accent);
  for (const key of [...numericFields, ...colorFields]) assert.deepEqual(expected[key], source[key], key);
  assert.throws(() => assertHostedStyle({ ...expected, height: 60 }, expected), assert.AssertionError);
  assert.throws(() => assertHostedStyle({ ...expected, paddingLeft: expected.paddingLeft + 4 }, expected), assert.AssertionError);
});

test("pinned fallback cannot drift from available live Demo metrics", () => {
  // Given uniform live-Demo fields and a matching source render.
  const record = { id: "source", bounds: { height: 32 }, styles: {
    height: "32px",
    ...Object.fromEntries(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontSize", "lineHeight", "fontWeight", "opacity"].map(key => [key, String(source[key])])),
    borderRadius: "4px", borderWidth: "4px", borderColor: "rgb(24, 24, 27)",
  } };
  assertDemoConcordance(source, record, { width: 1440, control: "secondary" });
  // When source padding, type or token-exact border ink drifts.
  for (const changed of [{ paddingLeft: 8 }, { fontWeight: 500 }, { borderTopColor: [25, 24, 27, 255] }]) {
    // Then the source audit rejects the fallback before it can define a passing target.
    assert.throws(() => assertDemoConcordance({ ...source, ...changed }, record, { width: 1440, control: "secondary" }), assert.AssertionError);
  }
});

test("only the documented Alert state may omit a real Demo reference", () => {
  for (const control of ["primary", "danger", "disabled", "input", "summary", "panel", "skeleton",
    "secondary", "danger-quiet", "select", "checkbox"]) {
    const spec = { control, state: "default", width: 1440, theme: "light" };
    assert.throws(() => hostedDemoRecord(spec, [], []), assert.AssertionError);
    const record = { id: `${control}-default-light-1440`, reference: source };
    assert.equal(hostedDemoRecord(spec, [], [record]), record);
  }
  assert.equal(hostedDemoRecord({ control: "status", state: "default", width: 390, theme: "dark" }, [], []), null);
  assert.throws(() => hostedDemoRecord({ control: "status", state: "hover", width: 390, theme: "dark" }, [], []),
    assert.AssertionError);
  const old = { id: "34-skeleton-row", theme: "light" };
  assert.equal(hostedDemoRecord({ control: "skeleton", state: "default", width: 390, theme: "light" }, [old], []), old);
});

test("one-line native Card height derives from real source chrome and line box", () => {
  const card = { ...source, height: 338, paddingTop: 16, paddingBottom: 16,
    borderTopWidth: 1, borderBottomWidth: 1, fontSize: 16, lineHeight: 24 };
  const { expected } = expectedHostedStyle(card, { control: "panel", interactive: false });
  assert.equal(expected.height, 58);
  for (const key of metricFields.filter(key => key !== "height")) assert.deepEqual(expected[key], card[key], key);
  assert.throws(() => assertHostedStyle({ ...expected, height: 338 }, expected), assert.AssertionError);
});
