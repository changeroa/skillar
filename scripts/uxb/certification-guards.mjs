import assert from "node:assert/strict";

/** The identical predicate is used for normal and mutated observations. */
export function measurement(actual, expected, tolerance = 0) {
  const pass = typeof actual === "number" && typeof expected === "number"
    ? Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance
    : actual !== undefined && expected !== undefined && JSON.stringify(actual) === JSON.stringify(expected);
  return { actual, expected, tolerance, pass };
}

export function mutationVerdict(baseline, mutated, applied) {
  return { baseline, mutated, applied,
    rejected: applied === true && baseline.pass === true && mutated.pass === false };
}

export function assertCertification({ cases, expectedCases, measurements, mutations }) {
  assert.ok(expectedCases.length > 0);
  assert.deepEqual([...cases].sort(), [...expectedCases].sort());
  assert.equal(new Set(cases).size, cases.length);
  assert.ok(measurements.length > 0);
  assert.ok(mutations.length > 0);
  assert.equal(measurements.filter(row => row.pass !== true).length, 0, "Failed or missing measurements");
  assert.equal(mutations.filter(row => row.rejected !== true).length, 0, "Unrejected or unapplied mutations");
  for (const id of expectedCases) {
    assert.ok(measurements.some(row => row.caseId === id), `Missing measurements for ${id}`);
    assert.ok(mutations.some(row => row.caseId === id), `Missing mutation for ${id}`);
  }
  return { cases: cases.length, measurements: measurements.length, mutations: mutations.length,
    measurementFailures: 0, mutationFailures: 0 };
}
