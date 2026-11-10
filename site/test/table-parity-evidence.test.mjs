import test from "node:test";
import assert from "node:assert/strict";
import { compareTableCase, compareTableMatrix } from "../../scripts/uxb/validate-table-parity.mjs";

const colors = { black: [0, 0, 0, 255], white: [255, 255, 255, 255], red: [255, 0, 0, 255] };
function part(height, width = 32) {
  return { effectiveOpacity: 1, disabled: false, checked: true,
    box: { height, width, left: 13 }, styles: {
      fontFamily: "sans-serif", fontSize: "13px", fontWeight: "400", lineHeight: "20px",
      letterSpacing: "normal", color: "black", backgroundColor: "white", borderRadius: "0px",
      ...Object.fromEntries(["Top", "Right", "Bottom", "Left"].flatMap(edge =>
        [[`padding${edge}`, "0px"], [`border${edge}Width`, "0px"], [`border${edge}Color`, "black"]])),
    } };
}
function toolbar(height) {
  return { app: "site", family: "Toolbar", state: "default", theme: "light",
    semantic: { theme: "light", viewport: [1440, 900], dpr: 1, coarse: false,
      parts: { columnsTrigger: part(height, 80), densityTrigger: part(height, height) } } };
}

for (const minimum of [32, 44]) test(`owner ${minimum}px wins over an identical upstream size`, () => {
  const actual = toolbar(minimum), reference = toolbar(minimum);
  const compare = () => compareTableCase(actual, reference, [reference], { colors, minimum });
  assert.equal(compare().pass, true);
  for (const record of [actual, reference]) for (const node of Object.values(record.semantic.parts))
    node.box.height = 60;
  const result = compare();
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures.map(failure => failure.expected), [minimum, minimum]);
});

test("column item paint mutations fail for disabled and enabled rows", () => {
  const actual = toolbar(32); actual.family = "ColumnVisibility"; actual.state = "open";
  actual.semantic.parts = { container: { ...part(160), box: { left: 0 } },
    item: part(32), itemLabel: part(20), checkbox: part(16, 16),
    enabledItem: part(32), enabledLabel: part(20), enabledCheckbox: part(16, 16) };
  const reference = structuredClone(actual);
  const compare = () => compareTableCase(actual, reference, [reference], { colors });
  assert.equal(compare().pass, true);
  for (const name of ["item", "enabledItem"]) {
    actual.semantic.parts[name].styles.backgroundColor = "red";
    assert.equal(compare().failures.some(failure => failure.part === name &&
      failure.property === "backgroundColor"), true);
    actual.semantic.parts[name].styles.backgroundColor = "white";
  }
  assert.equal(compare().pass, true);
});

test("an incomplete state manifest fails closed", () => {
  assert.throws(() => compareTableMatrix({ cases: [], references: [], colors }), /Missing or duplicate/);
});
