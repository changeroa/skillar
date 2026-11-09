import assert from "node:assert/strict";
import test from "node:test";
import { comparePixels } from "../../scripts/uxb/image-diff.mjs";
import { metricFailures } from "../../scripts/uxb/metrics.mjs";
import { manifestSchema } from "../../scripts/uxb/manifest.mjs";
import { inspectReferencePixels } from "../../scripts/uxb/reference-pixels.mjs";

test("checked reference rejects a light fragment instead of the control", () => {
  // Given: the old defective crop contains slightly different light pixels.
  const pixels = new Uint8Array(22 * 22 * 4).fill(255);
  pixels[0] = 244;
  // When
  const result = inspectReferencePixels(pixels, 22, 22, { control: "Checkbox", checked: true });
  // Then
  assert.equal(result.pass, false);
});

test("reference capture rejects uniform blank images", () => {
  // Given
  const pixels = new Uint8Array(22 * 22 * 4).fill(255);
  // When
  const result = inspectReferencePixels(pixels, 22, 22, { control: "Input" });
  // Then
  assert.equal(result.pass, false);
});

test("checked reference accepts contrasting fill and check", () => {
  // Given
  const pixels = new Uint8Array(22 * 22 * 4).fill(255);
  const center = (10 * 22 + 10) * 4;
  pixels.set([24, 24, 27, 255], center);
  // When
  const result = inspectReferencePixels(pixels, 22, 22, { control: "Checkbox", checked: true });
  // Then
  assert.equal(result.pass, true);
});

test("pixel comparison detects alpha-only differences", () => {
  // Given: equal RGB values with different opacity.
  const reference = new Uint8Array([10, 20, 30, 255]);
  // When: comparing a transparent pixel.
  const result = comparePixels(reference, new Uint8Array([10, 20, 30, 0]));
  // Then: the pixel is a difference, not a false fidelity pass.
  assert.equal(result.diffRatio, 1);
});

test("geometry tolerance does not tolerate color mismatches", () => {
  // Given: near-identical geometry but a different border token.
  const actual = { height: 32.5, borderColor: "rgb(0, 0, 0)" };
  // When: applying the component contract.
  const failures = metricFailures(actual, { height: 32, borderColor: "rgb(255, 255, 255)" });
  // Then: only the exact color mismatch fails.
  assert.deepEqual(failures.map(item => item.property), ["borderColor"]);
});

test("raster tolerance preserves alpha and meaningful color differences", () => {
  // Given: RGB rounding, larger RGB drift, and a one-step alpha difference.
  const reference = new Uint8Array([10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255]);
  // When: allowing an explicitly declared two-step RGB rounding tolerance.
  const result = comparePixels(reference, new Uint8Array([12, 20, 30, 255, 13, 20, 30, 255, 10, 20, 30, 254]), 2);
  // Then: rounding is measured but only RGB drift and changed alpha fail.
  assert.equal(result.rawDiffPixels, 3);
  assert.equal(result.diffPixels, 2);
});

test("unknown interaction actions cannot silently become resting captures", () => {
  // Given: an otherwise valid capture manifest.
  const input = { profiles: [{ id: "desktop", width: 1440, height: 900 }],
    pages: [{ id: "fixture", url: "http://localhost/", ready: "main",
      states: [{ name: "hover", selector: "button", action: "typo" }] }] };
  // When: parsing the manifest boundary.
  const result = manifestSchema.safeParse(input);
  // Then: the unsupported action is rejected.
  assert.equal(result.success, false);
});

test("isolated focus capture retains the outer shell and inner focus target", () => {
  // Given: a search shell whose input receives keyboard focus.
  const input = { isolateSpecimens: true, profiles: [{ id: "phone", width: 390, height: 844 }],
    pages: [{ id: "fixture", url: "http://localhost/", ready: "main",
      states: [{ name: "search-focus", selector: ".search", focusSelector: ".search input", action: "focus" }] }] };
  // When: parsing the executable capture contract.
  const result = manifestSchema.parse(input);
  // Then: focus and crop targets remain distinct and isolation is not stripped.
  assert.equal(result.isolateSpecimens, true);
  assert.equal(result.pages[0].states[0].selector, ".search");
  assert.equal(result.pages[0].states[0].focusSelector, ".search input");
  assert.equal(result.pages[0].states[0].action, "focus");
});

test("clipboard state captures retain their asynchronous action and distinct click target", () => {
  // Given: a whole feedback region, not just its button.
  const input = { profiles: [{ id: "desktop", width: 1440, height: 900 }],
    pages: [{ id: "fixture", url: "http://localhost/", ready: "main",
      states: [{ name: "copy-error", selector: ".copy", actionSelector: ".copy button", action: "copy-error" }] }] };
  // When
  const state = manifestSchema.parse(input).pages[0].states[0];
  // Then
  assert.equal(state.action, "copy-error");
  assert.equal(state.selector, ".copy");
  assert.equal(state.actionSelector, ".copy button");
});

test("explicit corner tolerance rejects interior drift and all alpha drift", () => {
  const reference = new Uint8Array(10 * 10 * 4).fill(255), actual = reference.slice();
  actual[(1 * 10 + 1) * 4] -= 8;
  actual[(5 * 10 + 5) * 4] -= 8;
  actual[(1 * 10 + 8) * 4 + 3] -= 1;
  const result = comparePixels(reference, actual, 0,
    { width: 10, height: 10, inset: 1, radius: 2, tolerance: 8 });
  assert.equal(result.rawDiffPixels, 3);
  assert.equal(result.acceptedCornerPixels, 1);
  assert.equal(result.diffPixels, 2);
  assert.deepEqual(result.maxPerChannelDelta, [8, 0, 0, 1]);
});
