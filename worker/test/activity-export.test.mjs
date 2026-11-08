import assert from "node:assert/strict";
import test from "node:test";
import { fixture, packet, principal } from "./helpers/activity-content.mjs";

const readPrincipal = principal({ scopes: ["activity:read"] });
const request = (changes = {}) => ({
  deviceId: "device-a", sourceDomain: "source", generation: 1, consentVersion: 1,
  projectId: "project", rootId: null, range: { fromMs: 0, toMs: 1000 },
  backfill: null, afterSequence: 0, ...changes,
});
const document = (revision = 7, text = "export") => ({
  schemaVersion: 2, rows: [{
    table: "events", key: `event-${revision}`, revision, operation: "upsert", sourceOrder: -1,
    values: { id: `event-${revision}`, ts: 100, text, data_json: '{"args":[null,"\\u0000"]}',
      recording_orders_json: '{"source":0}', text_length: null },
  }, {
    table: "sessions", key: "deleted", revision, operation: "delete", sourceOrder: null, values: null,
  }],
});
const exportPage = (f, changes = {}, who = readPrincipal) =>
  f.send("/v1/activity/export", request(changes), who);

test("a renewed covering read grant can export retained bytes but cannot authorize stale uploads", async t => {
  const f = await fixture(t), p = await packet(document());
  assert.equal((await f.upload(p)).status, 200);
  const saved = await f.accounts.prepare("SELECT consent_json FROM device_consents WHERE version=1").first();
  const grant = { ...JSON.parse(saved.consent_json), version: 2 };
  await f.accounts.prepare("INSERT INTO device_consents VALUES ('account-a','device-a',1,2,?,0)")
    .bind(JSON.stringify(grant)).run();
  assert.equal((await exportPage(f)).status, 403);
  const renewed = await exportPage(f, { consentVersion: 2 });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.deepEqual(renewed.body.batches[0].document, document());
  assert.equal((await f.send("/v1/activity/chunks", p.uploads[0])).status, 403);
  await f.accounts.prepare("INSERT INTO device_consents VALUES ('account-a','device-a',1,3,?,0)")
    .bind(JSON.stringify({ ...grant, version: 3, contentKinds: ["prompt"] })).run();
  assert.equal((await exportPage(f, { consentVersion: 3 })).status, 403);
});

test("export returns exact Unicode and control values with immutable envelope and receipt", { timeout: 30000 }, async t => {
  // Given encrypted content spanning a multibyte UTF-8 chunk boundary.
  const f = await fixture(t);
  const text = "RAW_EXPORT_한글🙂\u0000\u0001\u00ff\n\"\\e\u0301".repeat(5000);
  const expected = document(7, text), p = await packet(expected);
  assert.ok(p.uploads.length > 1);
  const accepted = await f.upload(p);
  assert.equal(accepted.status, 200);
  // When an activity:read-only principal exports the accepted batch.
  const result = await exportPage(f);
  // Then every scalar, JSON string, tombstone, hash and original receipt survives.
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.batches, [{ batch: p.batch, receipt: accepted.body, document: expected }]);
  assert.deepEqual(result.body.start, { sequence: 0, journalThrough: 0 });
  assert.deepEqual(result.body.cursor, { sequence: 1, journalThrough: 7 });
  assert.deepEqual(result.body.head, result.body.cursor);
  assert.equal(result.body.throughSequence, 1);
  assert.equal(result.body.hasMore, false);
  assert.equal(JSON.stringify(result.body).includes("objectKey"), false);
  for (const table of ["ingest_receipts", "content_manifests", "content_uploads", "account_content_keys"]) {
    assert.equal(JSON.stringify(await f.rows(`SELECT * FROM ${table}`)).includes("RAW_EXPORT_"), false);
  }
});

test("fixed export ceiling resumes contiguously despite later accepted batches", { timeout: 30000 }, async t => {
  // Given two accepted batches and the first exported page.
  const f = await fixture(t);
  for (let sequence = 1; sequence <= 2; sequence++) {
    assert.equal((await f.upload(await packet(document(sequence * 7), {
      batchId: `batch-${sequence}`, sequence, from: (sequence - 1) * 7, through: sequence * 7,
    }))).status, 200);
  }
  const first = await exportPage(f, { limit: 1 });
  assert.equal(first.status, 200);
  assert.equal(first.body.hasMore, true);
  assert.equal(first.body.throughSequence, 2);
  assert.equal((await f.upload(await packet(document(21), {
    batchId: "batch-3", sequence: 3, from: 14, through: 21,
  }))).status, 200);
  // When resuming with the original ceiling.
  const second = await exportPage(f, { afterSequence: first.body.cursor.sequence,
    throughSequence: first.body.throughSequence, limit: 4 });
  // Then the second batch starts exactly at the previous journal cut; the third is excluded.
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.start, first.body.cursor);
  assert.equal(second.body.batches.length, 1);
  assert.equal(second.body.batches[0].batch.sequence, 2);
  assert.deepEqual(second.body.batches[0].batch.journal, { from: 7, through: 14 });
  assert.deepEqual(second.body.cursor, { sequence: 2, journalThrough: 14 });
  assert.deepEqual(second.body.head, { sequence: 3, journalThrough: 21 });
  assert.equal(second.body.hasMore, false);
});

test("absent source cursor returns explicit null without exposing staged uploads", { timeout: 30000 }, async t => {
  // Given uploaded chunks that have never received an acceptance receipt.
  const f = await fixture(t), p = await packet(document());
  for (const chunk of p.uploads) assert.equal((await f.send("/v1/activity/chunks", chunk)).status, 201);
  // When exporting the source.
  const result = await exportPage(f);
  // Then no upload masquerades as an accepted batch or cursor.
  assert.deepEqual(result, { status: 200, body: {
    schemaVersion: 1, deviceId: "device-a", sourceDomain: "source", generation: 1,
    afterSequence: 0, throughSequence: 0, start: null, cursor: null, head: null,
    hasMore: false, batches: [],
  } });
});

