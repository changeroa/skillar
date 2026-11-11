import assert from "node:assert/strict";
import test from "node:test";
import { assertLandingControl, expectedLandingControl } from "../../scripts/uxb/landing-control-contract.mjs";
import { numericFields, colorFields, metricFields } from "../../scripts/uxb/hosted-control-style.mjs";

const reference = {
  ...Object.fromEntries(numericFields.map(key => [key, 0])),
  ...Object.fromEntries(colorFields.map(key => [key, [0, 0, 0, 255]])),
  height: 32, fontSize: 13, lineHeight: 20, fontWeight: 400, opacity: 1,
  focusVisible: false, outlineWidth: 0, outlineStyle: "none", outlineOffset: 0,
  outlineColor: null, shadows: [], disabled: false, checked: false,
};
const policy = { id: "outline", width: 1440, theme: "light", state: "default", control: "outline" };

for (const field of metricFields) test(`landing comparator rejects a changed ${field}`, () => {
  // Given a source-aligned control with one independently corrupted metric.
  const actual = structuredClone(reference);
  const value = actual[field];
  const colorMutation = colorFields.includes(field) || field === "outlineColor";
  actual[field] = colorMutation ? [1, 2, 3, 255] :
    typeof value === "number" ? value + 2 : typeof value === "boolean" ? !value :
      typeof value === "string" ? `${value}-corrupt` : [1];
  // When / Then the real acceptance predicate must reject the corruption.
  assert.throws(() => assertLandingControl(actual, reference, policy), colorMutation ? {
    name: "AssertionError",
    actual: [{ property: field, expected: value, actual: [1, 2, 3, 255] }],
    expected: [],
  } : undefined);
});

test("upstream and product agreement cannot override absolute touch height", () => {
  // Given an equally wrong 60px reference and product on a phone.
  const oversized = { ...reference, height: 60 };
  // When / Then matching upstream still fails the owner's 44px contract.
  assert.throws(() => assertLandingControl(oversized, oversized, { ...policy, width: 390 }));
});

test("brand adaptation retains source typography and requires decoded approved paint", () => {
  // Given a dark primary source and an independently decoded approved brand fill.
  const primary = { ...policy, control: "primary", theme: "dark", primaryFill: [255, 143, 112, 255] };
  // When the permitted owner differences are applied.
  const expected = expectedLandingControl(reference, primary);
  // Then paint changes while source typography and border geometry survive.
  assert.deepEqual(expected.backgroundColor, [255, 143, 112, 255]);
  assert.deepEqual(expected.color, [35, 17, 12, 255]);
  assert.equal(expected.fontSize, 13);
  assert.equal(expected.lineHeight, 20);
  assert.equal(expected.borderTopLeftRadius, 0);
  assert.throws(() => expectedLandingControl(reference, { ...primary, primaryFill: undefined }));
});

test("muted-surface link contrast adaptation preserves ordinary link paint", () => {
  // Given the same source link on two different surface contexts.
  const link = { ...policy, control: "link", onMuted: true };
  // When the accessibility policy is applied.
  const onMuted = expectedLandingControl(reference, link);
  const onCanvas = expectedLandingControl(reference, { ...link, onMuted: false });
  // Then only the muted-surface rest ink changes.
  assert.deepEqual(onMuted.color, [82, 82, 91, 255]);
  assert.deepEqual(onCanvas.color, [0, 0, 0, 255]);
  assert.deepEqual(expectedLandingControl(reference, { ...link, state: "hover" }).color, [0, 0, 0, 255]);
});
