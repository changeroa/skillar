import test from "node:test";
import assert from "node:assert/strict";
import { availablePaint } from "../../scripts/uxb/widget-paint.mjs";
import { auditPaint } from "../../scripts/uxb/paint-audit.mjs";

const paint = {
  visible: true, opacity: "1", effectiveOpacity: 1, fillOpacity: "1",
  strokeOpacity: "1", dash: "none", strokeWidth: "2px", stroke: [39, 39, 42, 255],
};
const expected = { channels: ["stroke"], paint };
for (const [field, value] of [
  ["opacity", ".05"], ["effectiveOpacity", .05], ["fillOpacity", ".05"],
  ["strokeOpacity", ".05"], ["dash", "7px, 3px"], ["strokeWidth", "19px"],
  ["stroke", [1, 2, 3, 255]], ["visible", false],
]) {
  test(`rejects ${field} changes against the fixed reference`, () => {
    // Given
    assert.equal(availablePaint(paint, expected), true);
    // When
    const changed = { ...paint, [field]: value };
    // Then
    assert.equal(availablePaint(changed, expected), false);
  });
}
for (const field of ["opacity", "effectiveOpacity", "fillOpacity", "strokeOpacity", "dash", "stroke", "strokeWidth"]) {
  test(`rejects a reference missing required ${field}`, () => {
    // Given
    const reference = { ...paint };
    // When
    delete reference[field];
    // Then
    assert.equal(availablePaint(paint, { ...expected, paint: reference }), false);
  });
}
test("rejects a removed required paint part", () => {
  // Given
  const part = { index: 1, tag: "path", ...expected };
  const root = { querySelectorAll: () => [] };
  const head = { append() {} };
  const prior = globalThis.document;
  globalThis.document = { head, createElement: () => ({ remove() {} }) };
  try {
    // When
    const result = auditPaint(root, { observe: () => paint, available: availablePaint,
      required: { nodeCount: 2, parts: [part] } });
    // Then
    assert.ok(result.inventory.some(row => row.index === 1 && row.baseline.pass === false));
  } finally { globalThis.document = prior; }
});
