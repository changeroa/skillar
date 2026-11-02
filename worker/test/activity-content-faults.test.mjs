import assert from "node:assert/strict";
import test from "node:test";
import { fixture, packet, principal } from "./helpers/activity-content.mjs";

const document = { schemaVersion: 2, rows: [{
  table: "events", key: "event", revision: 7, operation: "upsert", sourceOrder: 1,
  values: { id: "event", ts: 100, text: "FAULT_FIXTURE", data_json: '{"args":{"a":1}}' },
}] };
const staged = async f => {
  const p = await packet(document);
  assert.equal((await f.send("/v1/activity/chunks", p.uploads[0])).status, 201);
  return p;
};

test("R2 success plus D1 failure leaves tracked raw inputs and no partial durable receipt", { timeout: 30000 }, async t => {
  // Given a raw object and an injected failure after manifest insertion.
  const f = await fixture(t), p = await staged(f);
  await f.db.prepare(`CREATE TRIGGER reject_content AFTER INSERT ON content_manifests
    BEGIN SELECT RAISE(ABORT,'fixture_manifest_failure'); END`).run();
  // When finalization reaches the same transaction as receipt/projection/job/change.
  const failed = await f.send("/v1/activity/batches", p.batch);
  // Then all acceptance effects roll back, but the durable orphan intent is recoverable.
  assert.equal(failed.status, 503);
  for (const table of ["ingest_receipts", "content_manifests", "account_heads",
    "account_changes", "jobs", "dispatch_outbox", "device_streams"]) {
    assert.equal((await f.rows(`SELECT count(*) n FROM ${table}`))[0].n, 0, table);
  }
  assert.equal((await f.rows("SELECT state FROM content_uploads"))[0].state, "stored");
  assert.equal((await f.bucket.list()).objects.length, 1);
  await f.db.prepare("DROP TRIGGER reject_content").run();
  assert.equal((await f.send("/v1/activity/batches", p.batch)).status, 200);
});

test("final generation fence rolls back a deletion race after manifest insertion", { timeout: 30000 }, async t => {
  // Given a deletion injected after manifest insertion but before final receipt state.
  const f = await fixture(t), p = await staged(f);
  await f.db.prepare(`CREATE TRIGGER close_content_fence AFTER INSERT ON content_manifests
    BEGIN UPDATE tenant_fences SET state='closed' WHERE account_id=NEW.account_id; END`).run();
  // When finalization rechecks the final fence in that same transaction.
  const denied = await f.send("/v1/activity/batches", p.batch);
  // Then no manifest/receipt/change survives and retained intent still identifies the orphan.
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "tenant_fenced");
  assert.equal((await f.rows("SELECT count(*) n FROM content_manifests"))[0].n, 0);
  assert.equal((await f.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 0);
  assert.equal((await f.rows("SELECT count(*) n FROM account_changes"))[0].n, 0);
  assert.equal((await f.rows("SELECT count(*) n FROM content_uploads"))[0].n, 1);
});

test("timeout late PUT after a purge is discovered and deleted on a later sweep", { timeout: 30000 }, async t => {
  // Given a PUT whose completion is gated by an explicit fixture event.
  const f = await fixture(t), p = await packet(document);
  await f.send("/test/arm");
  const timedOut = await f.send("/v1/activity/chunks", p.uploads[0]);
  assert.equal(timedOut.status, 503);
  await f.db.prepare("UPDATE tenant_fences SET state='closed'").run();
  const [{ object_key: key }] = await f.rows("SELECT object_key FROM content_uploads");
  // When deletion runs before the timed-out PUT completes, then that exact PUT completes.
  await f.send("/test/sweep");
  assert.equal(await f.bucket.get(key), null);
  await f.send("/test/release");
  assert.ok(await f.bucket.get(key));
  // Then the retained purge intent catches the late object; no receipt resurrects.
  await f.send("/test/sweep");
  assert.equal(await f.bucket.get(key), null);
  assert.equal((await f.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 0);
});

test("orphan cleanup cannot delete committed inputs and rotates bounded closed-generation scans", { timeout: 30000 }, async t => {
  // Given one committed active batch and three unfinished objects on a second tenant.
  const f = await fixture(t), p = await staged(f);
  await f.send("/v1/activity/batches", p.batch);
  const b = principal({ accountId: "account-b" });
  await f.seed(b);
  for (let i = 0; i < 3; i++) {
    const orphan = await packet(document, { batchId: `orphan-${i}` });
    assert.equal((await f.send("/v1/activity/chunks", orphan.uploads[0], b)).status, 201);
  }
  await f.db.prepare("UPDATE tenant_fences SET state='closed' WHERE account_id=?")
    .bind(b.accountId).run();
  // When three independently bounded sweeps run; no timing or polling is involved.
  for (let i = 0; i < 3; i++) {
    assert.equal((await f.send("/test/sweep", {
      limit: 1, orphanBeforeMs: Number.MAX_SAFE_INTEGER,
    })).body.deleted, 1);
  }
  // Then every closed-tenant object is removed and the committed active object remains readable.
  assert.equal((await f.bucket.list()).objects.length, 1);
  const read = await f.send("/test/read", {
    principal: principal(), input: { sourceDomain: "source", batchId: "batch-1" },
  });
  assert.deepEqual(read.body, document);
});
