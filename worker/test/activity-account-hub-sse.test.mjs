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
  assert.equal((await f.control("inspect")).streams, 0);
});

test("SSE lease renewal recovers a lost notification and revoke ends the stream", async t => {
  // Given an authenticated live SSE stream and a missed notification.
  const f = await fixture(t);
  const stream = await sse(f);
  await f.append("consent");
  const change = stream.next();
  // When the browser renews through the separate authenticated HTTP route.
  const response = await f.send(paths.lease, { body: { connectionId: stream.ready.data.connectionId } });
  // Then replay is live, and the same sid revoke terminates this non-hibernating transport.
  assert.equal(response.status, 200);
  assert.deepEqual((await change).data, { generation: 1, seq: 1, invalidationKind: "consent" });
  const end = stream.next();
  assert.equal((await f.send(paths.revoke, { body: { sessionId: browser().sessionId } })).status, 200);
  assert.equal(await end, null);
});
