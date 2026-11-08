import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { distImport } from "./_helpers.mjs";
import { bearer, http, jsonHeaders, startTestServer } from "./helpers/api.mjs";
import { event, NOW, openStore, seedSession } from "./helpers/store.mjs";

const { CAPTURE_RUNTIMES, captureProbePayload, createCaptureDiagnostics } = await distImport("diagnostics/capture.js");
const { createIngestDeps, ingestHook } = await distImport("ingest/pipeline.js");
const { normalizeHook } = await distImport("ingest/hooks.js");
const { openDb } = await distImport("store/db.js");
const { createStore } = await distImport("store/index.js");

test("each runtime round trip verifies committed capture without leaving sessions or changing usage counters", async (t) => {
  for (const captureLevel of ["metadata", "redacted", "full"]) {
    await t.test(captureLevel, async (t) => {
      const server = await startTestServer({ captureLevel });
      t.after(() => server.stop());
      const get = (path) => http(server.port, { path, headers: bearer(server.token) });
      const before = (await get("/api/stats")).json;
      for (const runtime of CAPTURE_RUNTIMES) {
        const response = await http(server.port, { method: "POST", path: "/api/diagnostics/capture",
          headers: jsonHeaders(server.token), body: JSON.stringify({ runtime }) });
        assert.equal(response.status, 200);
        assert.equal(response.json.runtime, runtime);
        assert.equal(response.json.scope, "daemon_ingest");
        assert.equal(response.json.ok, true, JSON.stringify(response.json));
        assert.deepEqual(response.json.checks.map((check) => [check.stage, check.status]),
          ["transport", "authentication", "storage", "attribution"].map((stage) => [stage, "passed"]));
        const status = (await get("/api/diagnostics/capture")).json;
        const row = status.runtimes.find((entry) => entry.runtime === runtime);
        assert.equal(row.lastProbe.id, response.json.id);
        assert.equal(row.lastProbe.ok, true);
        assert.equal(row.lastEventAt, null, "a diagnostic is not observed agent usage");
        assert.equal(row.mcpAttributionRate, null);
      }
      assert.deepEqual((await get("/api/sessions")).json, []);
      assert.deepEqual((await get("/api/stats")).json.ingest, before.ingest);
      const db = new DatabaseSync(join(server.skillarHome, "skillar.db"), { readOnly: true });
      try {
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pane_sessions").get().n, 0);
      } finally {
        db.close();
      }
    });
  }
});

test("diagnostic routes require authentication and reject unsupported runtimes and extra request fields", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  assert.equal((await http(server.port, { path: "/api/diagnostics/capture" })).status, 401);
  assert.equal((await http(server.port, { method: "POST", path: "/api/diagnostics/capture",
    headers: { "Content-Type": "application/json" }, body: '{"runtime":"codex"}' })).status, 401);
  for (const body of [{ runtime: "unknown" }, { runtime: "codex", token: "not-accepted" }, {}, { runtime: ["codex"] }]) {
    assert.equal((await http(server.port, { method: "POST", path: "/api/diagnostics/capture",
      headers: jsonHeaders(server.token), body: JSON.stringify(body) })).status, 400);
  }
});

test("capture health reports real source counts, null versus zero attribution, and each orphan reason", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const store = createStore(openDb(join(server.skillarHome, "skillar.db")), { now: () => NOW });
  try {
    const sid = seedSession(store, { runtime: "codex", startedAt: NOW, kind: "not_used", prompt: "human task", key: "health-real" });
    for (const [i, reason] of ["no_session", "ambiguous", "stale", undefined].entries()) {
      store.append(event("search", NOW + i, { runtime: "codex" }, { source: "mcp" }),
        { sessionId: "unattributed", method: "none", ...(reason ? { reason } : {}) });
    }
    store.append(event("search", NOW + 10, { runtime: "codex", runtimeSessionId: "health-real" }, { source: "mcp" }),
      { sessionId: sid, method: "vendor_meta" });
    store.append(event("search", NOW, { runtime: "cursor" }, { source: "mcp" }),
      { sessionId: "unattributed", method: "none", reason: "no_session" });
  } finally {
    store.close();
  }
  const health = (await http(server.port, { path: "/api/diagnostics/capture", headers: bearer(server.token) })).json;
  const codex = health.runtimes.find((row) => row.runtime === "codex");
  assert.deepEqual(codex.sources, { hook: 2, otel: 0, mcp: 5 });
  assert.equal(codex.lastEventAt, NOW + 1000);
  assert.equal(codex.mcpAttributionRate, 1 / 5);
  assert.deepEqual(codex.unattributedReasons, { no_session: 1, ambiguous: 1, stale: 1, unreported: 1 });
  assert.equal(health.runtimes.find((row) => row.runtime === "cursor").mcpAttributionRate, 0);
  assert.equal(health.runtimes.find((row) => row.runtime === "gemini").mcpAttributionRate, null);
});

