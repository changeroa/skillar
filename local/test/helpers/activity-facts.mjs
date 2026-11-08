import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { distImport } from "../_helpers.mjs";
import { seedForty, NOW, DAY, uri, skillEntry } from "./store.mjs";
import { createFactStore } from "../../../shared/dist/activity-facts.js";
import { contentTables, contentRowSchema } from "../../../shared/dist/activity-content.js";

const { openDb } = await distImport("store/db.js");
const { createStore } = await distImport("store/index.js");
const { activeRequests } = await distImport("request-status.js");
const { readIngestCounters } = await distImport("store/writes.js");
const { registerFlowRoutes } = await distImport("api/flows.js");

export { NOW, DAY, uri, activeRequests, createFactStore };
export const fixtureJson = name => JSON.parse(readFileSync(new URL(`../../../shared/parity-fixtures/${name}.json`, import.meta.url), "utf8"));

/** Read actual migrated source tables, including SQLite rowid, without reencoding any source values. */
export function snapshot(db) {
  return contentTables.flatMap(table => db.prepare(`SELECT ${table === "load_candidates" ? "NULL" : "rowid"} AS source_order, * FROM ${table}`).all().map(row => {
    const { source_order, ...values } = row;
    return contentRowSchema.parse({ table, key: table === "load_candidates" ? JSON.stringify([values.load_id, values.session_id]) : `${table}:${source_order}`, revision: 1,
      operation: "upsert", sourceOrder: source_order, values });
  }));
}

export function parityStore(t, options = {}) {
  const db = openDb(":memory:");
  let now = options.now ?? NOW;
  const tz = options.tz ?? "UTC";
  const store = createStore(db, { now: () => now, tz });
  const oldActive = [...activeRequests];
  t.after(() => {
    store.close();
    activeRequests.clear();
    for (const id of oldActive) activeRequests.add(id);
  });
  const runtime = () => ({ schemaVersion: 1, capturedAtMs: now, activeRequests: [...activeRequests],
    ingest: readIngestCounters(db), tz });
  const facts = (overrides = {}) => createFactStore(snapshot(db).reverse(), { runtime: runtime(), now: () => now, ...overrides });
  return { db, store, runtime, facts, setNow: value => { now = value; } };
}

