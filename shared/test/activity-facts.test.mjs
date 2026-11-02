import assert from "node:assert/strict";
import test from "node:test";
import { createFactStore } from "../dist/activity-facts.js";
import { sessionTree, sessionUsage } from "../dist/activity-analysis.js";

const runtime = { schemaVersion: 1, capturedAtMs: 1000, activeRequests: [],
  ingest: { accepted: 7, rejected: 2, dropped: 3, lastError: { ts: 9, code: "fixture" } }, tz: "UTC" };
const row = (table, sourceOrder, values) => ({
  table, key: `${table}:${sourceOrder}`, revision: 1, operation: "upsert", sourceOrder, values,
});
const session = row("sessions", 1, {
  id: "s", runtime: "codex", runtime_session_id: "s", conversation_id: null, client_name: null,
  cwd: null, started_at: 0, ended_at: null, first_prompt: "first", end_orders_json: "{}",
});
const event = (id, order, kind, extra = {}) => row("events", order, {
  id, ts: 0, kind, source: "mcp", session_id: "s", attribution_method: "runtime_id", attribution_reason: null,
  runtime: "codex", trace_id: null, load_id: null, skill_uri: null, text: null, text_length: null,
  data_json: "{}", tool_use_id: null, turn_key: null, call_id: null, span_id: null, source_key: null,
  recording_orders_json: "{}", ...extra,
});

test("empty snapshot keeps unknown attribution null and supplied ingest values exact", () => {
  const store = createFactStore([], { runtime });
  assert.deepEqual(store.stats(), {
    attributionRate: { "claude-code": null, codex: null, gemini: null, cursor: null, omo: null, gajae: null, openclaw: null, unknown: null },
    abstainRate: 0, unusedSkills: [], lastEventByRuntime: {}, ingest: runtime.ingest,
    unattributed: { searches: 0, loads: 0 }, automatedSessions: 0,
  });
  assert.deepEqual(store.sessions({}), []);
  assert.equal(store.treeSessionData("missing"), undefined);
  assert.equal(store.getLoad("missing"), undefined);
  assert.deepEqual(store.reconcileLoads({ readOnly: true }), { count: 0, uris: [] });
  assert.deepEqual(store.listFlows({ limit: 10 }), []);
});

test("source_order resolves timestamp ties without mutating snapshot or leaking result mutations", () => {
  const rows = [event("a-second", 9, "load", { skill_uri: "skill://r/b/SKILL.md" }),
    session, event("z-first", 2, "load", { skill_uri: "skill://r/a/SKILL.md" }),
    event("prompt", 1, "prompt", { text: "raw\ntext" })];
  const before = structuredClone(rows), store = createFactStore(rows, { runtime });
  assert.deepEqual(store.sessions({})[0].skills, ["skill://r/a/SKILL.md", "skill://r/b/SKILL.md"]);
  assert.deepEqual(store.treeSessionData("s").events.map(e => e.id), ["prompt", "z-first", "a-second"]);
  store.treeSessionData("s").events[0].data.changed = true;
  store.stats().ingest.lastError.code = "changed";
  assert.deepEqual(rows, before);
  assert.equal(store.stats().ingest.lastError.code, "fixture");
  assert.deepEqual(store.treeSessionData("s").events[0].data, {});
  assert.equal(sessionUsage(sessionTree(store, "s")).spans[0].costUsd, null);
});

test("request runtime is snapshot-local and per-string substring retains long and Unicode values", () => {
  const text = "x".repeat(131071) + "İ\nEND";
  const rows = [session, event("prompt", 1, "prompt", { text }),
    event("request", 2, "skill_request", { data_json: JSON.stringify({
      requestId: "live", operation: "load", status: "in_progress",
    }) })];
  const active = createFactStore(rows, { runtime: { ...runtime, activeRequests: ["live"] } });
  const lost = createFactStore(rows, { runtime });
  assert.equal(active.sessions({})[0].requests.load.counts.in_progress, 1);
  assert.equal(lost.sessions({})[0].requests.load.counts.unknown, 1);
  for (const q of ["i\u0307", "\n", "xİ\nend", text]) assert.equal(active.sessions({ q }).length, 1);
  assert.equal(active.sessions({ q: "firstx" }).length, 0, "separate strings are never concatenated");
  assert.equal(active.sessions({ q: "%" }).length, 0, "SQL LIKE wildcard has no role");
});

test("a CDC deletion is rejected rather than silently treated as a reconstructed snapshot", () => {
  assert.throws(() => createFactStore([{ ...session, operation: "delete", values: null }], { runtime }), { code: "snapshot_required" });
});
