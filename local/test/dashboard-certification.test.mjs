import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { paintChannels } from "../../scripts/uxb/widget-paint.mjs";
import { focusPaintOwner } from "../../scripts/uxb/focus-paint.mjs";
import { measurement, mutationVerdict, assertCertification } from "../../scripts/uxb/certification-guards.mjs";
import { ownerControlHeight } from "../../scripts/uxb/widget-visual-guards.mjs";

test("certification rejects every failed or absent measurement", () => {
  for (const pass of [false, undefined]) {
    const records = { cases: ["a"], expectedCases: ["a"], measurements: [{ caseId: "a", pass }],
      mutations: [{ caseId: "a", rejected: true }] };
    assert.throws(() => assertCertification(records), assert.AssertionError);
  }
});

test("mutation rejection requires a passing baseline and an actual failed mutated verdict", () => {
  const baseline = measurement(32, 32), changed = measurement(60, 32);
  assert.equal(mutationVerdict(baseline, changed, true).rejected, true);
  for (const [normal, mutated, applied] of [[changed, changed, true], [baseline, baseline, true], [baseline, changed, false]])
    assert.equal(mutationVerdict(normal, mutated, applied).rejected, false);
});

test("the owner size predicate rejects measured 60px on desktop and touch", () => {
  for (const device of [{ width: 1440, coarse: false }, { width: 390, coarse: true }]) {
    const normal = ownerControlHeight(device.coarse ? 44 : 32, device);
    const changed = ownerControlHeight(60, device);
    assert.equal(mutationVerdict(normal, changed, true).rejected, true);
  }
});

test("certification rejects missing cases and unrejected mutations", () => {
  const records = { cases: ["a"], expectedCases: ["a"], measurements: [{ caseId: "a", pass: true }],
    mutations: [{ caseId: "a", rejected: false }] };
  assert.throws(() => assertCertification(records), assert.AssertionError);
  assert.throws(() => assertCertification({ ...records, cases: [] }), assert.AssertionError);
});

test("unpainted tooltip pseudo-elements are not visible paint channels", () => {
  const channels = runInNewContext(`(${paintChannels.toString()})`, { SVGElement: class {} });
  const node = { childNodes: [{ nodeType: 3, textContent: "label" }] };
  const pseudo = { content: '"tooltip"', display: "block", visibility: "visible", opacity: "1",
    backgroundColor: [0, 0, 0, 255], backgroundImage: "none" };
  const paint = { color: [0, 0, 0, 255], backgroundImage: "none",
    pseudo: { before: { ...pseudo, content: "none" }, after: pseudo } };
  assert.equal(channels(node, paint).includes("pseudo:after"), true);
  for (const hidden of [{ opacity: "0" }, { display: "none" }, { visibility: "hidden" }])
    assert.equal(channels(node, { ...paint, pseudo: { ...paint.pseudo, after: { ...pseudo, ...hidden } } }).includes("pseudo:after"), false);
});

test("native checkbox focus belongs to the input, not adjacent prose", () => {
  const prose = { matches: () => false };
  const input = { matches: selector => selector.startsWith("input"), nextElementSibling: prose };
  assert.equal(focusPaintOwner(input), input);
  const box = { matches: selector => selector === ".lf-checkbox__box" };
  assert.equal(focusPaintOwner({ ...input, nextElementSibling: box }), box);
  const wrapper = {};
  assert.equal(focusPaintOwner({ matches: selector => selector === ".lf-select", closest: () => wrapper }), wrapper);
});
