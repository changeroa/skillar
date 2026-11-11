import test from "node:test";
import assert from "node:assert/strict";
import { compareComponentStyle } from "../../scripts/uxb/component-style.mjs";

const required = [
  "height", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontSize", "lineHeight", "fontWeight", "borderRadius",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "outlineColor", "outlineStyle", "outlineWidth", "outlineOffset", "boxShadow",
];
for (const field of required) {
  test(`rejects changed or missing ${field} in a component state`, () => {
    // Given
    const reference = Object.fromEntries(required.map(name => [name, "reference"]));
    assert.ok(compareComponentStyle(reference, reference).every(row => row.pass));
    // When
    const changed = { ...reference, [field]: "changed" };
    const removed = { ...reference };
    delete removed[field];
    // Then
    assert.ok(compareComponentStyle(changed, reference).some(row => !row.pass));
    assert.ok(compareComponentStyle(removed, reference).some(row => !row.pass));
    assert.ok(compareComponentStyle(reference, removed).some(row => !row.pass));
  });
}
test("retains a failed required target when the selector matches nothing", () => {
  // Given
  const reference = Object.fromEntries(required.map(field => [field, "reference"]));
  // When
  const measurements = compareComponentStyle(null, reference);
  // Then
  assert.equal(measurements.length, required.length);
  assert.ok(measurements.every(row => !row.pass));
});
