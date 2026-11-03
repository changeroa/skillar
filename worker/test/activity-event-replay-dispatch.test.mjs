// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { cursor, fixture } from "./helpers/activity-event-replay.mjs";

test("successful notification uses the account-named DO and coalesces pending changes", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append(3);
  await f.append(2, "account-b");
  // When
  await f.send("dispatch");
  // Then
  assert.deepEqual(await f.rows("SELECT * FROM account_event_outbox"), []);
  const notifications = await f.rows("SELECT * FROM test_notifications ORDER BY body");
  assert.deepEqual(notifications, ["account-a", "account-b"].map(accountId => ({
    id: f.hubId(accountId), url: "https://hub.internal/notify", method: "POST",
    content_type: "application/json", body: JSON.stringify({ accountId, generation: 1 }),
  })));
  assert.equal((await f.read(cursor(0))).changes.length, 3);
});

for (const failure of ["fail", "lost"]) {
  test(`${failure} notification leaves rows pending and retries a duplicate safely`, { timeout: 30000 }, async t => {
    // Given
    const f = await fixture(t);
    await f.append(3);
    await f.mode(failure);
    // When
    await f.send("dispatch");
    const pending = await f.rows("SELECT seq FROM account_event_outbox ORDER BY seq");
    await f.mode("ok");
    await f.send("dispatch");
    await f.send("dispatch");
    // Then
    assert.deepEqual(pending, [{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
    assert.deepEqual(await f.rows("SELECT * FROM account_event_outbox"), []);
    assert.deepEqual((await f.rows("SELECT body FROM test_notifications")).map(row => JSON.parse(row.body)),
      [{ accountId: "account-a", generation: 1 }, { accountId: "account-a", generation: 1 }]);
    assert.deepEqual((await f.read(cursor(0))).changes.map(change => change.seq), [1, 2, 3]);
  });
}

test("ACK never removes changes committed while notification is in flight", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append();
  await f.mode("advance");
  // When
  await f.send("dispatch");
  // Then
  assert.deepEqual(await f.rows("SELECT seq FROM account_event_outbox"), [{ seq: 2 }]);
  assert.deepEqual((await f.read(cursor(0))).changes, [
    { generation: 1, seq: 1, invalidationKind: "activity" },
    { generation: 1, seq: 2, invalidationKind: "runtime" },
  ]);
});

test("one failed account cannot block another account's notification", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append();
  await f.append(1, "account-b");
  await f.mode("fail");
  // When
  await f.send("dispatch");
  // Then
  assert.deepEqual(await f.rows("SELECT account_id,seq FROM account_event_outbox"),
    [{ account_id: "account-a", seq: 1 }]);
});

for (const generations of [[1, 2], [2, 1]]) test(`generation-separated outbox entries remain retryable in delivery order ${generations}`, { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  const createdAt = Date.now();
  for (const [index, generation] of generations.entries()) {
    await f.append(1, "account-a", generation);
    await f.db.prepare("UPDATE account_event_outbox SET created_at=? WHERE generation=?")
      .bind(createdAt + index, generation).run();
  }
  await f.db.prepare("UPDATE tenant_fences SET generation=2").run();
  // When
  await f.send("dispatch");
  const page = await f.read(cursor(0, "account-a", 2), { accountId: "account-a", generation: 2 });
  // Then
  assert.deepEqual(await f.rows("SELECT * FROM account_event_outbox"), []);
  assert.deepEqual((await f.rows("SELECT body FROM test_notifications")).map(row => JSON.parse(row.body).generation),
    generations);
  assert.deepEqual(page.changes, [{ generation: 2, seq: 1, invalidationKind: "activity" }]);
});

test("Cron discards permanently failed notifications after replay retention", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append(3);
  await f.mode("fail");
  await f.db.prepare("UPDATE account_changes SET created_at=1").run();
  await f.db.prepare("UPDATE account_event_outbox SET created_at=1").run();
  // When
  await f.send("dispatch");
  // Then
  assert.deepEqual(await f.rows("SELECT * FROM account_event_outbox"), []);
  assert.deepEqual(await f.rows("SELECT * FROM account_changes"), []);
  assert.deepEqual(await f.rows("SELECT * FROM test_notifications"), []);
  assert.equal((await f.read(cursor(0))).state, "resync_required");
});

test("dispatch infrastructure failure resolves without discarding committed intent", { timeout: 30000 }, async t => {
  // Given: a committed change and an unavailable dispatch table.
  const f = await fixture(t);
  await f.append();
  await f.db.prepare("ALTER TABLE account_event_outbox RENAME TO unavailable_event_outbox").run();
  // When
  await f.send("dispatch");
  // Then
  assert.deepEqual(await f.rows("SELECT seq FROM unavailable_event_outbox"), [{ seq: 1 }]);
  assert.deepEqual(await f.rows("SELECT * FROM test_notifications"), []);
  assert.deepEqual((await f.read(cursor(0))).changes,
    [{ generation: 1, seq: 1, invalidationKind: "activity" }]);
});

test("failed ACK resolves and leaves durable intent for a duplicate delivery", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append();
  await f.db.prepare(`CREATE TRIGGER test_ack_failure BEFORE DELETE ON account_event_outbox
    BEGIN SELECT RAISE(ABORT,'fixture_ack_unavailable'); END;`).run();
  // When
  await f.send("dispatch");
  const pending = await f.rows("SELECT seq FROM account_event_outbox");
  await f.db.prepare("DROP TRIGGER test_ack_failure").run();
  await f.send("dispatch");
  // Then
  assert.deepEqual(pending, [{ seq: 1 }]);
  assert.deepEqual(await f.rows("SELECT * FROM account_event_outbox"), []);
  assert.deepEqual(await f.rows("SELECT body FROM test_notifications"),
    Array.from({ length: 2 }, () => ({ body: JSON.stringify({ accountId: "account-a", generation: 1 }) })));
});