test("health and real session history survive a probe and its last report survives daemon restart", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const store = createStore(openDb(join(server.skillarHome, "skillar.db")), { now: () => NOW });
  const id = seedSession(store, { runtime: "codex", startedAt: NOW, kind: "not_used", prompt: "keep this session", key: "keep" });
  store.close();
  const get = (path) => http(server.port, { path, headers: bearer(server.token) });
  const before = (await get(`/api/sessions/${id}/trace`)).json;
  const probe = await http(server.port, { method: "POST", path: "/api/diagnostics/capture",
    headers: jsonHeaders(server.token), body: '{"runtime":"codex"}' });
  assert.equal(probe.json.ok, true);
  assert.deepEqual((await get(`/api/sessions/${id}/trace`)).json, before);
  const db = openDb(join(server.skillarHome, "skillar.db"));
  const restored = createCaptureDiagnostics(db, { post: async () => { throw new Error("not called"); } });
  try {
    assert.equal(restored.health().runtimes.find((row) => row.runtime === "codex").lastProbe.id, probe.json.id);
  } finally {
    restored.close();
    db.close();
  }
});

test("a 202 acknowledgement alone is not a successful capture test", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { db, store } = openStore();
  const diagnostics = createCaptureDiagnostics(db, { post: async () => ({ status: 202 }), now: () => NOW, timeoutMs: 100 });
  try {
    const result = diagnostics.run("codex");
    t.mock.timers.tick(100);
    const report = await result;
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => check.stage === "storage").code, "capture_not_stored");
    assert.equal(report.checks.find((check) => check.stage === "attribution").status, "not_run");
  } finally {
    diagnostics.close();
    store.close();
  }
});

test("authentication and transport failures identify the failed stage without claiming storage success", async () => {
  for (const post of [async () => ({ status: 401 }), async () => { throw new Error("unreachable"); }]) {
    const { db, store } = openStore();
    const diagnostics = createCaptureDiagnostics(db, { post, now: () => NOW });
    try {
      const report = await diagnostics.run("codex");
      assert.equal(report.ok, false);
      assert.equal(report.checks.filter((check) => check.status === "failed").length, 1);
      assert.equal(report.checks.find((check) => check.stage === "storage").status, "not_run");
      assert.equal(diagnostics.health().runtimes.find((row) => row.runtime === "codex").lastProbe.id, report.id);
    } finally {
      diagnostics.close();
      store.close();
    }
  }
});

test("committed but unattributed diagnostic events fail attribution and are removed individually", async () => {
  const { db, store } = openStore();
  let diagnostics;
  diagnostics = createCaptureDiagnostics(db, { now: () => NOW, post: async (runtime, payload) => {
    const captured = normalizeHook(runtime, payload, NOW).events[0];
    const attribution = { sessionId: "unattributed", method: "none", reason: "no_session" };
    store.append(captured, attribution);
    diagnostics.observe({ sessionId: "unattributed", attribution, event: captured });
    return { status: 202 };
  } });
  try {
    const report = await diagnostics.run("codex");
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => check.stage === "storage").status, "passed");
    assert.equal(report.checks.find((check) => check.stage === "attribution").code, "capture_not_attributed");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 0);
  } finally {
    diagnostics.close();
    store.close();
  }
});

test("probe IDs are scoped to pending work and their sessions cannot affect real attribution windows", async () => {
  const { db, store } = openStore();
  let diagnostics;
  const ingest = createIngestDeps(store, { now: () => NOW, isDiagnostic: (event) => diagnostics.isProbe(event),
    publish: (change) => diagnostics.observe(change) });
  diagnostics = createCaptureDiagnostics(db, { now: () => NOW, post: async (runtime, payload) => {
    ingestHook(runtime, payload, ingest);
    assert.equal(store.openSessions(runtime, 0).length, 0);
    return { status: 202 };
  } });
  try {
    assert.equal((await diagnostics.run("codex")).ok, true);
    const fake = normalizeHook("codex", captureProbePayload("codex", "skillar-capture-not-pending"), NOW).events[0];
    assert.equal(diagnostics.isProbe(fake), false);
    ingestHook("codex", captureProbePayload("codex", "skillar-capture-not-pending"), ingest);
    assert.equal(store.stats().ingest.accepted, 1);
    assert.equal(store.openSessions("codex", 0).length, 1);
  } finally {
    diagnostics.close();
    store.close();
  }
});
