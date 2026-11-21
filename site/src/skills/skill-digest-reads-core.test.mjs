import assert from "node:assert/strict";
import test from "node:test";
import { mergeDigestReads } from "./skill-digest-reads-core.ts";

test("digest rows merge across sources; unknown digest stays separate; total is the per-source distinct sum", () => {
  const a = { totalSessions: 3, rows: [
    { digest: "aaaa", sessions: 2, reads: 5, lastFirstReadMs: 100 }, { digest: null, sessions: 2, reads: 2, lastFirstReadMs: 50 }] };
  const b = { totalSessions: 1, rows: [{ digest: "aaaa", sessions: 1, reads: 1, lastFirstReadMs: 200 }] };
  const merged = mergeDigestReads([a, b]);
  assert.deepEqual(merged.rows, [
    { digest: "aaaa", sessions: 3, reads: 6, lastFirstReadMs: 200 }, { digest: null, sessions: 2, reads: 2, lastFirstReadMs: 50 }]);
  assert.equal(merged.totalSessions, 4);
  assert.equal(merged.sources, 2);
  assert.deepEqual(mergeDigestReads([]).rows, []);
});
