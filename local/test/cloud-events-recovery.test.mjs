import assert from "node:assert/strict";
import { test } from "node:test";
import { change, connected, cursor, frame, liveHarness, params, ready, replay } from "./cloud-events-harness.test.mjs";
import { EVENT_SSE_LIFETIME_MS, EVENT_SSE_COOLDOWN_MS } from "../../shared/dist/activity-events.js";

test("SSE has a finite client deadline followed by cooldown instead of lease extension", async () => {
  // Given
  const h = liveHarness({ transports: ["sse"] });
  const socket = await connected(h);
  // When
  assert.equal((await h.scheduler.scheduled.take()).delayMs, EVENT_SSE_LIFETIME_MS);
  h.scheduler.fire();
  // Then
  assert.equal(await h.events.state.take(), "connecting");
  assert.equal(socket.closed, true);
  assert.equal(h.calls.lease.size, 0);
  assert.deepEqual(h.scheduler.pending().map(timer => timer.delayMs), [EVENT_SSE_COOLDOWN_MS, 15_000]);
  h.live.stop();
  assert.equal(h.scheduler.pending().length, 0);
  assert.equal(h.visibility.listeners, 0);
});

test("SSE cooldown survives visibility return while REST replay advances the reconnect cursor", async () => {
  // Given
  const h = liveHarness({ transports: ["sse"] });
  const start = h.scheduler.now(), socket = await connected(h);
  await h.scheduler.scheduled.take();
  h.scheduler.fire();
  await h.events.state.take();
  const reconnect = await h.scheduler.scheduled.take();
  await h.scheduler.scheduled.take();
  h.visibility.set(true);
  const visibleReplay = await h.calls.changes.take();
  assert.equal(h.scheduler.pending().includes(reconnect), true);
  // When an idle-gap poll queues behind the visibility comparison.
  assert.equal(h.scheduler.fire().delayMs, 15_000);
  visibleReplay.resolve(replay({ head: 4 }));
  const poll = await h.calls.changes.take();
  poll.resolve(replay({ head: 5, changes: [change(1, 5)] }));
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  await h.scheduler.scheduled.take();
  for (let index = 0; index < 6; index++) {
    assert.equal(h.scheduler.fire().delayMs, 15_000);
    (await h.calls.changes.take()).resolve(replay({ head: 5 }));
    await h.scheduler.scheduled.take();
    assert.equal(h.sockets.size, 0);
  }
  assert.equal(h.scheduler.fire(), reconnect);
  (await h.calls.changes.take()).resolve(replay({ head: 5 }));
  // Then only the budgeted reconnect opens a new source, at the replayed cursor.
  const next = await h.sockets.take();
  assert.equal(socket.closed, true);
  assert.equal(h.scheduler.now() - start, EVENT_SSE_LIFETIME_MS + EVENT_SSE_COOLDOWN_MS);
  assert.equal(params(next).get("since"), cursor(1, 5));
  assert.notEqual(params(next).get("connectionId"), params(socket).get("connectionId"));
  ready(next, h.scheduler.now() + EVENT_SSE_LIFETIME_MS);
  assert.equal(await h.events.state.take(), "live");
  h.live.stop();
  assert.equal(h.scheduler.pending().length, 0);
});

test("a server close reconnects after backoff with a fresh connection at the compared head", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  // When
  socket.events.onClose();
  // Then
  assert.equal(await h.events.state.take(), "connecting");
  assert.deepEqual(h.scheduler.pending().map((timer) => timer.delayMs), [1000]);
  h.scheduler.fire();
  const compare = await h.calls.changes.take();
  assert.equal(compare.args[0], cursor(1, 4));
  compare.resolve(replay({ head: 6, cursor: cursor(1, 6), changes: [change(1, 5), change(1, 6)] }));
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  const next = await h.sockets.take();
  assert.equal(params(next).get("since"), cursor(1, 6));
  assert.notEqual(params(next).get("connectionId"), params(socket).get("connectionId"));
  ready(next, h.scheduler.now() + 300_000);
  assert.equal(await h.events.state.take(), "live");
  h.live.stop();
});

test("repeated failures back off exponentially to the bound and reset after a ready", async () => {
  // Given
  const h = liveHarness({ transports: ["websocket"] });
  let socket = await connected(h, 4);
  const delays = [];
  // When
  for (const expected of [1000, 2000, 4000, 8000, 8000]) {
    socket.events.onClose();
    await h.events.state.take();
    delays.push(h.scheduler.fire().delayMs);
    (await h.calls.changes.take()).resolve(replay({ head: 4 }));
    socket = await h.sockets.take();
    assert.equal(socket.target.kind, "websocket");
    assert.equal(delays.at(-1), expected);
  }
  ready(socket, h.scheduler.now() + 300_000);
  await h.events.state.take();
  socket.events.onClose();
  await h.events.state.take();
  // Then
  assert.equal(h.scheduler.fire().delayMs, 1000);
  h.live.stop();
});

test("two websocket handshakes without ready fall back to the SSE stream route", async () => {
  // Given
  const h = liveHarness();
  h.live.start();
  await h.events.state.take();
  (await h.calls.changes.take()).resolve(replay({ head: 4 }));
  // When
  for (let attempt = 0; attempt < 2; attempt++) {
    const socket = await h.sockets.take();
    assert.equal(socket.target.kind, "websocket");
    socket.events.onClose();
    await h.events.state.take();
    h.scheduler.fire();
    (await h.calls.changes.take()).resolve(replay({ head: 4 }));
  }
  // Then
  const fallback = await h.sockets.take();
  assert.equal(fallback.target.kind, "sse");
  assert.equal(new URL(fallback.target.url, "https://skillar.sh").pathname, "/api/events/stream");
  assert.equal(params(fallback).get("since"), cursor(1, 4));
  ready(fallback, h.scheduler.now() + EVENT_SSE_LIFETIME_MS);
  assert.equal(await h.events.state.take(), "live");
  h.live.stop();
});

