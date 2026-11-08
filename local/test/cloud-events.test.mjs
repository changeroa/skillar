import assert from "node:assert/strict";
import { test } from "node:test";
import { change, connected, cursor, frame, liveHarness, modules, params, replay } from "./cloud-events-harness.test.mjs";

test("EventSource errors close native automatic retries and notify the budgeted controller only once", (t) => {
  // Given a native source that would otherwise retry while CONNECTING.
  const original = globalThis.EventSource;
  t.after(() => {
    if (original === undefined) delete globalThis.EventSource;
    else globalThis.EventSource = original;
  });
  let source, closes = 0, interrupted = 0;
  globalThis.EventSource = class extends EventTarget {
    readyState = 0;
    closeCalls = 0;
    constructor() { super(); source = this; }
    close() { this.readyState = 2; this.closeCalls++; }
  };
  const socket = modules.browserConnect({ kind: "sse", url: "/api/events/stream" }, {
    onFrame() { assert.fail("unexpected frame"); },
    onClose() { closes++; },
    onInterrupted() { interrupted++; },
  });
  // When
  source.onerror();
  source.onerror();
  socket.close();
  // Then
  assert.equal(source.readyState, 2);
  assert.equal(source.closeCalls, 1);
  assert.equal(closes, 1);
  assert.equal(interrupted, 0);
});

test("opens the websocket at the authenticated head and goes live only on the server ready", async () => {
  // Given
  const h = liveHarness();
  // When
  const socket = await connected(h, 4);
  // Then
  assert.equal(socket.target.kind, "websocket");
  assert.equal(new URL(socket.target.url, "https://skillar.sh").pathname, "/api/events/ws");
  assert.equal(params(socket).get("since"), cursor(1, 4));
  assert.match(params(socket).get("connectionId"), /^[0-9a-f-]{36}$/);
  assert.deepEqual(h.scheduler.pending().map((timer) => timer.delayMs), [150_000]);
  assert.equal(h.calls.sessions.size, 0);
  h.live.stop();
});

test("a contiguous activity frame requeries sessions, emits the changed rows, then refreshes once", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  // When
  frame(socket, change(1, 5));
  // Then
  (await h.calls.sessions.take()).resolve([{ id: "s1" }, { id: "s2" }]);
  assert.equal((await h.events.session.take()).id, "s1");
  assert.equal((await h.events.session.take()).id, "s2");
  await h.events.refresh.take();
  assert.equal(h.calls.changes.size, 0);
  assert.equal(h.events.refresh.size, 0);
  h.live.stop();
});

test("duplicate and out-of-order frames are dropped while a gap replays through the authenticated route", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  // When
  frame(socket, change(1, 4));
  frame(socket, change(1, 7));
  // Then
  const fill = await h.calls.changes.take();
  assert.equal(fill.args[0], cursor(1, 4));
  fill.resolve(replay({ head: 7, cursor: cursor(1, 7), changes: [change(1, 5), change(1, 6), change(1, 7)] }));
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  frame(socket, change(1, 6));
  frame(socket, change(1, 8));
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  assert.equal(h.calls.sessions.size, 0);
  assert.equal(h.calls.changes.size, 0);
  h.live.stop();
});

test("a paged replay follows hasMore with the returned cursor before a single requery", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  // When
  frame(socket, change(1, 9));
  // Then
  const first = await h.calls.changes.take();
  first.resolve(replay({ head: 9, cursor: cursor(1, 6), changes: [change(1, 5), change(1, 6)], hasMore: true }));
  const second = await h.calls.changes.take();
  assert.equal(second.args[0], cursor(1, 6));
  second.resolve(replay({ head: 9, cursor: cursor(1, 9), changes: [change(1, 7), change(1, 8), change(1, 9)] }));
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  frame(socket, change(1, 10, "skills"));
  await h.events.refresh.take();
  assert.equal(h.calls.changes.size, 0);
  h.live.stop();
});

test("resync_required resets the cursor and refreshes everything", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  // When
  frame(socket, { type: "resync_required", cursor: cursor(1, 40) });
  // Then
  (await h.calls.sessions.take()).resolve([{ id: "s9" }]);
  assert.equal((await h.events.session.take()).id, "s9");
  await h.events.refresh.take();
  frame(socket, change(1, 41));
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  assert.equal(h.calls.changes.size, 0);
  h.live.stop();
});

test("a frame from a new generation resets instead of replaying the old one", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  // When
  frame(socket, change(2, 1, "report"));
  // Then
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  frame(socket, change(2, 2, "skills"));
  await h.events.refresh.take();
  assert.equal(h.calls.sessions.size, 0);
  assert.equal(h.calls.changes.size, 0);
  h.live.stop();
});

test("report completions never trigger reads and skills only refresh", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  // When
  frame(socket, change(1, 5, "report"));
  frame(socket, change(1, 6, "skills"));
  // Then
  await h.events.refresh.take();
  assert.equal(h.calls.sessions.size, 0);
  frame(socket, change(1, 7, "consent"));
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  assert.deepEqual(h.log, ["state:connecting", "refresh", "state:live", "refresh", "refresh"]);
  h.live.stop();
});

test("invalidations during an in-flight requery coalesce into one trailing requery", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  frame(socket, change(1, 5));
  const first = await h.calls.sessions.take();
  // When
  frame(socket, change(1, 6));
  frame(socket, change(1, 7, "runtime"));
  frame(socket, change(1, 8, "skills"));
  await h.events.refresh.take();
  first.resolve([{ id: "a" }]);
  // Then
  assert.equal((await h.events.session.take()).id, "a");
  await h.events.refresh.take();
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  assert.equal(h.calls.sessions.size, 0);
  h.live.stop();
});

test("a failed requery still refreshes the views and keeps the stream alive", async () => {
  // Given
  const h = liveHarness();
  const socket = await connected(h, 4);
  // When
  frame(socket, change(1, 5));
  (await h.calls.sessions.take()).reject(new h.ApiError(0, "cloud_pending", "pending"));
  // Then
  await h.events.refresh.take();
  frame(socket, change(1, 6));
  (await h.calls.sessions.take()).resolve([]);
  await h.events.refresh.take();
  assert.equal(socket.closed, false);
  assert.equal(h.events.session.size, 0);
  h.live.stop();
});
