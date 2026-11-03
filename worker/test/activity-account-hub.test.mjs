// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { browser, closed, fixture, paths } from "./helpers/activity-account-hub.mjs";

test("native WebSockets fan out bare changes and suppress duplicate notifications", async t => {
  // Given two hibernatable sockets sharing the account, with message subscriptions installed.
  const f = await fixture(t);
  const a = await f.websocket(), b = await f.websocket();
  assert.equal(a.ready.type, "ready");
  assert.match(a.ready.cursor, /^[a-f0-9]{64}\.1\.0$/);
  const first = a.messages.next(), second = b.messages.next();
  // When one durable change is notified twice.
  await f.append();
  assert.equal((await f.notify()).status, 200);
  assert.deepEqual(await first, { generation: 1, seq: 1, invalidationKind: "activity" });
  assert.deepEqual(await second, { generation: 1, seq: 1, invalidationKind: "activity" });
  assert.equal((await f.notify()).status, 200);
  const markerA = a.messages.next(), markerB = b.messages.next();
  a.socket.send("ping"); b.socket.send("ping");
  // Then the native autoresponse is next, not a duplicate frame, and ACK follows storage.
  assert.equal(await markerA, "pong");
  assert.equal(await markerB, "pong");
  const state = await f.control("inspect");
  assert.equal(state.checkpoint.cursor, a.ready.cursor.replace(/\.0$/, ".1"));
  assert.ok(state.attachments.every(value => value.cursor.endsWith(".1.1")));
});

test("actual hibernation eviction reconstructs attachments and delivers missed sequences", async t => {
  // Given a native socket evicted with its connection ID, sid, expiry and cursor attached.
  const f = await fixture(t);
  const socket = await f.websocket();
  const before = await f.control("inspect");
  await f.evict();
  await f.append("runtime");
  await f.append("report");
  const first = socket.messages.next(), second = socket.messages.next();
  // When only the last notification arrives after rehydration.
  assert.equal((await f.notify()).status, 200);
  // Then replay recovers both authoritative records and the original lease remains unchanged.
  assert.deepEqual(await first, { generation: 1, seq: 1, invalidationKind: "runtime" });
  assert.deepEqual(await second, { generation: 1, seq: 2, invalidationKind: "report" });
  const after = await f.control("inspect");
  assert.notEqual(before.boot, after.boot);
  assert.deepEqual(after.attachments[0], {
    ...before.attachments[0], cursor: before.attachments[0].cursor.replace(/\.0$/, ".2"),
  });
  assert.equal(after.attachments[0].sessionId, browser().sessionId);
  assert.equal(after.attachments[0].connectionId, socket.connectionId);
});

test("lease renewal replays a lost final notification without client messages", async t => {
  // Given a connected socket and a committed change whose notification was lost.
  const f = await fixture(t);
  const socket = await f.websocket();
  await f.append("skills");
  const change = socket.messages.next();
  const { now } = await f.control("inspect");
  await f.control("time", { now: now + 60_000 });
  // When the same authenticated sid renews via HTTP.
  const response = await f.send(paths.lease, { body: { connectionId: socket.connectionId } });
  // Then the lease is bounded and the previously silent connection catches up from D1.
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connectionId: socket.connectionId, expiresAtMs: now + 360_000 });
  assert.deepEqual(await change, { generation: 1, seq: 1, invalidationKind: "skills" });
  assert.equal((await f.control("inspect")).alarm, now + 360_000);
});

test("reconnect honors the scoped cursor while since null starts at current head", async t => {
  // Given two missed durable invalidations after the previous connection's cursor.
  const f = await fixture(t);
  const original = await f.websocket();
  await f.append("runtime"); await f.append("consent");
  // When the client reconnects with its last cursor.
  const resumed = await f.websocket({ since: original.ready.cursor });
  // Then ready precedes replay, and a new client does not receive historical changes.
  assert.equal(resumed.ready.cursor, original.ready.cursor);
  assert.deepEqual(await resumed.messages.next(), { generation: 1, seq: 1, invalidationKind: "runtime" });
  assert.deepEqual(await resumed.messages.next(), { generation: 1, seq: 2, invalidationKind: "consent" });
  const fresh = await f.websocket();
  assert.ok(fresh.ready.cursor.endsWith(".1.2"));
  const marker = fresh.messages.next(); fresh.socket.send("ping");
  assert.equal(await marker, "pong");
});

test("expired replay emits only the reset control schema after ready", async t => {
  // Given a cursor below the authoritative retention floor.
  const f = await fixture(t);
  const original = await f.websocket();
  await f.append();
  await f.db.prepare("UPDATE account_heads SET min_replay_seq=1").run();
  // When the client reconnects outside retention.
  const resumed = await f.websocket({ since: original.ready.cursor });
  // Then no source identifiers or invented invalidation envelope escape.
  assert.deepEqual(await resumed.messages.next(), {
    type: "resync_required", cursor: original.ready.cursor.replace(/\.0$/, ".1"),
  });
});

test("notification payload cannot select another account object or disclose its events", async t => {
  // Given independent sessions, streams and changes belonging to two accounts.
  const f = await fixture(t);
  const other = browser({ accountId: "account-b", sessionId: "b".repeat(40) });
  await f.seed(other);
  const a = await f.websocket(), b = await f.websocket({ who: other });
  await f.append("report", other);
  const change = b.messages.next();
  // When account B is notified and an attempt targets account A with B's identity.
  assert.equal((await f.notify(other, "account-a")).status, 403);
  assert.equal((await f.notify(other)).status, 200);
  // Then B alone receives its change; A's next frame is only its own ping marker.
  assert.deepEqual(await change, { generation: 1, seq: 1, invalidationKind: "report" });
  const marker = a.messages.next(); a.socket.send("ping");
  assert.equal(await marker, "pong");
  assert.notEqual(a.ready.cursor.split(".")[0], b.ready.cursor.split(".")[0]);
});

test("paged replay drains beyond one page before acknowledging notify", async t => {
  // Given more durable invalidations than the shared page size.
  const f = await fixture(t);
  const socket = await f.websocket();
  for (let index = 0; index < 103; index++) await f.append("activity");
  const first = socket.messages.next();
  // When one notification reaches the hub.
  assert.equal((await f.notify()).status, 200);
  // Then all sequences arrive once in order and the persisted delivery cursor reaches the head.
  assert.equal((await first).seq, 1);
  for (let seq = 2; seq <= 103; seq++) assert.equal((await socket.messages.next()).seq, seq);
  assert.ok((await f.control("inspect")).attachments[0].cursor.endsWith(".1.103"));
});

for (const code of [undefined, 1000]) test(`client close receives a protocol reply for ${code ?? "no status"}`, async t => {
  // Given
  const f = await fixture(t), connection = await f.websocket();
  const closing = closed(connection.socket);
  // When
  connection.socket.close(code);
  // Then
  const reply = await closing;
  if (code === undefined) assert.ok(reply.code === 1000 || reply.code === 1005);
  else assert.equal(reply.code, code);
});
