import test from "node:test";
import assert from "node:assert/strict";
import { componentStyleFields, compareComponentStyle, readComponentStyles } from "../../scripts/uxb/component-style.mjs";

for (const field of componentStyleFields) {
  test(`rejects changed or missing ${field} in a component state`, () => {
    // Given
    const reference = Object.fromEntries(componentStyleFields.map(name => [name, "reference"]));
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
  const root = { querySelectorAll: () => [] };
  // When
  const observations = readComponentStyles(root, ".required", componentStyleFields);
  // Then
  assert.deepEqual(observations, [{ missing: true, actual: null }]);
  assert.ok(compareComponentStyle(observations[0].actual, {}).every(row => !row.pass));
});
