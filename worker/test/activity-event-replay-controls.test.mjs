// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { cursor, fixture } from "./helpers/activity-event-replay.mjs";

const receipt = (db, control = 1, account = "account-a", generation = 1) =>
  db.prepare(`INSERT INTO account_control_receipts(account_id,generation,control_id)
    SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM tenant_fences
      WHERE account_id=? AND generation=? AND state='active')
    ON CONFLICT(account_id,generation,control_id) DO NOTHING`)
    .bind(account, generation, control, account, generation).run();

test("active control receipt initializes a head and durable consent invalidation", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  // When
  await receipt(f.db);
  // Then
  assert.deepEqual(await f.rows("SELECT account_id,generation,control_id FROM account_control_receipts"),
    [{ account_id: "account-a", generation: 1, control_id: 1 }]);
  assert.ok((await f.rows("SELECT created_at_ms FROM account_control_receipts"))[0].created_at_ms > 0);
  assert.deepEqual(await f.rows("SELECT head_seq,min_replay_seq FROM account_heads"),
    [{ head_seq: 1, min_replay_seq: 0 }]);
  assert.deepEqual((await f.read(cursor(0))).changes,
    [{ generation: 1, seq: 1, invalidationKind: "consent" }]);
  assert.deepEqual(await f.rows("SELECT account_id,generation,seq FROM account_event_outbox"),
    [{ account_id: "account-a", generation: 1, seq: 1 }]);
  assert.deepEqual(await f.rows("SELECT * FROM dispatch_outbox"), []);
});

test("lost primary ACK and concurrent control retries append exactly one change", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append(2);
  // When
  await Promise.all(Array.from({ length: 6 }, () => receipt(f.db, 77)));
  // Then
  assert.deepEqual(await f.rows("SELECT head_seq FROM account_heads"), [{ head_seq: 3 }]);
  assert.deepEqual(await f.rows("SELECT seq,invalidation_kind FROM account_changes ORDER BY seq"), [
    { seq: 1, invalidation_kind: "activity" }, { seq: 2, invalidation_kind: "activity" },
    { seq: 3, invalidation_kind: "consent" },
  ]);
  assert.deepEqual(await f.rows("SELECT control_id FROM account_control_receipts"), [{ control_id: 77 }]);
  assert.deepEqual(await f.rows("SELECT seq FROM account_event_outbox ORDER BY seq"),
    [{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
});

test("unexpired control receipts still deduplicate after replay and notification cleanup", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await receipt(f.db);
  await f.db.prepare("UPDATE account_changes SET created_at=1").run();
  await f.db.prepare("UPDATE account_event_outbox SET created_at=1").run();
  await f.send("sweep");
  // When
  await receipt(f.db);
  // Then
  assert.deepEqual(await f.rows("SELECT head_seq,min_replay_seq FROM account_heads"),
    [{ head_seq: 1, min_replay_seq: 1 }]);
  assert.deepEqual(await f.rows("SELECT * FROM account_changes"), []);
  assert.deepEqual(await f.rows("SELECT * FROM account_event_outbox"), []);
  assert.deepEqual(await f.rows("SELECT control_id FROM account_control_receipts"), [{ control_id: 1 }]);
});

test("receipt sweep removes expired identities while preserving pending retry deduplication", { timeout: 30000 }, async t => {
  // Given: primary retry lifetime has ended for control 1, not control 2.
  const f = await fixture(t);
  await receipt(f.db, 1);
  await receipt(f.db, 2);
  await f.db.prepare("UPDATE account_control_receipts SET created_at_ms=1 WHERE control_id=1").run();
  // When
  await f.send("sweep");
  await f.send("sweep");
  await receipt(f.db, 2);
  // Then
  assert.deepEqual(await f.rows("SELECT control_id FROM account_control_receipts"), [{ control_id: 2 }]);
  assert.deepEqual(await f.rows("SELECT head_seq,min_replay_seq FROM account_heads"),
    [{ head_seq: 2, min_replay_seq: 0 }]);
  assert.deepEqual((await f.read(cursor(0))).changes, [
    { generation: 1, seq: 1, invalidationKind: "consent" },
    { generation: 1, seq: 2, invalidationKind: "consent" },
  ]);
});

test("distinct controls advance the same account and duplicate IDs stay account scoped", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.db.prepare("INSERT INTO tenant_fences VALUES('account-b',1,'active')").run();
  // When
  await receipt(f.db, 1);
  await receipt(f.db, 2);
  await receipt(f.db, 1, "account-b");
  // Then
  assert.deepEqual(await f.rows("SELECT account_id,head_seq FROM account_heads ORDER BY account_id"),
    [{ account_id: "account-a", head_seq: 2 }, { account_id: "account-b", head_seq: 1 }]);
  assert.deepEqual((await f.read(cursor(0))).changes, [
    { generation: 1, seq: 1, invalidationKind: "consent" },
    { generation: 1, seq: 2, invalidationKind: "consent" },
  ]);
});

test("inactive missing and stale-generation receipts cannot emit account changes", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.db.prepare("INSERT INTO tenant_fences VALUES('closed',1,'closed')").run();
  await f.db.prepare("UPDATE tenant_fences SET generation=2 WHERE account_id='account-a'").run();
  // When: even a direct insert must pass the trigger's own fence.
  for (const account of ["account-a", "closed", "missing"]) {
    await f.db.prepare(`INSERT INTO account_control_receipts(account_id,generation,control_id)
      VALUES(?,1,1)`).bind(account).run();
  }
  await receipt(f.db, 2);
  // Then
  assert.deepEqual(await f.rows("SELECT * FROM account_heads"), []);
  assert.deepEqual(await f.rows("SELECT * FROM account_changes"), []);
  assert.deepEqual(await f.rows("SELECT * FROM account_event_outbox"), []);
  assert.equal((await f.rows("SELECT count(*) AS n FROM account_control_receipts"))[0].n, 3);
});

test("generation rollover allows the same control identity only in its new generation", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await receipt(f.db);
  await f.db.prepare("UPDATE tenant_fences SET generation=2").run();
  // When
  await receipt(f.db, 1, "account-a", 1);
  await receipt(f.db, 1, "account-a", 2);
  await receipt(f.db, 1, "account-a", 2);
  // Then
  assert.deepEqual(await f.rows("SELECT generation,head_seq FROM account_heads ORDER BY generation"),
    [{ generation: 1, head_seq: 1 }, { generation: 2, head_seq: 1 }]);
  assert.deepEqual((await f.read(cursor(0, "account-a", 2), { accountId: "account-a", generation: 2 })).changes,
    [{ generation: 2, seq: 1, invalidationKind: "consent" }]);
});

test("notification failure rolls back the receipt so primary retry is not falsely deduplicated", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.db.prepare(`CREATE TRIGGER test_control_outbox_failure BEFORE INSERT ON account_event_outbox
    BEGIN SELECT RAISE(ABORT,'fixture_control_notification_failed'); END;`).run();
  // When
  await assert.rejects(() => receipt(f.db), /fixture_control_notification_failed/);
  // Then
  for (const table of ["account_control_receipts", "account_heads", "account_changes", "account_event_outbox"]) {
    assert.deepEqual(await f.rows(`SELECT * FROM ${table}`), [], table);
  }
});
