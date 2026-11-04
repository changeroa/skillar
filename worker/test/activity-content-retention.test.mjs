import assert from "node:assert/strict";
import test from "node:test";
import { fixture, packet, principal, snapshot, ref } from "./helpers/activity-content-retention.mjs";
import { packet as runtimePacket } from "./helpers/activity-runtime.mjs";

const DAY = 86_400_000, START = 10000;
const document = (revision = 7) => ({ schemaVersion: 2, rows: [{
  table: "events", key: "event", revision, operation: "upsert", sourceOrder: 1,
  values: { id: "event", ts: 100, text: "RETAINED_SOURCE" },
}] });
const read = f => f.send("readCdc", { sourceDomain: "source", batchId: "batch-1" });
const clock = (f, nowMs) => f.send("clock", { nowMs });
const exported = (f, consentVersion = 1) => f.send("sourceExport", {
  deviceId: "device-a", sourceDomain: "source", generation: 1, consentVersion,
  projectId: "project", rootId: null, range: { fromMs: 0, toMs: 1000 },
  backfill: null, afterSequence: 0,
}, principal({ scopes: ["activity:read"] }));

test("128 committed chunks remain readable within the paid D1 invocation query budget", async t => {
  const f = await fixture(t), value = document();
  value.rows[0].values.text = "";
  const emptyBytes = Buffer.byteLength(JSON.stringify(value));
  value.rows[0].values.text = "a".repeat(4096 - emptyBytes);
  const p = await packet(value, { chunkBytes: 32 });
  assert.equal(p.uploads.length, 128);
  assert.equal((await f.upload(p)).status, 200);
  const result = await f.send("budgetReads");
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.deepEqual(result.body, { chunks: 128, queries: 640 });
});

test("source upload-age boundary denies direct reads and export without cron", async t => {
  // Given an ordinary committed source whose source timestamp is historical.
  const f = await fixture(t), p = await packet(document());
  assert.equal((await f.upload(p)).status, 200);
  const [chunk] = await f.rows("SELECT * FROM content_uploads");
  await clock(f, START + 30 * DAY - 1);
  assert.equal((await read(f)).status, 200);
  assert.equal((await exported(f)).status, 200);
  // When upload age reaches the exact expiry.
  await clock(f, START + 30 * DAY);
  // Then both public export logic and immutable-descriptor reads reject existing R2 bytes.
  assert.equal((await read(f)).body.error, "content_expired");
  assert.equal((await exported(f)).body.error, "content_expired");
  assert.equal((await f.send("direct", { chunk })).body.error, "content_expired");
  assert.equal((await f.send("gets", {})).body.gets, 0);
  assert.ok(await f.bucket.get(chunk.object_key));
});

for (const field of ["contentDays", "projectionDays"]) {
  test(`shorter current ${field} limits original grant without resetting age`, async t => {
    // Given an original long grant and already-uploaded source.
    const f = await fixture(t), p = await packet(document());
    await f.grant({ retention: { contentDays: 90, projectionDays: 90, backupDays: 30 } });
    assert.equal((await f.upload(p)).status, 200);
    await clock(f, START + DAY);
    // When a new covering grant shortens one retention dimension.
    await f.grant({ retention: { contentDays: 90, projectionDays: 90, backupDays: 30, [field]: 1 } }, 2);
    // Then it expires from original upload age, not renewal time.
    assert.equal((await exported(f, 2)).body.error, "content_expired");
    assert.deepEqual((await f.send("sourceSweep", {})).body, { scanned: 1, deleted: 1 });
    assert.equal((await f.bucket.list()).objects.length, 0);
  });
}

test("long legal retention survives default thirty days but renewal cannot extend original TTL", async t => {
  // Given explicit 90 day retention, not the default.
  const f = await fixture(t), p = await packet(document());
  await f.grant({ retention: { contentDays: 90, projectionDays: 90, backupDays: 30 } });
  assert.equal((await f.upload(p)).status, 200);
  await clock(f, START + 31 * DAY);
  // When scanning beyond the default, then granting an even longer current duration.
  assert.deepEqual((await f.send("sourceSweep", {})).body, { scanned: 1, deleted: 0 });
  await f.grant({ retention: { contentDays: 180, projectionDays: 180, backupDays: 30 } }, 2);
  assert.equal((await exported(f, 2)).status, 200);
  await clock(f, START + 90 * DAY);
  // Then the original 90 day cap still applies.
  assert.equal((await exported(f, 2)).body.error, "content_expired");
});

