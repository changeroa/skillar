// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { bounded, browser, fixture, paths, sse } from "./helpers/activity-account-hub.mjs";

test("SSE delivers live changes from the same durable replay as WebSockets", async t => {
  // Given one SSE stream and one native WebSocket with subscriptions ready.
  const f = await fixture(t);
  const stream = await sse(f), socket = await f.websocket();
  assert.equal(stream.ready.event, "ready");
  assert.equal(stream.ready.data.cursor, socket.ready.cursor);
  const sseChange = stream.next(), wsChange = socket.messages.next();
  // When the committed change is notified.
  await f.append("migration");
  assert.equal((await f.notify()).status, 200);
  // Then SSE's id is scoped and both transports carry the identical bare invalidation.
  const event = await sseChange;
  assert.equal(event.event, "change");
  assert.equal(event.id, stream.ready.id.replace(/\.0$/, ".1"));
  assert.deepEqual(event.data, await wsChange);
  assert.deepEqual(event.data, { generation: 1, seq: 1, invalidationKind: "migration" });
});

test("Last-Event-ID overrides the query cursor and resumes SSE replay", async t => {
  // Given a client that has already consumed sequence one.
  const f = await fixture(t);
  const socket = await f.websocket();
  await f.append("activity"); await f.append("runtime");
  const last = socket.ready.cursor.replace(/\.0$/, ".1");
  // When EventSource reconnects with its Last-Event-ID and an older query cursor.
  const stream = await sse(f, { since: socket.ready.cursor, headers: { "last-event-id": last } });
  // Then ready preserves the consumed point and replay starts strictly after it.
  assert.equal(stream.ready.id, last);
  assert.deepEqual(await stream.next(), {
    event: "change", id: last.replace(/\.1$/, ".2"),
    data: { generation: 1, seq: 2, invalidationKind: "runtime" },
  });
});

test("SSE retention expiry uses resync_required with the current scoped id", async t => {
  // Given a replay cursor that has left the retained log.
  const f = await fixture(t);
  const socket = await f.websocket();
  await f.append();
  await f.db.prepare("UPDATE account_heads SET min_replay_seq=1").run();
  // When an SSE stream resumes with the expired cursor.
  const stream = await sse(f, { headers: { "last-event-id": socket.ready.cursor } });
  // Then the same reset protocol is sent as on WebSocket.
  const cursor = socket.ready.cursor.replace(/\.0$/, ".1");
  assert.deepEqual(await stream.next(), { event: "resync_required", id: cursor,
    data: { type: "resync_required", cursor } });
});

test("native SSE response cancellation releases its connection and expiration alarm", async t => {
  // Given the production response body in a real DO, independent of HTTP proxy disconnect handling.
  const f = await fixture(t);
  assert.deepEqual(await f.control("native-stream"), { status: 200 });
  assert.equal((await f.control("inspect")).streams, 1);
  await f.control("arm-empty");
  const empty = bounded(f.control("empty"), "SSE cancellation cleanup");
  // When the native consumer cancels the actual response reader.
  assert.deepEqual(await f.control("cancel-response"), { cancelled: true });
  // Then the cleanup event, not a polling delay, proves the stream is gone.
  assert.deepEqual(await empty, { empty: true });
  const state = await f.control("inspect");
  assert.equal(state.streams, 0);
  assert.equal(state.timers, 0);
  assert.equal(state.alarm, null);
});

test("request abort closes SSE and removes its live subscription", async t => {
  // Given a live response and a read subscribed before the request's abort event.
  const f = await fixture(t);
  const stream = await sse(f);
  const end = stream.next();
  await f.control("arm-empty");
  const empty = bounded(f.control("empty"), "SSE request abort cleanup");
  // When the native Request signal is aborted inside the test boundary.
  await f.control("abort");
  // Then the stream ends and the hub forgets its subscription.
  assert.equal(await end, null);
  assert.deepEqual(await empty, { empty: true });
  const state = await f.control("inspect");
  assert.equal(state.streams, 0);
  assert.equal(state.timers, 0);
  assert.equal(state.alarm, null);
});

test("SSE lease renewal cannot extend its deadline and revoke ends the stream", async t => {
  // Given an authenticated live SSE stream and a missed notification.
  const f = await fixture(t);
  const stream = await sse(f);
  await f.append("consent");
  const change = stream.next();
  // When the browser attempts renewal through the authenticated HTTP route.
  const response = await f.send(paths.lease, { body: { connectionId: stream.ready.data.connectionId } });
  // Then renewal is rejected, but notify and same-sid revoke retain their authority.
  assert.equal(response.status, 409);
  assert.equal((await f.control("inspect")).streamAttachments[0].expiresAtMs, stream.ready.data.expiresAtMs);
  assert.equal((await f.notify()).status, 200);
  assert.deepEqual((await change).data, { generation: 1, seq: 1, invalidationKind: "consent" });
  const end = stream.next();
  assert.equal((await f.send(paths.revoke, { body: { sessionId: browser().sessionId } })).status, 200);
  assert.equal(await end, null);
});

