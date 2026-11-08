import assert from "node:assert/strict";
import test from "node:test";
import { fixture, packet, principal } from "./helpers/activity-content.mjs";

const document = text => ({ schemaVersion: 2, rows: [
  { table: "sessions", key: "session", revision: 7, operation: "upsert", sourceOrder: 1,
    values: { id: "session", started_at: 100, first_prompt: text, end_orders_json: "{}" } },
  { table: "events", key: "event", revision: 7, operation: "upsert", sourceOrder: 2,
    values: { id: "event", ts: 100, text, data_json: JSON.stringify({ args: { nested: text } }) } },
  { table: "otel_spans", key: '["trace","span"]', revision: 7, operation: "upsert", sourceOrder: 3,
    values: { trace_id: "trace", span_id: "span", name: text, recording_orders_json: '{"source":0}' } },
] });

test("encrypted R2 chunks roundtrip complete Unicode prompt args and spans without raw D1 bytes", { timeout: 30000 }, async t => {
  // Given raw content larger than one chunk, including a UTF-8 chunk boundary.
  const f = await fixture(t);
  const text = "RAW_SENTINEL_한글🙂".repeat(4000);
  const expected = document(text), p = await packet(expected);
  assert.ok(p.uploads.length > 1);
  // When a real workerd/R2/D1 service durably accepts the complete batch.
  const accepted = await f.upload(p);
  // Then the same account reads every value and byte; receipts/manifests never contain raw content.
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.state, "projected");
  const read = await f.send("/test/read", {
    principal: principal(), input: { sourceDomain: "source", batchId: p.batch.batchId },
  });
  assert.deepEqual(read, { status: 200, body: expected });
  for (const table of ["ingest_receipts", "content_manifests", "content_uploads",
    "account_content_keys", "jobs", "dispatch_outbox", "account_changes"]) {
    assert.equal(JSON.stringify(await f.rows(`SELECT * FROM ${table}`)).includes("RAW_SENTINEL"), false);
  }
  const objects = await f.bucket.list();
  assert.equal(objects.objects.length, p.uploads.length);
  for (const object of objects.objects) {
    assert.equal((await (await f.bucket.get(object.key)).text()).includes("RAW_SENTINEL"), false);
  }
});

test("response loss returns the original receipt and a changed immutable chunk is rejected", { timeout: 30000 }, async t => {
  // Given a durably accepted batch whose response the device might lose.
  const f = await fixture(t), p = await packet(document("original"));
  const accepted = await f.upload(p);
  // When the device replays it and then attempts different bytes at the same chunk identity.
  const replay = await f.upload(p);
  const conflict = await packet(document("different"));
  const changed = await f.send("/v1/activity/chunks", conflict.uploads[0]);
  // Then replay is exactly idempotent and the changed content cannot replace it.
  assert.deepEqual(replay, accepted);
  assert.equal(changed.status, 409);
  assert.equal((await f.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 1);
  assert.equal((await f.rows("SELECT head_seq FROM account_heads"))[0].head_seq, 1);
});

test("missing local-only or stale consent stores zero raw objects or upload intents", { timeout: 30000 }, async t => {
  // Given a device whose browser explicitly returned to local-only.
  const f = await fixture(t), p = await packet(document("FORBIDDEN"));
  await f.accounts.prepare("UPDATE device_consents SET consent_json=?")
    .bind('{"mode":"local-only"}').run();
  // When an obsolete device still sends a raw chunk.
  const denied = await f.send("/v1/activity/chunks", p.uploads[0]);
  // Then the grant check fails before key creation, intent or R2 persistence.
  assert.equal(denied.status, 403);
  assert.equal((await f.rows("SELECT count(*) n FROM content_uploads"))[0].n, 0);
  assert.equal((await f.rows("SELECT count(*) n FROM account_content_keys"))[0].n, 0);
  assert.equal((await f.bucket.list()).objects.length, 0);
});

test("selected prompt consent is validated before PUT and cannot stage mixed argument JSON", { timeout: 30000 }, async t => {
  // Given a selected-kind grant, not a blanket full-row grant.
  const f = await fixture(t);
  await f.accounts.prepare(`UPDATE device_consents
    SET consent_json=json_set(consent_json,'$.contentKinds',json('["prompt"]'))`).run();
  const forbidden = await packet(document("UNSELECTED_ARGS_SENTINEL"));
  // When an upload includes fields outside that grant.
  const denied = await f.send("/v1/activity/chunks", forbidden.uploads[0]);
  // Then no unselected content enters R2, while an independently valid prompt document succeeds.
  assert.equal(denied.status, 403);
  assert.equal((await f.bucket.list()).objects.length, 0);
  const permitted = await packet({ schemaVersion: 2, rows: [{
    table: "sessions", key: "a".repeat(64), revision: 7, operation: "upsert",
    sourceOrder: 1, values: { started_at: 100, first_prompt: "selected prompt" },
  }] });
  assert.equal((await f.upload(permitted)).status, 200);
});

test("same source IDs in two accounts cannot read or overwrite the other account's content", { timeout: 30000 }, async t => {
  // Given two tenants with the same device, lineage, batch and source keys.
  const f = await fixture(t), b = principal({ accountId: "account-b" });
  await f.seed(b);
  const aPacket = await packet(document("TENANT_A")), bPacket = await packet(document("TENANT_B"));
  await f.upload(aPacket);
  assert.equal((await f.send("/test/read", {
    principal: b, input: { sourceDomain: "source", batchId: "batch-1" },
  }, b)).status, 409);
  // When the second tenant uploads its own overlapping identities.
  assert.equal((await f.upload(bPacket, b)).status, 200);
  // Then each authorized read remains account-scoped without a redeploy.
  for (const [who, expected] of [[principal(), "TENANT_A"], [b, "TENANT_B"]]) {
    const read = await f.send("/test/read", {
      principal: who, input: { sourceDomain: "source", batchId: "batch-1" },
    }, who);
    assert.equal(read.body.rows[0].values.first_prompt, expected);
  }
  assert.equal((await f.rows("SELECT count(DISTINCT object_key) n FROM content_uploads"))[0].n, 2);
});

test("missing or crypto-version-tampered R2 data never receives a durable batch receipt", { timeout: 30000 }, async t => {
  // Given a stored encrypted chunk.
  const f = await fixture(t), p = await packet(document("original"));
  assert.equal((await f.send("/v1/activity/chunks", p.uploads[0])).status, 201);
  const [{ object_key: key }] = await f.rows("SELECT object_key FROM content_uploads");
  const envelope = await (await f.bucket.get(key)).json();
  await f.bucket.put(key, JSON.stringify({ ...envelope, version: 2 }));
  // When finalization verifies the actual stored cryptographic envelope.
  const denied = await f.send("/v1/activity/batches", p.batch);
  // Then it rejects unsupported crypto rather than acknowledging metadata-only storage.
  assert.equal(denied.status, 400);
  assert.equal(denied.body.error, "unsupported_version");
  assert.equal((await f.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 0);
});
