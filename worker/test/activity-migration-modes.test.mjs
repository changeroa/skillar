import assert from "node:assert/strict";
import test from "node:test";
import { fixture, snapshot, ref, packet } from "./helpers/activity-migrations.mjs";

const row = (text, revision) => ({
  table: "events", key: "event", revision, operation: "upsert", sourceOrder: 1,
  values: { id: "event", ts: 100, text },
});
const document = rows => ({ schemaVersion: 2, rows });

test("future-only consent starts at an explicit empty cut without sending historical content", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const prepared = await snapshot(f, [document([])], {
    cut: 7, backfill: null, range: { fromMs: 1000, toMs: 2000 },
  });
  await f.consent(prepared.begin, {
    backfill: undefined, grantedAtMs: 1000, contentKinds: ["prompt"],
  });
  for (const p of prepared.packets) for (const upload of p.uploads) {
    upload.range = prepared.begin.range;
  }
  assert.equal((await f.send("begin", prepared.begin)).status, 200);
  assert.equal((await prepared.stage(0)).status, 200);
  const completed = await f.send("complete", ref(prepared.begin));
  assert.equal(completed.status, 200);
  assert.equal(completed.body.accepted, true);
  assert.deepEqual(completed.body.cursor, { sequence: 0, journalThrough: 7, changeSeq: 1 });
  const exported = await f.send("export", { ...ref(prepared.begin), page: 0 });
  assert.deepEqual(exported.body.document, document([]));
  const future = await packet(document([{
    table: "sessions", key: "a".repeat(64), revision: 8, operation: "upsert",
    sourceOrder: 2, values: { started_at: 1500, first_prompt: "explicit future prompt" },
  }]), { batchId: "future", from: 7, through: 8 });
  future.batch.range = prepared.begin.range;
  for (const upload of future.uploads) {
    upload.range = prepared.begin.range;
    assert.equal((await f.send("chunk", upload)).status, 200);
  }
  assert.equal((await f.send("cdc", future.batch)).status, 200);
});

test("explicit historical backfill never resets a concurrently advancing live cursor or accepted data", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const initial = await snapshot(f, [document([row("baseline", 7)])], { cut: 7 });
  await f.send("begin", initial.begin);
  await initial.stage(0);
  assert.equal((await f.send("complete", ref(initial.begin))).body.accepted, true);
  const live = await packet(document([row("newer live value", 8)]), {
    batchId: "live-1", from: 7, through: 8,
  });
  live.batch.backfill = initial.begin.backfill;
  for (const upload of live.uploads) {
    upload.backfill = initial.begin.backfill;
    assert.equal((await f.send("chunk", upload)).status, 200);
  }
  const acceptedLive = await f.send("cdc", live.batch);
  assert.equal(acceptedLive.status, 200);
  const historical = await snapshot(f, [document([row("historical cut value", 7)])], {
    cut: 7, snapshotId: "historical", purpose: "backfill",
  });
  assert.equal((await f.send("begin", historical.begin)).status, 200);
  assert.equal((await historical.stage(0)).status, 200);
  const completed = await f.send("complete", ref(historical.begin));
  assert.equal(completed.body.cursor.sequence, 1);
  assert.equal(completed.body.cursor.journalThrough, 8);
  assert.deepEqual((await f.rows("SELECT sequence,journal_through FROM device_streams"))[0],
    { sequence: 1, journal_through: 8 });
  assert.equal((await f.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 1);
  const rolledBack = await f.send("rollback", ref(historical.begin));
  assert.equal(rolledBack.body.accepted, true);
  assert.equal(rolledBack.body.rollbackRequested, true);
  assert.deepEqual((await f.rows("SELECT sequence,journal_through FROM device_streams"))[0],
    { sequence: 1, journal_through: 8 });
  const exported = await f.send("export", { ...ref(historical.begin), page: 0 });
  assert.deepEqual(exported.body.document, document([row("historical cut value", 7)]));
});

test("a large raw row uses multiple encrypted chunks rather than the metadata HTTP size ceiling", { timeout: 30000 }, async t => {
  const f = await fixture(t), large = document([row("한글 raw args ".repeat(30000), 7)]);
  const prepared = await snapshot(f, [large], { cut: 7 });
  assert.ok(prepared.packets[0].uploads.length > 1);
  assert.ok(prepared.packets[0].page.totalBytes > 256 * 1024);
  assert.equal((await f.send("begin", prepared.begin)).status, 200);
  assert.equal((await prepared.stage(0)).status, 200);
  assert.equal((await f.send("complete", ref(prepared.begin))).body.accepted, true);
  assert.deepEqual((await f.send("export", { ...ref(prepared.begin), page: 0 })).body.document, large);
});
