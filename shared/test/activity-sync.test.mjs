import assert from "node:assert/strict";
import test from "node:test";
import * as sync from "../dist/activity-sync.js";
const row = (key, values) => ({
  table: "events", key, revision: 0, operation: "upsert", sourceOrder: 0, values,
});
test("canonical snapshot hashes preserve full values but ignore object and page order", async () => {
  // Given historical rows with unknown boundaries and opaque vectors.
  const a = row('["a"]', { id: "a", text: "한글🙂", recording_orders_json: '{"old":0}', ts: 0 });
  const b = row('["b"]', { id: "b", ts: 0 });
  // When both orders and a reordered values object are summarized.
  const first = await sync.summarizeSnapshot([a, b]);
  const second = await sync.summarizeSnapshot([b, { ...a, values: { ts: 0,
    recording_orders_json: '{"old":0}', text: "한글🙂", id: "a" } }]);
  // Then the exact same content is canonical, but any full value change alters the hash.
  assert.deepEqual(first, second);
  assert.equal(first.counts.events, 2);
  assert.equal(Object.keys(first.counts).length, 15);
  assert.notEqual((await sync.summarizeSnapshot([{ ...a, sourceOrder: null }, b])).snapshotHash, first.snapshotHash);
  await assert.rejects(sync.summarizeSnapshot([a, a]), { code: "snapshot_integrity" });
});
test("snapshot baseline permits revision zero while bounding pages and explicit cut consent", async () => {
  // Given a complete fifteen-table count vector and historical cut zero.
  const summary = await sync.summarizeSnapshot([row("a", { ts: 0 })]);
  const begin = {
    schemaVersion: 1, snapshotId: "s", deviceId: "d", sourceDomain: "source", generation: 1,
    consentVersion: 1, projectId: "p", rootId: null, range: { fromMs: 0, toMs: 1 },
    backfill: { version: 1, snapshotId: "s", journalCut: 0 },
    cut: 0, pageCount: 1, counts: summary.counts, snapshotHash: summary.snapshotHash,
  };
  // When parsing the baseline and malformed alternatives.
  assert.equal(sync.migrationBeginSchema.parse(begin).cut, 0);
  // Then zero is preserved; missing tables, false cut consent and unbounded pages fail.
  assert.equal(sync.migrationBeginSchema.safeParse({ ...begin, counts: {} }).success, false);
  assert.equal(sync.migrationBeginSchema.safeParse({ ...begin, cut: 1 }).success, false);
  assert.equal(sync.migrationBeginSchema.safeParse({ ...begin, pageCount: 129 }).success, false);
  assert.equal(sync.snapshotPageDocumentSchema.safeParse({
    schemaVersion: 2, rows: Array.from({ length: 101 }, (_, i) => row(String(i), {})),
  }).success, false);
});
