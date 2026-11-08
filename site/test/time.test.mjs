import assert from "node:assert/strict";
import test from "node:test";
import { kstDay, shortKstDate } from "../src/time.ts";

for (const [timestamp, expected] of [
  ["2026-11-04T14:59:59.999Z", "2026-11-04"],
  ["2026-11-04T15:00:00.000Z", "2026-11-05"],
  ["2026-12-31T14:59:59.999Z", "2026-12-31"],
  ["2026-12-31T15:00:00.000Z", "2027-01-01"],
  ["2028-02-28T15:00:00.000Z", "2028-02-29"],
]) {
  test(`KST day is ${expected} at ${timestamp}`, () => {
    // Given
    const milliseconds = Date.parse(timestamp);
    // When
    const day = kstDay(milliseconds);
    // Then
    assert.equal(day, expected);
  });
}

test("short KST date rolls over with the day key rather than the browser timezone", () => {
  // Given
  const milliseconds = Date.parse("2026-12-31T15:00:00.000Z");
  // When
  const date = shortKstDate(milliseconds);
  // Then
  assert.equal(date, "1/1");
});
