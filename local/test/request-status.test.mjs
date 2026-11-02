import test from "node:test";
import assert from "node:assert/strict";
import { distImport } from "./_helpers.mjs";
import { call, modernClient, withDaemon, uriOf, wire, metadata } from "./helpers/mcp.mjs";
import { openStore, event, NOW } from "./helpers/store.mjs";

const { requestRecords, summarizeRequests, hasStatus } = await distImport("request-status.js");
const lifecycle = (id, status, extra = {}, ts = 10) => ({ id: `${id}-${status}`, ts, kind: "skill_request",
  data: { requestId: id, operation: "load", status, ...extra } });

test("one request has one outcome; retries, active requests, cancellation and missing outcomes stay distinct", () => {
  const events = [lifecycle("failed", "in_progress"), lifecycle("failed", "failed", { errorCode: "unknown_resource" }),
    lifecycle("retry", "in_progress"), lifecycle("retry", "succeeded"), lifecycle("live", "in_progress"),
    lifecycle("lost", "in_progress"), lifecycle("cancel", "cancelled"),
    lifecycle("retry", "in_progress", {}, 0)]; // delayed start cannot overwrite completion
  const records = requestRecords(events, new Set(["live"]));
  assert.deepEqual(records.map((r) => r.status), ["failed", "succeeded", "in_progress", "unknown", "cancelled"]);
  const summary = summarizeRequests(records);
  assert.equal(summary.load.total, 5);
  assert.equal(Object.values(summary.load.counts).reduce((a, b) => a + b, 0), 5);
  assert.ok(hasStatus(summary.search, "not_attempted"));
  assert.ok(!hasStatus(summary.load, "not_attempted"));
  assert.equal(requestRecords([lifecycle("live", "in_progress")], new Set())[0].status, "unknown", "restart is not cancellation");
});

test("historical searches use total before page size; missing evidence never invents a reason", () => {
  const records = requestRecords([
    { id: "page", ts: 1, kind: "search", data: { candidates: [], total: 5 } },
    { id: "none", ts: 2, kind: "search", data: { candidates: [], total: 0, abstained: { reason: "no_overlap" } } },
    { id: "partial", ts: 3, kind: "search", data: {} },
    { id: "shell", ts: 4, kind: "error", data: { tool: "exec", code: "failed" } },
    { id: "ref", ts: 5, kind: "error", data: { tool: "resources/read", uri: uriOf("pr-review", "guide.md") } },
    { id: "nested-ref", ts: 5, kind: "error", data: { tool: "resources/read", uri: uriOf("pr-review", "refs/SKILL.md"), resourceKind: "supporting_file" } },
    { id: "load", ts: 6, kind: "error", skillUri: uriOf("pr-review"), data: { tool: "load_skill", code: "unknown_skill" } },
  ]);
  assert.equal(records.length, 4);
  assert.equal(records[0].result, "candidates_found");
  assert.equal(records[1].result, "no_candidates");
  assert.equal(records[1].reason, "no_overlap");
  assert.equal(records[2].result, undefined);
  assert.equal(records[3].status, "failed");
});

test("MCP attempts retain failure and retry without counting detailed observations twice", () => withDaemon(async (daemon) => {
  const client = modernClient(daemon.port);
  const meta = { threadId: "request-outcomes" };
  await call(client, "search_skills", { query: "pr-review code", limit: 1, offset: 100 }, meta);
  await call(client, "search_skills", { query: "" }, meta);
  await call(client, "search_skills", { limit: -1 }, meta);
  await assert.rejects(client.readResource({ uri: uriOf("missing"), _meta: meta }));
  await client.readResource({ uri: uriOf("pr-review"), _meta: meta });
  await client.readResource({ uri: uriOf("pr-review", "guide.md"), _meta: meta });
  const row = daemon.store.sessions({})[0];
  assert.equal(row.requests.search.total, 3);
  assert.deepEqual(row.requests.search.counts, { in_progress: 0, succeeded: 2, failed: 1, cancelled: 0, unknown: 0 });
  assert.deepEqual(row.requests.search.results, { candidates_found: 1, no_candidates: 1 });
  assert.equal(row.requests.search.reasons.empty_query, 1);
  assert.equal(row.requests.load.total, 2);
  assert.equal(row.requests.load.counts.failed, 1);
  assert.equal(row.requests.load.counts.succeeded, 1);
  assert.equal(daemon.store.sessions({ loadStatus: ["failed"] }).length, 1);
  assert.equal(daemon.store.sessions({ loadStatus: ["succeeded"] }).length, 1);
  assert.equal(daemon.store.sessions({ searchResult: ["no_candidates"] }).length, 1);
  const flow = daemon.store.flow({}, "load_requests");
  assert.equal(flow.requestCount, 2);
  assert.equal(flow.links.filter((l) => l.source.startsWith("t:")).reduce((n, l) => n + l.count, 0), 2);
  assert.deepEqual(new Set(flow.links.map((l) => l.state)), new Set(["failed", "succeeded"]));
  const trace = daemon.store.trace(row.id);
  const requests = requestRecords(trace.map((s, i) => ({ id: String(i), ts: s.ts, kind: s.kind, data: s.detail })));
  assert.equal(requests.length, 5, "the UI's trace projection must not double-count search/load/error events");
}));

test("an in-flight read is cancelled only by its caller's explicit notification", () => withDaemon(async (daemon) => {
  const read = daemon.catalog.readResource.bind(daemon.catalog);
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  daemon.catalog.readResource = async (uri) => { entered(); await gate; return read(uri); };
  const body = { jsonrpc: "2.0", id: "read-1", method: "resources/read", params: { uri: uriOf("pr-review"), _meta: metadata("codex", { threadId: "owner" }) } };
  const pending = wire(daemon.port, body);
  try {
    await started;
    let row = daemon.store.sessions({})[0];
    assert.equal(row.requests.load.counts.in_progress, 1);
    const cancel = (threadId) => wire(daemon.port, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "read-1", _meta: metadata("codex", { threadId }) } });
    await cancel("other");
    assert.equal(daemon.store.sessions({})[0].requests.load.counts.in_progress, 1);
    await cancel("owner");
    row = daemon.store.sessions({})[0];
    assert.equal(row.requests.load.counts.cancelled, 1);
    assert.equal(row.requests.load.counts.failed, 0);
    release();
    assert.equal((await pending).body.error.code, -32800);
    assert.equal(daemon.rows().filter((r) => r.kind === "load").length, 0);
  } finally { release(); await pending; }
}));

test("stored start without this process's active request is unknown, and generic errors do not imply load failure", () => {
  const { store } = openStore();
  try {
    const ref = { runtime: "codex", runtimeSessionId: "interrupted" };
    const id = store.upsertSession(ref, NOW);
    const attribution = { sessionId: id, method: "runtime_id" };
    store.append(event("prompt", NOW, ref, { text: "Read a skill" }), attribution);
    store.append(event("skill_request", NOW + 1, ref, { data: { requestId: "old-process", operation: "load", status: "in_progress" } }), attribution);
    store.append(event("error", NOW + 2, ref, { data: { tool: "shell", code: "failed" } }), attribution);
    const row = store.sessions({})[0];
    assert.equal(row.requests.load.counts.unknown, 1);
    assert.equal(row.requests.load.counts.failed, 0);
    assert.equal(store.sessions({ loadStatus: ["unknown"] }).length, 1);
    assert.equal(store.sessions({ loadStatus: ["not_attempted"] }).length, 0);
  } finally { store.close(); }
});