test("idle SSE reaches native deadline EOF without an alarm or another request", async t => {
  // Given a native stream with no changes or client activity.
  const f = await fixture(t);
  const stream = await sse(f);
  const { now } = await f.control("inspect");
  assert.equal(stream.ready.data.expiresAtMs, now + 5_000);
  await f.control("disarm-alarm");
  await f.control("arm-empty");
  const empty = bounded(f.control("empty"), "deadline cleanup", 10_000);
  // When the actual five-second deadline fires, await EOF rather than sleeping.
  const end = stream.next(10_000);
  // Then the native timer finishes the response and leaves no scheduled work.
  assert.equal(await end, null);
  assert.deepEqual(await empty, { empty: true });
  const state = await f.control("inspect");
  assert.equal(state.streams, 0);
  assert.equal(state.timers, 0);
  assert.equal(state.alarm, null);
});

test("concurrent account SSE clients and later joins share one hard deadline", async t => {
  // Given simultaneous admission attempts for separate sessions in the same account.
  const f = await fixture(t);
  const other = browser({ sessionId: "b".repeat(40) });
  await f.seed(other);
  const [a, b] = await Promise.all([sse(f), sse(f, { who: other })]);
  const deadline = a.ready.data.expiresAtMs;
  // When another tab joins later within that window.
  await f.control("time", { now: deadline - 1_000 });
  const c = await sse(f);
  // Then admission and stored attachments all retain the first deadline.
  assert.equal(b.ready.data.expiresAtMs, deadline);
  assert.equal(c.ready.data.expiresAtMs, deadline);
  const state = await f.control("inspect");
  assert.ok(state.streamAttachments.every(value => value.expiresAtMs === deadline));
  assert.deepEqual(state.sseWindow, { endsAtMs: deadline, nextAllowedAtMs: deadline + 120_000 });
});

test("SSE cooldown survives reconnect and eviction until the explicit next window", async t => {
  // Given an ended window and a durable cooldown record.
  const f = await fixture(t);
  const stream = await sse(f);
  const deadline = stream.ready.data.expiresAtMs;
  await f.control("time", { now: deadline });
  await f.control("arm-empty");
  const empty = bounded(f.control("empty"), "expired window cleanup");
  await f.control("alarm");
  assert.equal(await stream.next(), null);
  await empty;
  const before = await f.control("inspect");
  // When reconnect attempts straddle a real eviction during cooldown.
  const denied = await f.send(paths.stream);
  await f.evict();
  const after = await f.control("inspect");
  const deniedAfter = await f.send(paths.stream);
  // Then both are bare 429 failures, and exactly the boundary permits a fresh window.
  assert.equal(denied.status, 429);
  assert.deepEqual(await denied.json(), { error: "sse_cooldown" });
  assert.notEqual(before.boot, after.boot);
  assert.deepEqual(after.sseWindow, before.sseWindow);
  assert.equal(deniedAfter.status, 429);
  assert.deepEqual(await deniedAfter.json(), { error: "sse_cooldown" });
  await f.control("time", { now: deadline + 120_000 - 1 });
  assert.equal((await f.send(paths.stream)).status, 429);
  await f.control("time", { now: deadline + 120_000 });
  const next = await sse(f);
  assert.equal(next.ready.data.expiresAtMs, deadline + 125_000);
});

test("aborting every SSE client cannot restart the account window", async t => {
  // Given a stream that ends before its account-wide deadline.
  const f = await fixture(t);
  const stream = await sse(f);
  const deadline = stream.ready.data.expiresAtMs;
  const end = stream.next();
  await f.control("arm-empty");
  const empty = bounded(f.control("empty"), "early abort cleanup");
  await f.control("abort");
  assert.equal(await end, null);
  await empty;
  // When a new tab reconnects after every prior stream has gone.
  await f.control("time", { now: deadline - 1_000 });
  const resumed = await sse(f);
  // Then the persisted account window is reused rather than extended.
  assert.equal(resumed.ready.data.expiresAtMs, deadline);
});

test("SSE ends at an earlier authoritative session expiry", async t => {
  // Given a session expiring before the account-wide five-second window.
  const f = await fixture(t);
  const { now } = await f.control("inspect");
  const expires = Math.floor(now / 1000) + 2;
  await f.accounts.prepare("UPDATE sessions SET expires_at=?").bind(expires).run();
  // When the native SSE response is opened.
  const stream = await sse(f);
  // Then the attachment and actual EOF obey session expiry, not the later window end.
  assert.equal(stream.ready.data.expiresAtMs, expires * 1000);
  assert.ok(stream.ready.data.expiresAtMs < (await f.control("inspect")).sseWindow.endsAtMs);
  await f.control("disarm-alarm");
  await f.control("arm-empty");
  const empty = bounded(f.control("empty"), "session deadline cleanup");
  assert.equal(await stream.next(), null);
  await empty;
  const state = await f.control("inspect");
  assert.equal(state.streams, 0);
  assert.equal(state.timers, 0);
  assert.equal(state.alarm, null);
});
