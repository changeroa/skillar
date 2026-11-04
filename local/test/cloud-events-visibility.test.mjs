import assert from "node:assert/strict";
import { test } from "node:test";
import { change, connected, cursor, fakeVisibility, liveHarness, params, ready, replay } from "./cloud-events-harness.test.mjs";
import { EVENT_SSE_COOLDOWN_MS, EVENT_SSE_LIFETIME_MS } from "../../shared/dist/activity-events.js";

test("a hidden WebSocket stays connected when visible again before sixty seconds", async () => {
  const h = liveHarness(), socket = await connected(h);
  h.visibility.set(false);
  h.scheduler.schedule(59_999, () => h.visibility.set(true));
  assert.equal(h.scheduler.fire().delayMs, 59_999);
  const comparison = await h.calls.changes.take();
  assert.equal(comparison.args[0], cursor(1, 4));
  comparison.resolve(replay({ head: 4 }));
  assert.equal(socket.closed, false);
  assert.deepEqual(h.scheduler.pending().map(timer => timer.delayMs), [150_000]);
  h.live.stop();
  assert.equal(h.scheduler.pending().length, 0);
});

test("a hidden WebSocket pauses at sixty seconds without renewing its lease", async () => {
  const h = liveHarness(), socket = await connected(h);
  h.visibility.set(false);
  assert.equal(h.scheduler.fire().delayMs, 60_000);
  assert.equal(await h.events.state.take(), "paused");
  assert.equal(socket.closed, true);
  assert.equal(h.calls.lease.size, 0);
  assert.equal(h.calls.changes.size, 0);
  assert.equal(h.scheduler.pending().length, 0);
  h.live.stop();
  assert.equal(h.visibility.listeners, 0);
});

test("a paused connection resumes once from the REST cursor on visibility return", async () => {
  const h = liveHarness(), first = await connected(h);
  h.visibility.set(false);
  h.scheduler.fire();
  assert.equal(await h.events.state.take(), "paused");
  h.visibility.set(true);
  h.visibility.set(true);
  assert.equal(await h.events.state.take(), "connecting");
  const comparison = await h.calls.changes.take();
  assert.equal(comparison.args[0], cursor(1, 4));
  comparison.resolve(replay({ head: 5, changes: [change(1, 5)] }));
  (await h.calls.sessions.take()).resolve([{ id: "after-hidden" }]);
  assert.equal((await h.events.session.take()).id, "after-hidden");
  await h.events.refresh.take();
  const next = await h.sockets.take();
  assert.equal(first.closed, true);
  assert.equal(params(next).get("since"), cursor(1, 5));
  ready(next, h.scheduler.now() + 300_000);
  assert.equal(await h.events.state.take(), "live");
  assert.equal(h.calls.changes.size, 0);
  assert.equal(h.sockets.size, 0);
  h.live.stop();
});

test("rapid visibility toggles leave only the current lease timer and stop clears it", async () => {
  const h = liveHarness(), socket = await connected(h);
  for (let index = 0; index < 100; index++) {
    h.visibility.set(false);
    h.visibility.set(true);
  }
  assert.equal(socket.closed, false);
  assert.equal(h.visibility.listeners, 1);
  assert.deepEqual(h.scheduler.pending().map(timer => timer.delayMs), [150_000]);
  h.live.stop();
  assert.equal(h.scheduler.pending().length, 0);
  assert.equal(h.visibility.listeners, 0);
});

test("stop during the hidden grace period cancels the pending pause", async () => {
  const h = liveHarness(), socket = await connected(h);
  h.visibility.set(false);
  assert.deepEqual(h.scheduler.pending().map(timer => timer.delayMs), [150_000, 60_000]);
  h.live.stop();
  assert.equal(socket.closed, true);
  assert.equal(h.scheduler.pending().length, 0);
  assert.equal(h.events.state.size, 0);
});

test("an initially hidden document starts the same bounded grace period", async () => {
  const visibility = fakeVisibility(false), h = liveHarness({ visibility });
  const socket = await connected(h);
  assert.equal(h.scheduler.fire().delayMs, 60_000);
  assert.equal(await h.events.state.take(), "paused");
  assert.equal(socket.closed, true);
  assert.equal(h.scheduler.pending().length, 0);
  h.live.stop();
  assert.equal(visibility.listeners, 0);
});

test("pause and resume fence a connection whose earlier REST replay is still in flight", async () => {
  const h = liveHarness();
  h.live.start();
  assert.equal(await h.events.state.take(), "connecting");
  const earlier = await h.calls.changes.take();
  h.visibility.set(false);
  assert.equal(h.scheduler.fire().delayMs, 60_000);
  assert.equal(await h.events.state.take(), "paused");
  h.visibility.set(true);
  assert.equal(await h.events.state.take(), "connecting");
  earlier.resolve(replay({ head: 4 }));
  const resumed = await h.calls.changes.take();
  assert.equal(h.sockets.size, 0);
  assert.equal(resumed.args[0], cursor(1, 4));
  resumed.resolve(replay({ head: 4 }));
  const socket = await h.sockets.take();
  ready(socket, h.scheduler.now() + 300_000);
  assert.equal(await h.events.state.take(), "live");
  assert.equal(h.sockets.size, 0);
  h.live.stop();
});

test("hidden SSE pauses its replay and reconnect timers without bypassing stream cooldown", async () => {
  const h = liveHarness({ transports: ["sse"] }), socket = await connected(h);
  const start = h.scheduler.now();
  assert.equal((await h.scheduler.scheduled.take()).delayMs, EVENT_SSE_LIFETIME_MS);
  h.visibility.set(false);
  assert.equal((await h.scheduler.scheduled.take()).delayMs, 60_000);
  h.scheduler.fire();
  assert.equal(await h.events.state.take(), "connecting");
  assert.equal((await h.scheduler.scheduled.take()).delayMs, EVENT_SSE_COOLDOWN_MS);
  assert.equal((await h.scheduler.scheduled.take()).delayMs, 15_000);
  for (let index = 0; index < 3; index++) {
    assert.equal(h.scheduler.fire().delayMs, 15_000);
    (await h.calls.changes.take()).resolve(replay({ head: 4 }));
    assert.equal((await h.scheduler.scheduled.take()).delayMs, 15_000);
  }
  assert.equal(h.scheduler.fire().delayMs, 60_000);
  assert.equal(h.scheduler.now() - start, 60_000);
  assert.equal(await h.events.state.take(), "paused");
  assert.equal(socket.closed, true);
  assert.equal(h.scheduler.pending().length, 0);
  assert.equal(h.calls.lease.size, 0);
  h.visibility.set(true);
  assert.equal(await h.events.state.take(), "connecting");
  const comparison = await h.calls.changes.take();
  assert.equal(comparison.args[0], cursor(1, 4));
  comparison.resolve(replay({ head: 4 }));
  assert.deepEqual(h.scheduler.pending().map(timer => timer.delayMs), [65_000, 15_000]);
  assert.equal(h.sockets.size, 0);
  h.live.stop();
  assert.equal(h.scheduler.pending().length, 0);
});
