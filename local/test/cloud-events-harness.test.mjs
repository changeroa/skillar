import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";

// Shared fixtures for the cloud-events suites; this file deliberately registers no tests.
const bundled = await build({
  stdin: {
    contents: 'export * from "./cloud-events.ts"; export { createCloudApi } from "./cloud.ts"; export { ApiError } from "./api.ts";',
    resolveDir: new URL("../dashboard/", import.meta.url).pathname, loader: "ts", sourcefile: "harness-entry.ts",
  },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
});
export const modules = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

export const SCOPE = "ab".repeat(32);
export const ORIGIN = "https://skillar.sh";
export const cursor = (generation, seq) => `${SCOPE}.${generation}.${seq}`;
export const change = (generation, seq, invalidationKind = "activity") => ({ generation, seq, invalidationKind });
export const replay = ({ state = "ok", head, cursor: at = cursor(1, head), changes = [], hasMore = false }) =>
  ({ state, head, cursor: at, changes, hasMore });
export const params = (socket) => new URL(socket.target.url, ORIGIN).searchParams;

export function channel(label) {
  const items = [], waiters = [];
  return {
    push(item) {
      const waiter = waiters.shift();
      if (waiter) waiter(item); else items.push(item);
    },
    take(timeoutMs = 2000) {
      if (items.length) return Promise.resolve(items.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
        waiters.push((item) => { clearTimeout(timer); resolve(item); });
      });
    },
    get size() { return items.length; },
  };
}

export function fakeScheduler(start = 1_700_000_000_000) {
  let now = start;
  const timers = [];
  return {
    now: () => now,
    schedule(delayMs, task) {
      const timer = { at: now + delayMs, delayMs, task, active: true };
      timers.push(timer);
      return () => { timer.active = false; };
    },
    pending: () => timers.filter((timer) => timer.active),
    fire() {
      const [next] = timers.filter((timer) => timer.active).sort((a, b) => a.at - b.at);
      assert.ok(next, "a timer must be pending");
      next.active = false;
      now = next.at;
      next.task();
      return next;
    },
  };
}

export function fakeVisibility(visible = true) {
  const listeners = new Set();
  return {
    visible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      visible = next;
      for (const listener of listeners) listener();
    },
    get listeners() { return listeners.size; },
  };
}

export function fakeTransport() {
  const sockets = channel("socket");
  const connect = (target, events) => {
    const socket = { target, events, closed: false, close() { socket.closed = true; } };
    sockets.push(socket);
    return socket;
  };
  return { connect, sockets };
}
export const frame = (socket, message, id = null) => socket.events.onFrame({ data: JSON.stringify(message), cursor: id });
export const ready = (socket, expiresAtMs, at = params(socket).get("since")) =>
  frame(socket, { type: "ready", connectionId: params(socket).get("connectionId"), expiresAtMs, cursor: at });

function pendingCall(record, signal) {
  const call = { ...record, signal, ...Promise.withResolvers() };
  signal.addEventListener("abort", () => call.reject(signal.reason ?? new DOMException("aborted", "AbortError")), { once: true });
  return call;
}

export function fakeRest() {
  const calls = { changes: channel("changes call"), lease: channel("lease call"), sessions: channel("sessions call") };
  const method = (name) => (...args) => {
    const call = pendingCall({ args }, args.at(-1));
    calls[name].push(call);
    return call.promise;
  };
  return { rest: { changes: method("changes"), lease: method("lease"), sessions: method("sessions") }, calls };
}

export function fakeSink() {
  const events = { state: channel("state"), session: channel("session"), refresh: channel("refresh") };
  const log = [];
  const sink = {
    onState: (state) => { log.push(`state:${state}`); events.state.push(state); },
    onSession: (row) => { log.push(`session:${row.id}`); events.session.push(row); },
    onRefresh: () => { log.push("refresh"); events.refresh.push(true); },
  };
  return { sink, events, log };
}

