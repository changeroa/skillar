import assert from "node:assert/strict";
import { test } from "node:test";
import { change, cloudHarness, cursor, frame, params, ready, replay, serveReport } from "./cloud-events-harness.test.mjs";

/** First subscriber: head read, socket, ready, live. */
async function connectAdapter(h, head = 4) {
  const sub = h.subscribe();
  assert.equal(await sub.states.take(), "connecting");
  (await h.fetches.changes.take()).resolve(Response.json(replay({ head })));
  const socket = await h.sockets.take();
  ready(socket, h.scheduler.now() + 300_000);
  assert.equal(await sub.states.take(), "live");
  await sub.refresh.take();
  return { sub, socket };
}

test("subscribers share one connection per adapter and the last unsubscribe closes everything", async () => {
  // Given
  const h = cloudHarness();
  const { sub, socket } = await connectAdapter(h);
  // When
  const late = h.subscribe();
  // Then
  assert.equal(await late.states.take(), "live");
  assert.equal(h.sockets.size, 0);
  sub.stop();
  assert.equal(socket.closed, false);
  late.stop();
  assert.equal(socket.closed, true);
  assert.equal(h.scheduler.pending().length, 0);
  assert.equal(h.visibility.listeners, 0);
  h.api.dispose();
});

test("head comparison and lease renewal use the real routes with same-origin credentials", async () => {
  // Given
  const h = cloudHarness();
  const sub = h.subscribe();
  await sub.states.take();
  const head = await h.fetches.changes.take();
  // Then
  assert.equal(head.path, "/api/changes");
  assert.equal(head.init.method, "GET");
  assert.equal(head.init.credentials, "same-origin");
  assert.equal(head.init.cache, "no-store");
  assert.equal(head.init.body, undefined);
  head.resolve(Response.json(replay({ head: 4 })));
  const socket = await h.sockets.take();
  ready(socket, h.scheduler.now() + 300_000);
  await sub.states.take();
  // When
  h.scheduler.fire();
  const lease = await h.fetches.lease.take();
  assert.equal(lease.path, "/api/events/lease");
  assert.equal(lease.init.method, "POST");
  assert.deepEqual(JSON.parse(lease.init.body), { connectionId: params(socket).get("connectionId") });
  lease.resolve(Response.json({ connectionId: params(socket).get("connectionId"), expiresAtMs: h.scheduler.now() + 300_000 }));
  const compare = await h.fetches.changes.take();
  assert.equal(compare.path, `/api/changes?since=${cursor(1, 4)}`);
  compare.resolve(Response.json(replay({ head: 4 })));
  // Then
  assert.deepEqual(h.scheduler.pending().map((timer) => timer.delayMs), [150_000]);
  h.api.dispose();
});

test("an activity invalidation requeries the last subscribed filter and emits only the changed rows", async () => {
  // Given
  const h = cloudHarness();
  const rows = [{ id: "a", runtime: "codex", startedAt: 1 }, { id: "b", runtime: "codex", startedAt: 2 }];
  const listing = h.api.sessions({ q: "alpha" });
  await serveReport(h, rows);
  assert.deepEqual(await listing, rows);
  const { sub, socket } = await connectAdapter(h);
  // When
  frame(socket, change(1, 5));
  // Then
  const query = await h.fetches.query.take();
  assert.deepEqual(JSON.parse(query.init.body).query, { kind: "sessions", filter: { q: "alpha" } });
  await serveReport(h, [{ ...rows[0], endedAt: 9 }, rows[1]], query);
  assert.deepEqual(await sub.sessions.take(), { ...rows[0], endedAt: 9 });
  await sub.refresh.take();
  assert.equal(sub.sessions.size, 0);
  assert.equal(h.fetches.changes.size, 0);
  h.api.dispose();
});

test("a 401 on the head comparison signs out once and tears down before any socket opens", async () => {
  // Given
  const h = cloudHarness();
  const sub = h.subscribe();
  await sub.states.take();
  // When
  (await h.fetches.changes.take()).resolve(new Response(null, { status: 401 }));
  // Then
  await sub.invalidated.take();
  assert.equal(h.unauthorized, 1);
  assert.equal(h.sockets.size, 0);
  assert.equal(h.scheduler.pending().length, 0);
  assert.equal(h.visibility.listeners, 0);
  await h.subscribe().invalidated.take();
  await assert.rejects(h.api.stats(), { code: "cloud_unauthorized" });
  assert.equal(h.unauthorized, 1);
  assert.equal(h.fetches.query.size, 0);
});

test("a 401 during a live requery tears the connection down once", async () => {
  // Given
  const h = cloudHarness();
  const { sub, socket } = await connectAdapter(h);
  frame(socket, change(1, 5));
  // When
  (await h.fetches.query.take()).resolve(new Response(null, { status: 401 }));
  // Then
  await sub.invalidated.take();
  assert.equal(h.unauthorized, 1);
  assert.equal(socket.closed, true);
  assert.equal(h.scheduler.pending().length, 0);
  assert.equal(sub.refresh.size, 0);
});

test("dispose closes the connection and aborts the requery in flight", async () => {
  // Given
  const h = cloudHarness();
  const { sub, socket } = await connectAdapter(h);
  frame(socket, change(1, 5));
  const query = await h.fetches.query.take();
  // When
  h.api.dispose();
  // Then
  await sub.invalidated.take();
  assert.equal(query.init.signal.aborted, true);
  assert.equal(socket.closed, true);
  assert.equal(h.scheduler.pending().length, 0);
  assert.equal(h.visibility.listeners, 0);
});

test("health accepts a live-capable transport report without asserting it", async () => {
  // Given
  const h = cloudHarness();
  const pending = h.api.health();
  // When
  (await h.fetches.other.take()).resolve(Response.json({ ok: true, version: "cloud", transport: "live" }));
  // Then
  assert.deepEqual(await pending, { ok: true, version: "cloud", transport: "live" });
  h.api.dispose();
});
