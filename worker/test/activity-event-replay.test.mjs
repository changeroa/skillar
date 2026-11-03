// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { cursor, fixture, retention } from "./helpers/activity-event-replay.mjs";

test("initial dashboard open starts at the head without historical replay", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append(103);
  // When
  const page = await f.read();
  // Then
  assert.deepEqual(page, { state: "ok", head: 103, cursor: cursor(103), changes: [], hasMore: false });
});

test("replay pages advance only to delivered invalidations and expose no tenant keys", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append(203);
  await f.append(5, "account-b");
  // When
  const first = await f.read(cursor(0)), second = await f.read(first.cursor), third = await f.read(second.cursor);
  // Then
  assert.equal(first.head, 203);
  assert.equal(first.cursor, cursor(100));
  assert.equal(second.cursor, cursor(200));
  assert.equal(third.cursor, cursor(203));
  assert.deepEqual([first.hasMore, second.hasMore, third.hasMore], [true, true, false]);
  assert.deepEqual([...first.changes, ...second.changes, ...third.changes],
    Array.from({ length: 203 }, (_, i) => ({ generation: 1, seq: i + 1, invalidationKind: "activity" })));
  assert.deepEqual(await f.read(third.cursor),
    { state: "ok", head: 203, cursor: cursor(203), changes: [], hasMore: false });
});

for (const invalid of [cursor(0, "account-b"), cursor(0, "account-a", 2), cursor(3),
  "0", `${cursor(0)}.extra`, cursor("9007199254740992")]) {
  test(`invalid or scope-mismatched cursor resets: ${invalid}`, { timeout: 30000 }, async t => {
    // Given
    const f = await fixture(t);
    await f.append(2);
    // When
    const page = await f.read(invalid);
    // Then
    assert.deepEqual(page, { state: "resync_required", head: 2, cursor: cursor(2), changes: [], hasMore: false });
  });
}

test("generation rotation resets to current generation without replaying old rows", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append(2);
  await f.db.prepare("UPDATE tenant_fences SET generation=2").run();
  await f.append(1, "account-a", 2);
  // When
  const page = await f.read(cursor(0));
  // Then
  assert.deepEqual(page, { state: "resync_required", head: 1, cursor: cursor(1, "account-a", 2),
    changes: [], hasMore: false });
});

test("closed or unknown accounts cannot read retained changes", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append(2);
  await f.db.prepare("UPDATE tenant_fences SET state='closed'").run();
  // When
  const closed = await f.read(cursor(0)), unknown = await f.read(null, { accountId: "absent", generation: 1 });
  // Then
  assert.equal(closed.state, "resync_required");
  assert.deepEqual(closed.changes, []);
  assert.deepEqual(unknown, { state: "resync_required", head: 0, cursor: cursor(0, "absent"),
    changes: [], hasMore: false });
});

test("expired cursor resets before Cron and retained boundary remains replayable after sweep", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append(3);
  await f.db.prepare("UPDATE account_changes SET created_at=1 WHERE seq<=2").run();
  await f.db.prepare("UPDATE account_event_outbox SET created_at=1 WHERE seq<=2").run();
  // When
  const expired = await f.read(cursor(1));
  await f.send("sweep");
  const boundary = await f.read(cursor(2)), expiredAgain = await f.read(cursor(1));
  // Then
  assert.equal(expired.state, "resync_required");
  assert.equal(expiredAgain.state, "resync_required");
  assert.deepEqual(boundary.changes, [{ generation: 1, seq: 3, invalidationKind: "activity" }]);
  assert.equal(boundary.cursor, cursor(3));
  assert.deepEqual(await f.rows("SELECT min_replay_seq,head_seq FROM account_heads"),
    [{ min_replay_seq: 2, head_seq: 3 }]);
  assert.deepEqual(await f.rows("SELECT seq FROM account_event_outbox"), [{ seq: 3 }]);
});

test("fully expired streams retain their head and cannot resurrect pruned history", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append(2);
  await f.db.prepare("UPDATE account_changes SET created_at=1").run();
  await f.db.prepare("UPDATE account_event_outbox SET created_at=1").run();
  // When
  await f.send("sweep");
  await f.send("sweep");
  await f.append();
  const initial = await f.read(), stale = await f.read(cursor(1)), boundary = await f.read(cursor(2));
  // Then
  assert.equal(initial.head, 3);
  assert.equal(stale.state, "resync_required");
  assert.deepEqual(boundary.changes, [{ generation: 1, seq: 3, invalidationKind: "activity" }]);
  assert.deepEqual(await f.rows("SELECT seq FROM account_changes"), [{ seq: 3 }]);
});

test("head and page stay coherent during racing real D1 writes and retention", { timeout: 30000 }, async t => {
  // Given
  const f = await fixture(t);
  await f.append(50);
  await f.db.prepare("UPDATE account_changes SET created_at=?").bind(Date.now() - retention - 10000).run();
  // When
  const [page] = await Promise.all([f.read(cursor(50)), f.append(50), f.send("sweep")]);
  // Then
  assert.equal(page.state, "ok");
  assert.ok([50, 100].includes(page.head));
  assert.deepEqual(page.changes.map(change => change.seq),
    Array.from({ length: page.head - 50 }, (_, i) => i + 51));
  assert.equal(page.cursor, cursor(page.head));
});