for (const afterGet of ["expiry", "terminal", "shorter", "fence"]) {
  test(`direct read rechecks ${afterGet} after awaited R2 GET`, async t => {
    // Given live encrypted bytes and a deterministic mutation inside the real GET boundary.
    const f = await fixture(t), p = await packet(document());
    assert.equal((await f.upload(p)).status, 200);
    const [chunk] = await f.rows("SELECT * FROM content_uploads");
    if (afterGet === "shorter") await clock(f, START + 2 * DAY);
    // When GET returns after expiry, terminal intent, shorter retention or generation closure.
    const result = await f.send("direct", { chunk, afterGet, expireAtMs: START + 30 * DAY });
    // Then no decrypted content escapes.
    assert.equal(result.body.error, afterGet === "fence" ? "tenant_fenced" : "content_expired");
    assert.equal((await f.send("gets", {})).body.gets, 1);
  });
}

test("exact retry preserves age receipts source cursor and newer typed metadata", async t => {
  // Given a committed source with a typed event projection.
  const f = await fixture(t);
  const mutation = revision => ({
    entity: "event", key: "a".repeat(64), revision,
    facts: { sessionId: "c".repeat(64), kind: "prompt", status: "succeeded",
      inputTokens: 0, outputTokens: 0,
      timestampMs: 100, sourceOrder: 1, sourceKey: "b".repeat(64), recordingOrders: {} },
  });
  const p = await packet(document(), { metadataMutations: [mutation(7)] });
  const accepted = await f.upload(p);
  assert.equal(accepted.status, 200, JSON.stringify(accepted));
  const before = await f.rows("SELECT * FROM content_uploads");
  await clock(f, START + DAY);
  assert.deepEqual(await f.upload(p), accepted);
  assert.equal((await f.rows("SELECT created_at FROM content_uploads"))[0].created_at, before[0].created_at);
  const newer = await packet(document(8), {
    batchId: "newer", sequence: 2, from: 7, through: 8, metadataMutations: [mutation(8)],
  });
  assert.equal((await f.upload(newer)).status, 200);
  const retained = {};
  for (const table of ["ingest_receipts", "device_streams", "event_facts", "account_heads", "tenant_fences"]) {
    retained[table] = await f.rows(`SELECT * FROM ${table}`);
  }
  // When only the older batch reaches its exact retention boundary.
  await clock(f, START + 30 * DAY);
  assert.deepEqual((await f.send("sourceSweep", {})).body, { scanned: 2, deleted: 1 });
  // Then only the expired receipt's content-bearing mutations are scrubbed.
  for (const row of retained.ingest_receipts) {
    if (row.batch_id === p.batch.batchId) {
      const metadata = JSON.parse(row.metadata_json);
      metadata.mutations = [];
      row.metadata_json = JSON.stringify(metadata);
    }
  }
  for (const [table, rows] of Object.entries(retained)) assert.deepEqual(await f.rows(`SELECT * FROM ${table}`), rows);
  assert.equal((await exported(f)).body.error, "content_expired");
  assert.equal((await f.send("chunk", p.uploads[0])).body.error, "content_expired");
  assert.deepEqual(await f.send("cdc", p.batch), accepted);
  assert.equal((await f.send("cdc", { ...p.batch, contentHash: "0".repeat(64) })).body.error, "batch_conflict");
  assert.equal((await f.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 2);
  assert.equal((await f.send("readCdc", { sourceDomain: "source", batchId: "newer" })).status, 200);
});

for (const closed of [false, true]) test(`source retirement preserves fences and tombstones (closed=${closed})`, async t => {
  const f = await fixture(t);
  const mutations = [
    { entity: "session", key: "a".repeat(64), revision: 1,
      facts: { runtime: "codex", startedMs: 100, endedMs: null, automated: false } },
    { entity: "span", key: "b".repeat(64), revision: 2,
      facts: { traceId: "c".repeat(64), spanId: "b".repeat(64), parentSpanId: null,
        sessionId: "a".repeat(64), startMs: 100, endMs: null, recordingOrders: {},
        inputTokens: 0, outputTokens: 0 } },
    { entity: "tombstone", target: "event", key: "d".repeat(64), revision: 3 },
  ];
  const p = await packet(document(), { metadataMutations: mutations });
  assert.equal((await f.upload(p)).status, 200);
  const tombstones = await f.rows("SELECT * FROM entity_tombstones");
  const receipts = await f.rows("SELECT * FROM ingest_receipts");
  if (closed) await f.db.prepare("UPDATE tenant_fences SET state='closed'").run();
  await clock(f, START + 30 * DAY);
  for (let pass = 0; pass < 2; pass++) {
    assert.deepEqual((await f.send("sourceSweep", {})).body, { scanned: 1, deleted: 1 });
    assert.deepEqual(await f.rows("SELECT * FROM entity_tombstones"), tombstones);
    for (const table of ["session_facts", "span_facts"]) {
      assert.equal((await f.rows(`SELECT * FROM ${table}`)).length, closed ? 1 : 0);
    }
  }
  const after = await f.rows("SELECT * FROM ingest_receipts");
  if (!closed) {
    const metadata = JSON.parse(receipts[0].metadata_json);
    metadata.mutations = [];
    receipts[0].metadata_json = JSON.stringify(metadata);
  }
  assert.deepEqual(after, receipts);
  assert.equal((await f.send("cdc", p.batch)).status, closed ? 403 : 200);
  assert.equal((await f.rows("SELECT * FROM session_facts")).length, closed ? 1 : 0);
  if (!closed) {
    const next = await packet(document(8), {
      batchId: "after-expiry", sequence: 2, from: 7, through: 8,
      metadataMutations: [{ ...mutations[0], revision: 8 }],
    });
    assert.equal((await f.upload(next)).status, 200);
    assert.equal((await f.rows("SELECT revision FROM session_facts"))[0].revision, 8);
    assert.deepEqual(await f.rows("SELECT * FROM entity_tombstones"), tombstones);
  }
});

test("terminal source identity catches late PUT and DELETE failure without resurrection", async t => {
  // Given expired committed bytes and their exact encrypted PUT payload.
  const f = await fixture(t), p = await packet(document());
  assert.equal((await f.upload(p)).status, 200);
  const [chunk] = await f.rows("SELECT * FROM content_uploads");
  const encrypted = await (await f.bucket.get(chunk.object_key)).text();
  await clock(f, START + 30 * DAY);
  // When DELETE fails, then succeeds, then an already-issued PUT completes late.
  assert.equal((await f.send("failedSourceSweep", {})).status, 400);
  assert.equal((await f.rows("SELECT state FROM content_uploads"))[0].state, "purged");
  assert.equal((await f.send("direct", { chunk })).body.error, "content_expired");
  assert.equal((await f.send("sourceSweep", {})).body.deleted, 1);
  await f.bucket.put(chunk.object_key, encrypted);
  await f.grant({ retention: { contentDays: 365, projectionDays: 365, backupDays: 30 } });
  // Then terminal intent defeats grant extension, reads, retries and the late bytes.
  assert.equal((await f.send("direct", { chunk })).body.error, "content_expired");
  assert.equal((await f.send("chunk", p.uploads[0])).body.error, "content_expired");
  assert.equal((await f.send("sourceSweep", {})).body.deleted, 1);
  assert.equal(await f.bucket.get(chunk.object_key), null);
  assert.equal((await f.rows("SELECT count(*) n FROM content_uploads"))[0].n, 1);
});

test("bounded source scans rotate live rows and terminal rows fairly", async t => {
  // Given three committed inputs; only the last one has a short original upload age.
  const f = await fixture(t);
  for (let sequence = 1; sequence <= 3; sequence++) {
    const p = await packet(document(sequence), {
      batchId: `batch-${sequence}`, sequence, from: sequence - 1, through: sequence,
    });
    assert.equal((await f.upload(p)).status, 200);
  }
  await f.db.prepare("UPDATE content_uploads SET created_at=? WHERE batch_id='batch-3'")
    .bind(START - 30 * DAY).run();
  const ordered = await f.rows("SELECT object_key FROM content_uploads ORDER BY object_key");
  const expired = (await f.rows("SELECT object_key FROM content_uploads WHERE batch_id='batch-3'"))[0].object_key;
  const expected = ordered.findIndex(row => row.object_key === expired);
  // When each invocation can scan only one row.
  for (let index = 0; index < 3; index++) {
    assert.deepEqual((await f.send("sourceSweep", { limit: 1 })).body,
      { scanned: 1, deleted: index === expected ? 1 : 0 });
  }
  // Then all candidates were visited once; repeated terminal checks cannot starve live rows.
  assert.equal((await f.bucket.list()).objects.length, 2);
  assert.equal((await f.send("sourceSweep", { limit: 0 })).status, 400);
});

test("snapshot retention retires only expired pages and preserves retained snapshot and cursor", async t => {
  // Given an authorized historical baseline and a later retained backfill.
  const f = await fixture(t), first = await snapshot(f, [document()], { cut: 7 });
  assert.equal((await f.send("begin", first.begin)).status, 200);
  assert.equal((await first.stage(0)).status, 200);
  assert.equal((await f.send("complete", ref(first.begin))).status, 200);
  await clock(f, START + DAY);
  const second = await snapshot(f, [document()], { cut: 7, snapshotId: "retained", purpose: "backfill" });
  assert.equal((await f.send("begin", second.begin)).status, 200);
  assert.equal((await second.stage(0)).status, 200);
  assert.equal((await f.send("complete", ref(second.begin))).status, 200);
  const cursor = await f.rows("SELECT * FROM device_streams");
  const [expiredChunk] = await f.rows("SELECT * FROM content_uploads WHERE batch_id=?",
    first.packets[0].page.batchId);
  // When the first snapshot expires, despite SQL orphan pins.
  await clock(f, START + 30 * DAY);
  assert.deepEqual((await f.send("sourceSweep", {})).body, { scanned: 2, deleted: 1 });
  // Then only expired encrypted bytes disappear; retained lineage and high-watermarks survive.
  assert.equal((await f.send("direct", { chunk: expiredChunk })).body.error, "content_expired");
  assert.equal((await f.send("export", { ...ref(second.begin), page: 0 })).status, 200);
  assert.deepEqual(await f.rows("SELECT * FROM device_streams"), cursor);
  assert.equal((await f.rows("SELECT count(*) n FROM migration_pages"))[0].n, 2);
});

test("immutable descriptor from another tenant cannot reach R2", async t => {
  // Given the caller knows another tenant's full descriptor.
  const f = await fixture(t), p = await packet(document());
  assert.equal((await f.upload(p)).status, 200);
  const [chunk] = await f.rows("SELECT * FROM content_uploads");
  await f.db.prepare("INSERT INTO tenant_fences VALUES ('account-b',1,'active')").run();
  // When a different active tenant supplies it to the direct read.
  const result = await f.send("direct", { chunk }, principal({ accountId: "account-b" }));
  // Then the mandatory intent lookup denies it before any R2 operation.
  assert.equal(result.body.error, "content_missing");
  assert.equal((await f.send("gets", {})).body.gets, 0);
});

test("delayed source finalization cannot acknowledge an already expired upload", async t => {
  // Given real staged bytes with no accepted receipt.
  const f = await fixture(t), p = await packet(document());
  assert.equal((await f.send("chunk", p.uploads[0])).status, 200);
  // When finalization is retried at original upload expiry.
  await clock(f, START + 30 * DAY);
  const result = await f.send("cdc", p.batch);
  // Then it cannot create a receipt, cursor or fresh retention interval.
  assert.equal(result.body.error, "content_expired");
  assert.equal((await f.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 0);
  assert.equal((await f.rows("SELECT created_at FROM content_uploads"))[0].created_at, START);
});

test("source retention leaves old runtime uploads on their independent receipt clock", async t => {
  // Given a source cut and a runtime upload staged long before its runtime receipt.
  const f = await fixture(t), p = await packet(document());
  assert.equal((await f.upload(p)).status, 200);
  await f.grant({ scope: { deviceId: "device-a", projectIds: ["project", "device:device-a"], rootIds: [] } });
  const runtime = await runtimePacket();
  assert.equal((await f.send("chunk", runtime.uploads[0])).status, 200);
  await f.db.prepare("UPDATE content_uploads SET created_at=? WHERE batch_id=?")
    .bind(START - 60 * DAY, runtime.commit.batchId).run();
  assert.equal((await f.send("runtimeCommit", runtime.commit)).status, 200);
  // When the source retention owner scans the same R2 namespace.
  assert.deepEqual((await f.send("sourceSweep", {})).body, { scanned: 1, deleted: 0 });
  // Then fresh runtime receipts still read their old staged bytes.
  assert.equal((await f.send("runtimeRead", { sourceDomain: "source" })).status, 200);
  assert.equal((await f.bucket.list()).objects.length, 2);
  assert.equal((await f.rows("SELECT received_at_ms FROM runtime_contexts"))[0].received_at_ms, START);
});