export function seedParity(t) {
  const f = parityStore(t);
  const { db, store } = f;
  const ids = seedForty(store);
  let serial = 0;
  const session = (id, at = NOW - 1000, prompt = null, runtime = "codex") => {
    db.prepare("INSERT INTO sessions(id,runtime,runtime_session_id,conversation_id,started_at,first_prompt) VALUES (?,?,?,?,?,?)")
      .run(id, runtime, id, `conv-${id}`, at, prompt);
    return id;
  };
  const add = (sid, kind, ts, extra = {}) => {
    const id = extra.id ?? `fact-${++serial}`;
    store.append({ id, kind, ts, source: kind === "load" || kind === "search" || kind === "skill_request" ? "mcp" : "otel",
      ref: { runtime: "codex", runtimeSessionId: sid }, data: {}, ...extra },
    sid === "unattributed" ? { sessionId: sid, method: "none", reason: "ambiguous" } : { sessionId: sid, method: "runtime_id" });
    return id;
  };
  const human = session("z-human", NOW - 2000, "Alpha İ 한글\nline TWO");
  session("a-human", NOW - 2000, "Beta second");
  session("no-activity");
  session("empty-search");
  session("requests-only");
  add("empty-search", "search", NOW - 500, { data: { total: 0, abstained: { reason: "empty_query" } } });
  add("requests-only", "skill_request", NOW - 500, { data: { requestId: "request-only", operation: "load", status: "in_progress" } });
  for (const [id, prompt] of [
    ["title", "Generate a concise, single-line task title for me"],
    ["recap", '{"previousRecap":"x"}'],
    ["cron", "[cron:163f8bb6-9643-4f7f-9bbc-09972d5c63e1 task] work"],
    ["reflection", '<file name="/tmp/runtime/reflection/run.md">'],
    ["dream", "Write a dream diary entry from these memory fragments"],
  ]) {
    session(id, NOW - 700, prompt);
    add(id, "prompt", NOW - 699, { text: prompt });
  }
  const states = ["in_progress", "succeeded", "failed", "cancelled", "unknown"];
  for (const operation of ["search", "load"]) {
    for (const [i, status] of states.entries()) {
      const requestId = `${operation}-${status}`;
      const data = { requestId, operation, status, startedAt: NOW - 1300, uri: uri(`request-${i}`),
        firstCandidateUri: uri("pr-review-ko"), total: i % 2, errorCode: "fixture_error",
        ...(i === 1 ? { abstained: { reason: "below_threshold" } } : {}) };
      add(human, "skill_request", NOW - 1200 + i, { data });
      if (status === "succeeded") {
        add(human, operation, NOW - 1100, { skillUri: data.uri, data });
        add(human, "skill_request", NOW - 1000, { data: { ...data, status: "in_progress" } });
      }
    }
    activeRequests.add(`${operation}-in_progress`);
  }
  add(human, "prompt", NOW - 2000, { id: "z-tie-prompt", text: "raw\nprompt", turnKey: "turn" });
  add(human, "load", NOW - 1500, { id: "z-tie-load", skillUri: uri("pr-review-ko"), loadId: "raw-load", turnKey: "turn" });
  add(human, "load", NOW - 1500, { id: "a-tie-load", skillUri: uri("database-query"), loadId: "new-load", turnKey: "turn" });
  add(human, "load", NOW - 1500, { data: { uri: uri("pr-review-ko") } });
  add(human, "search", NOW - 1400, { traceId: "chosen-trace", data: {
    query: "query\nboundary", candidates: [{ uri: uri("pr-review-ko"), name: "review", rank: 2 },
      { uri: uri("database-query"), name: "db", rank: 1 }], total: 10, elapsedMs: 0,
  } });
  add(human, "load", NOW - 1400, { traceId: "chosen-trace", skillUri: uri("pr-review-ko") });
  add(human, "native_skill", NOW - 900, { data: { name: "native", via: "otel" }, turnKey: "turn" });
  add(human, "read_file", NOW - 899, { data: { uri: "refs/SKILL.md", size: 0 }, skillUri: uri("pr-review-ko") });
  add(human, "error", NOW - 898, { data: { tool: "resources/read", resourceKind: "supporting_file", uri: uri("nested") } });
  add(human, "error", NOW - 897, { data: { tool: "load_skill", code: "missing", message: "fixture" }, skillUri: uri("missing") });
  add(human, "tool_call", NOW - 896, { text: '{"a":0}', textLength: 0, toolUseId: "same-tool", callId: "call", spanId: "exact",
    data: { name: "Edit", toolName: "Read", success: false, durationMs: 0, otelTraceId: "exact-trace" } });
  add(human, "llm_call", NOW - 895, { turnKey: "turn", data: { inputTokens: 0, outputTokens: 7, costUsd: 0, inputIncludesCache: true } });
  add(human, "llm_call", NOW - 894, { turnKey: "turn", data: { totalTokens: 42 } });
  add(human, "tool_call", NOW - 896, { id: "a-tool-tie", toolUseId: "same-tool", data: { tool: "Bash" } });
  store.putLoad({ loadId: "raw-load", uri: uri("pr-review-ko"), manifestDigest: "raw manifest", resources: [{ uri: uri("pr-review-ko"), digest: "raw digest", size: 0 }] });
  store.putLoad({ loadId: "new-load", uri: uri("pr-review-ko"), manifestDigest: "", resources: [] });
  store.upsertSkills([skillEntry("never-used"), skillEntry("removed")]);
  store.markRemoved([uri("removed")]);
  store.addEvalCase({ query: "q", expectedUri: uri("pr-review-ko") });
  store.addEvalCase({ query: "\n" });
  store.countIngest("accepted");
  store.countIngest("rejected", "bad_fixture");
  store.countIngest("dropped");
  db.exec(`INSERT INTO herdr_workspaces(id,label,created_ms) VALUES ('w','workspace',0),('loose',NULL,NULL);
    INSERT INTO herdr_tabs(id,workspace_id,created_ms) VALUES ('tab','w',0),('cross','w',NULL);
    INSERT INTO herdr_panes(id,workspace_id,tab_id,created_ms) VALUES ('p','w','tab',0),('cross-p','w','cross',NULL);
    INSERT INTO pane_sessions(pane_id,agent_session_value,session_id,source,first_seen_ms,last_seen_ms)
      VALUES ('p','z-human','z-human','reported',0,NULL),('p','a-human','a-human','unlinked',NULL,0),
      ('p','unknown',NULL,NULL,0,NULL),('cross-p','title','title','inferred:cwd_time',0,0)`);
  f.setNow(NOW - 1000);
  const { row: spec } = store.putWorkflowSpec({ name: "pipeline", steps: [
    { id: "work", skills: ["native", "pr-review-ko"], together: true, expectTools: ["Read"] },
    { id: "unrun", skills: ["none"], together: false, expectTools: [] },
  ] });
  const { flow } = store.createFlow({ workspaceId: "w", tabId: "tab", specId: spec.id });
  store.mapFlowStep(flow.id, "p", "work");
  store.mapFlowStep(flow.id, "cross-p", "work");
  store.mapFlowStep(flow.id, "unseen-pane", "unrun");
  const pending = add("unattributed", "load", NOW - 500, { skillUri: uri("pending"), data: { attributionCandidates: [human, "a-human"] } });
  const proof = add(human, "tool_call", NOW - 499, { source: "otel", text: JSON.stringify({ server: "skillar", uri: uri("pending") }), data: { success: true } });
  const spans = [
    { traceId: "conv", spanId: "null", conversationId: human },
    { traceId: "conv", spanId: "zero", conversationId: human, startMs: 0, endMs: 0 },
    { traceId: "call", spanId: "call", callId: "call", startMs: NOW - 400 },
    { traceId: "exact-trace", spanId: "exact", startMs: NOW - 400 },
    { traceId: "foreign", spanId: "foreign", conversationId: "other", callId: "call", startMs: NOW - 400 },
  ];
  store.putSpans(spans.map(s => ({ name: "codex.turn_input", runtime: "codex", receivedAt: 0, ...s })));
  add(human, "llm_call", NOW - 400, { id: "z-owned-end", turnKey: "turn", data: { costUsd: 0.1 } });
  f.setNow(NOW - 400);
  store.endFlow(flow.id);
  add(human, "llm_call", NOW - 400, { id: "a-late-end", turnKey: "turn", data: { costUsd: 999 } });
  add(human, "llm_call", NOW - 401, { id: "late-interior", turnKey: "turn", data: { costUsd: 0.2 } });
  store.putWorkflowSpec({ name: "pipeline", steps: [] });
  db.exec(`INSERT INTO flows(id,workspace_id,registered_ms,ended_ms) VALUES ('legacy','w',0,0);
    INSERT INTO flows(id,workspace_id,registered_ms) VALUES ('null-flow',NULL,NULL)`);
  f.setNow(NOW);
  return { ...f, ids: [...ids, human, "a-human"], human, flowId: flow.id, pending, proof, add, session };
}

