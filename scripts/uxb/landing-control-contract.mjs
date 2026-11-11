import assert from "node:assert/strict";
import { assertHostedStyle } from "./hosted-control-style.mjs";

/** Only the owner's brand, standalone target and visible-focus overrides differ. */
export function expectedLandingControl(source, policy) {
  const expected = structuredClone(source);
  const brand = policy.theme === "light" ? [180, 50, 28, 255] : [255, 143, 112, 255];
  const onBrand = policy.theme === "light" ? [255, 255, 255, 255] : [35, 17, 12, 255];
  expected.height = policy.width === 390 ? 44 : 32;
  if (policy.control === "primary") {
    assert.ok(Array.isArray(policy.primaryFill), "Chrome-decoded approved brand fill is required");
    expected.backgroundColor = policy.primaryFill;
    expected.color = onBrand;
  }
  if (policy.control === "link" && policy.onMuted &&
      (policy.width === 390 || !["hover", "active"].includes(policy.state))) {
    expected.color = policy.theme === "light" ? [82, 82, 91, 255] : [158, 158, 158, 255];
  }
  expected.focusVisible = policy.state === "focus-visible";
  expected.outlineWidth = expected.focusVisible ? 2 : 0;
  expected.outlineStyle = expected.focusVisible ? "solid" : "none";
  expected.outlineOffset = expected.focusVisible ? 2 : 0;
  expected.outlineColor = expected.focusVisible ? brand : null;
  expected.shadows = [];
  return expected;
}

export function assertLandingControl(actual, source, policy) {
  assert.equal(actual.height, policy.width === 390 ? 44 : 32, "absolute 32px/44px owner target");
  assertHostedStyle(actual, expectedLandingControl(source, policy), policy.id);
}