for (const [name, violate] of [
  ["an SSE id disagreeing with the derived cursor", (socket) => frame(socket, change(1, 5), cursor(1, 9))],
  ["a frame carrying entity payload", (socket) => frame(socket, { ...change(1, 5), session: { firstPrompt: "raw" } })],
  ["unparseable data", (socket) => socket.events.onFrame({ data: "{", cursor: null })],
  ["a ready for a foreign connection", (socket) => frame(socket, {
    type: "ready", connectionId: "11111111-1111-4111-8111-111111111111", expiresAtMs: 1, cursor: cursor(1, 4) })],
]) test(`${name} is a protocol violation that drops the socket`, async () => {
  // Given
  const h = liveHarness({ transports: ["sse"] });
  const socket = await connected(h, 4);
  // When
  violate(socket);
  // Then
  assert.equal(await h.events.state.take(), "connecting");
  assert.equal(socket.closed, true);
  assert.deepEqual(h.scheduler.pending().map((timer) => timer.delayMs),
    [EVENT_SSE_LIFETIME_MS + EVENT_SSE_COOLDOWN_MS, 15_000]);
  assert.equal(h.calls.sessions.size, 0);
  h.live.stop();
});

test("an interrupted connector compares head on ready without extending the SSE deadline", async () => {
  // Given
  const h = liveHarness({ transports: ["sse"] });
  const socket = await connected(h, 4);
  // When
  socket.events.onInterrupted();
  // Then
  assert.equal(await h.events.state.take(), "connecting");
  assert.deepEqual(h.scheduler.pending().map((timer) => timer.delayMs), [EVENT_SSE_LIFETIME_MS]);
  ready(socket, h.scheduler.now() + EVENT_SSE_LIFETIME_MS);
  const compare = await h.calls.changes.take();
  assert.equal(compare.args[0], cursor(1, 4));
  compare.resolve(replay({ head: 4 }));
  assert.equal(await h.events.state.take(), "live");
  assert.deepEqual(h.scheduler.pending().map((timer) => timer.delayMs), [EVENT_SSE_LIFETIME_MS]);
  h.live.stop();
});

test("returning to a visible tab compares head and skips a pending reconnect delay", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  // When
  h.visibility.set(true);
  // Then
  const compare = await h.calls.changes.take();
  assert.equal(compare.args[0], cursor(1, 4));
  compare.resolve(replay({ head: 4 }));
  socket.events.onClose();
  await h.events.state.take();
  h.visibility.set(false);
  assert.equal(h.scheduler.pending().length, 1);
  assert.equal(h.calls.changes.size, 0);
  h.visibility.set(true);
  assert.equal(h.scheduler.pending().length, 0);
  (await h.calls.changes.take()).resolve(replay({ head: 4 }));
  ready(await h.sockets.take(), h.scheduler.now() + 300_000);
  assert.equal(await h.events.state.take(), "live");
  h.live.stop();
});

test("the lease is renewed through the authenticated endpoint before expiry and the head compared", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  // When
  assert.equal(h.scheduler.fire().delayMs, 150_000);
  // Then
  const renewal = await h.calls.lease.take();
  assert.equal(renewal.args[0], params(socket).get("connectionId"));
  renewal.resolve(h.scheduler.now() + 240_000);
  const compare = await h.calls.changes.take();
  assert.equal(compare.args[0], cursor(1, 4));
  compare.resolve(replay({ head: 5, cursor: cursor(1, 5), changes: [change(1, 5)] }));
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  assert.deepEqual(h.scheduler.pending().map((timer) => timer.delayMs), [120_000]);
  assert.equal(socket.closed, false);
  h.live.stop();
});

test("a rejected lease renewal drops the connection and reconnects with backoff", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  h.scheduler.fire();
  // When
  (await h.calls.lease.take()).reject(new h.ApiError(409, "cloud_http_409", "connection expired"));
  // Then
  assert.equal(await h.events.state.take(), "connecting");
  assert.equal(socket.closed, true);
  assert.deepEqual(h.scheduler.pending().map((timer) => timer.delayMs), [1000]);
  h.live.stop();
});

test("stop aborts the replay in flight, closes the socket, clears timers and listeners, and restart is fresh", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  frame(socket, change(1, 9));
  const fill = await h.calls.changes.take();
  // When
  h.live.stop();
  // Then
  assert.equal(fill.signal.aborted, true);
  assert.equal(socket.closed, true);
  assert.equal(h.scheduler.pending().length, 0);
  assert.equal(h.visibility.listeners, 0);
  h.live.start();
  assert.equal(await h.events.state.take(), "connecting");
  assert.equal((await h.calls.changes.take()).args[0], null);
  h.live.stop();
});

test("without any live transport the subscriber is offline and nothing is requested", async () => {
  // Given
  const h = liveHarness({ transports: [] });
  // When
  h.live.start();
  // Then
  assert.equal(await h.events.state.take(), "offline");
  assert.equal(h.calls.changes.size, 0);
  assert.equal(h.scheduler.pending().length, 0);
  h.live.stop();
});