export function assertReadParity(local, facts, cases) {
  for (const [method, ...args] of cases) {
    assert.deepStrictEqual(facts[method](...args), local[method](...args), `${method}(${JSON.stringify(args)})`);
  }
}

/** Invoke the real synchronous Express handlers, including complete report orchestration and DTO projections. */
export function reportReader(store) {
  const handlers = new Map();
  registerFlowRoutes({ get(path, handler) { handlers.set(path, handler); } }, {
    store, log(message) { throw new Error(message); },
  });
  return (path, params = {}, query = {}) => {
    let output, status = 200;
    const response = { status(value) { status = value; return this; }, json(value) { output = value; return this; } };
    handlers.get(path)({ method: "GET", path, params, query }, response);
    return { status, body: JSON.parse(JSON.stringify(output)) };
  };
}

export function seedMembershipCut(t) {
  const f = parityStore(t, { now: 1000 });
  f.db.exec(`INSERT INTO sessions(id,runtime,runtime_session_id,started_at) VALUES ('s','codex','own',900);
    INSERT INTO herdr_workspaces(id,created_ms) VALUES ('w',0);
    INSERT INTO herdr_tabs(id,workspace_id,created_ms) VALUES ('main','w',0),('other','w',0);
    INSERT INTO herdr_panes(id,workspace_id,tab_id,created_ms) VALUES ('p','w','other',0)`);
  const { row: spec } = f.store.putWorkflowSpec({ name: "late", steps: [] });
  const { flow } = f.store.createFlow({ workspaceId: "w", tabId: "main", specId: spec.id });
  f.store.mapFlowStep(flow.id, "p", "mapped");
  const append = (id, ts, extra = {}) => f.store.append({
    id, ts, kind: "tool_call", source: "otel", ref: { runtime: "codex" }, data: {}, ...extra,
  }, { sessionId: "s", method: "runtime_id" });
  append("start", 1000, { callId: "start" });
  append("inside", 1050, { callId: "call", spanId: "exact", data: { otelTraceId: "exact" } });
  append("end", 1100, { kind: "session_end" });
  f.store.putSpans([
    { traceId: "conv", spanId: "conv", conversationId: "own" },
    { traceId: "call", spanId: "call", callId: "call" },
    { traceId: "start", spanId: "start", callId: "start" },
    { traceId: "exact", spanId: "exact" },
  ].map(s => ({ ...s, runtime: "codex", name: "codex.turn_input", receivedAt: 0, startMs: 1100 })));
  f.setNow(1100);
  f.store.endFlow(flow.id);
  return { ...f, flow };
}