export function liveHarness(options = {}) {
  const transport = fakeTransport(), scheduler = fakeScheduler(), visibility = fakeVisibility();
  const { rest, calls } = fakeRest();
  const { sink, events, log } = fakeSink();
  const live = modules.createCloudLive(rest, sink, {
    connect: transport.connect, scheduler, visibility, transports: ["websocket", "sse"], reconnectMs: [1000, 8000], ...options,
  });
  return { live, calls, events, log, sockets: transport.sockets, scheduler, visibility, ApiError: modules.ApiError };
}

/** Standard opening: head read without since, socket at that cursor, ready from the server, live. */
export async function connected(h, head = 4) {
  h.live.start();
  assert.equal(await h.events.state.take(), "connecting");
  const first = await h.calls.changes.take();
  assert.equal(first.args[0], null);
  first.resolve(replay({ head }));
  const socket = await h.sockets.take();
  ready(socket, h.scheduler.now() + 300_000);
  assert.equal(await h.events.state.take(), "live");
  await h.events.refresh.take();
  return socket;
}

const routeOf = (path) => path.startsWith("/api/changes") ? "changes" : path === "/api/events/lease" ? "lease"
  : path === "/api/dashboard/query" ? "query" : path === "/api/dashboard/reports/result" ? "result" : "other";

export function cloudHarness() {
  const transport = fakeTransport(), scheduler = fakeScheduler(), visibility = fakeVisibility();
  const fetches = { changes: channel("changes fetch"), lease: channel("lease fetch"), query: channel("query fetch"), result: channel("result fetch"), other: channel("fetch") };
  const h = { unauthorized: 0, fetches, sockets: transport.sockets, scheduler, visibility };
  h.api = modules.createCloudApi({ deviceId: "fixture-device", sourceDomain: "fixture-source" }, {
    onUnauthorized: () => h.unauthorized++,
    fetch: (path, init) => {
      const call = pendingCall({ path, init }, init.signal);
      fetches[routeOf(path)].push(call);
      return call.promise;
    },
    live: { connect: transport.connect, scheduler, visibility, transports: ["websocket", "sse"], reconnectMs: [1000, 8000] },
  });
  h.subscribe = () => {
    const sub = { states: channel("state"), sessions: channel("session"), refresh: channel("refresh"), invalidated: channel("invalidate") };
    sub.stop = h.api.events({
      onState: (state) => sub.states.push(state), onSession: (row) => sub.sessions.push(row),
      onRefresh: () => sub.refresh.push(true), onInvalidate: () => sub.invalidated.push(true),
    });
    return sub;
  };
  return h;
}

export function reportWire(payload, revision = { sequence: 2, journalThrough: 3, runtimeSequence: 1 }) {
  const bytes = Buffer.from(JSON.stringify({
    generatedAt: 100, inputRevision: revision, analysisVersion: 1, coverage: { complete: true, fromMs: 0, toMs: 200 },
    sourceCapturedAt: 90, sourceReceivedAt: 95, pending: false, payload,
  }));
  const chunks = [bytes.subarray(0, 17), bytes.subarray(17)];
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  return {
    status: {
      schemaVersion: 1, jobId: "11223344-1122-4122-8122-112233445566", state: "complete", generatedAt: 100, sourceCapturedAt: 90,
      sourceReceivedAt: 95, inputRevision: revision, analysisVersion: 1, stale: true, pending: false, error: null,
      result: { parts: 2, bytes: bytes.length, hash: digest(bytes) },
    },
    parts: chunks.map((chunk, index) => ({ index, bytes: chunk.length, hash: digest(chunk), body: chunk.toString("base64") })),
  };
}

/** Answers one report read (query, then both result parts) with the given payload. */
export async function serveReport(h, payload, query) {
  const wire = reportWire(payload);
  (query ?? await h.fetches.query.take()).resolve(Response.json(wire.status));
  for (let served = 0; served < wire.parts.length; served++) {
    const part = await h.fetches.result.take();
    part.resolve(Response.json(wire.parts[JSON.parse(part.init.body).part]));
  }
}