test("foreign account device generation and source cannot export another stream", { timeout: 30000 }, async t => {
  // Given content in account-a and an independently consented account-b.
  const f = await fixture(t), b = principal({ accountId: "account-b", scopes: ["activity:read"] });
  await f.seed(b);
  assert.equal((await f.upload(await packet(document()))).status, 200);
  // When foreign or mismatched identities request the export.
  const foreign = await exportPage(f, {}, b);
  const device = await exportPage(f, { deviceId: "device-b" });
  const generation = await exportPage(f, { generation: 2 });
  const stale = await exportPage(f, { generation: 2 }, principal({ generation: 2, scopes: ["activity:read"] }));
  const source = await exportPage(f, { sourceDomain: "foreign-source" });
  // Then no other stream is returned and identity mismatches fail closed.
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.body.batches, []);
  assert.equal(foreign.body.head, null);
  for (const result of [device, generation, stale]) assert.equal(result.status, 403);
  assert.equal(source.status, 200);
  assert.equal(source.body.head, null);
});

test("current consent revocation denies accepted content and empty pages", { timeout: 30000 }, async t => {
  // Given accepted content followed by explicit local-only revocation.
  const f = await fixture(t);
  assert.equal((await f.upload(await packet(document()))).status, 200);
  await f.accounts.prepare("UPDATE device_consents SET consent_json=?")
    .bind('{"mode":"local-only"}').run();
  // When reading both content and an empty page.
  const content = await exportPage(f), empty = await exportPage(f, { afterSequence: 1 });
  // Then both require current consent.
  assert.deepEqual(content, { status: 403, body: { error: "consent_required" } });
  assert.deepEqual(empty, content);
});

test("current field project root range and version restrictions deny export", { timeout: 30000 }, async t => {
  // Given a full-content batch followed by a narrower current field grant.
  const f = await fixture(t);
  assert.equal((await f.upload(await packet(document()))).status, 200);
  await f.accounts.prepare(`UPDATE device_consents SET consent_json=
    json_set(consent_json,'$.contentKinds',json('["prompt"]'))`).run();
  // When current field policy or caller scope is insufficient.
  const field = await exportPage(f);
  const project = await exportPage(f, { projectId: "foreign-project" });
  const root = await exportPage(f, { rootId: "foreign-root" });
  const range = await exportPage(f, { range: { fromMs: -100, toMs: 1000 } });
  const version = await exportPage(f, { consentVersion: 2 });
  // Then no raw document escapes any denied scope.
  for (const result of [field, project, root, range, version]) assert.equal(result.status, 403);
});

test("ingest disabled still allows authenticated read-only export", { timeout: 30000 }, async t => {
  // Given durable content and a disabled ingest switch.
  const f = await fixture(t), p = await packet(document());
  assert.equal((await f.upload(p)).status, 200);
  await f.send("/test/off");
  // When the read-only principal exports and ingest-only principal attempts a read.
  const read = await exportPage(f);
  const denied = await exportPage(f, {}, principal({ scopes: ["activity:ingest"] }));
  const unauthenticated = await exportPage(f, {}, null);
  const write = await f.send("/v1/activity/batches", p.batch);
  // Then export remains available without granting ingest privileges.
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.batches[0].document, document());
  assert.equal(denied.status, 403);
  assert.equal(unauthenticated.status, 400);
  assert.equal(write.status, 404);
});

test("invalid pagination missing content and sequence gaps fail without omissions", { timeout: 30000 }, async t => {
  // Given two receipts whose first content manifest is missing.
  const f = await fixture(t);
  for (let sequence = 1; sequence <= 2; sequence++) {
    assert.equal((await f.upload(await packet(document(sequence * 7), {
      batchId: `batch-${sequence}`, sequence, from: (sequence - 1) * 7, through: sequence * 7,
    }))).status, 200);
  }
  await f.db.prepare("DELETE FROM content_manifests WHERE batch_id='batch-1'").run();
  // When export encounters invalid bounds, missing content, or a receipt gap.
  const missing = await exportPage(f);
  const bounds = await exportPage(f, { throughSequence: 3 });
  const invalid = await exportPage(f, { limit: 5 });
  await f.db.prepare("DELETE FROM ingest_receipts WHERE batch_id='batch-1'").run();
  const gap = await exportPage(f), anchor = await exportPage(f, { afterSequence: 1 });
  // Then none silently advances past unavailable data.
  assert.deepEqual(missing, { status: 409, body: { error: "content_missing" } });
  for (const result of [bounds, gap, anchor]) {
    assert.deepEqual(result, { status: 409, body: { error: "sequence_gap" } });
  }
  assert.equal(invalid.status, 400);
});

test("sequence zero baseline preserves its nonzero cut for CDC continuity", { timeout: 30000 }, async t => {
  // Given the device_streams cursor shape published by migration completion.
  const f = await fixture(t);
  await f.db.prepare("INSERT INTO device_streams VALUES ('account-a',1,'device-a','source',0,40)").run();
  const baseline = await exportPage(f);
  assert.deepEqual(baseline.body.cursor, { sequence: 0, journalThrough: 40 });
  assert.equal((await f.upload(await packet(document(47), { from: 40, through: 47 }))).status, 200);
  // When exporting after the baseline.
  const result = await exportPage(f);
  // Then sequence zero is not confused with a missing cursor or journal zero.
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.start, { sequence: 0, journalThrough: 40 });
  assert.deepEqual(result.body.batches[0].batch.journal, { from: 40, through: 47 });
});
