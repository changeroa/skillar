// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { batch, fixture, migrate, principal } from "./helpers/activity-event-replay.mjs";
import { fixture as reportFixture, ingest, publish, query, runtime } from "./helpers/activity-reports.mjs";

test("ledger commit retries append one notification and preserve processing outbox semantics", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  // When
  await f.send("commit", batch(), principal());
  await f.send("commit", batch(), principal());
  // Then
  assert.deepEqual(await f.rows("SELECT account_id,generation,seq FROM account_event_outbox"),
    [{ account_id: "account-a", generation: 1, seq: 1 }]);
  assert.deepEqual(await f.rows("SELECT state,attempts,batch_id FROM dispatch_outbox"),
    [{ state: "pending", attempts: 0, batch_id: "batch-1" }]);
  assert.ok((await f.rows("SELECT created_at FROM account_changes"))[0].created_at > 0);
});

test("final ledger fence failure rolls back facts, head, changes and notification intent", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.db.prepare(`CREATE TRIGGER test_final_failure BEFORE UPDATE OF state ON ingest_receipts
    WHEN NEW.state='projected' BEGIN SELECT RAISE(ABORT,'fixture_final_fence'); END;`).run();
  // When
  const response = await assert.rejects(async () => f.send("commit", batch(), principal()), /fixture_final_fence/);
  // Then
  for (const table of ["ingest_receipts", "session_facts", "account_heads", "account_changes",
    "jobs", "dispatch_outbox", "account_event_outbox"]) {
    assert.deepEqual(await f.rows(`SELECT * FROM ${table}`), [], table);
  }
});

test("notification trigger failure aborts the entire account commit", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.db.prepare(`CREATE TRIGGER test_outbox_failure BEFORE INSERT ON account_event_outbox
    BEGIN SELECT RAISE(ABORT,'fixture_outbox_unavailable'); END;`).run();
  // When
  await assert.rejects(() => f.send("commit", batch(), principal()), /fixture_outbox_unavailable/);
  // Then
  for (const table of ["ingest_receipts", "session_facts", "account_heads", "account_changes", "dispatch_outbox"]) {
    assert.deepEqual(await f.rows(`SELECT * FROM ${table}`), [], table);
  }
});

test("upgrade backfills existing changes without touching pending processing jobs", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t, { eventsMigration: false });
  await f.send("commit", batch(), principal());
  // When
  await migrate(f.db);
  // Then
  assert.deepEqual(await f.rows("SELECT account_id,generation,seq FROM account_event_outbox"),
    [{ account_id: "account-a", generation: 1, seq: 1 }]);
  assert.ok((await f.rows("SELECT created_at FROM account_changes"))[0].created_at > 0);
  assert.deepEqual(await f.rows("SELECT state,attempts,batch_id FROM dispatch_outbox"),
    [{ state: "pending", attempts: 0, batch_id: "batch-1" }]);
});

test("real migration, runtime, content and ReportFlow commits all create atomic notification intent", { timeout: 30000 }, async t => {
  // Given
  const f = await reportFixture(t);
  await migrate(f.db);
  const clock = { table: "recording_clock", key: "[1]", revision: 1, operation: "upsert", sourceOrder: 1,
    values: { singleton: 1, domain: "original-domain", position: 0 } };
  // When: report completion is subscribed before query dispatch.
  const begin = await publish(f, [{ schemaVersion: 2, rows: [clock] }]);
  await runtime(f, begin, {});
  await ingest(f, begin, [{ ...clock, revision: 2, values: { ...clock.values, position: 1 } }]);
  const request = query(begin, { kind: "stats" }), finished = f.finished(request.requestId);
  assert.equal((await f.api("/v1/activity/query", request)).status, 202);
  assert.equal((await finished).state, "complete");
  // Then
  const changes = await f.rows("SELECT seq,invalidation_kind FROM account_changes ORDER BY seq");
  assert.deepEqual(changes, [
    { seq: 1, invalidation_kind: "activity" }, { seq: 2, invalidation_kind: "runtime" },
    { seq: 3, invalidation_kind: "activity" }, { seq: 4, invalidation_kind: "report" },
  ]);
  assert.deepEqual(await f.rows("SELECT seq FROM account_event_outbox ORDER BY seq"),
    [{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }]);
  assert.deepEqual(await f.rows("SELECT head_seq FROM account_heads"), [{ head_seq: 4 }]);
  assert.deepEqual(await f.rows("SELECT batch_id,state,attempts FROM dispatch_outbox ORDER BY batch_id"),
    (await f.rows("SELECT batch_id FROM jobs ORDER BY batch_id"))
      .map(row => ({ ...row, state: "pending", attempts: 0 })));
});
