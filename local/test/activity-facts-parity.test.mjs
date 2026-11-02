import assert from "node:assert/strict";
import test from "node:test";
import { distImport } from "./_helpers.mjs";
import { seedParity, seedMembershipCut, parityStore, snapshot, assertReadParity, fixtureJson, reportReader,
  activeRequests, createFactStore, NOW, DAY, uri } from "./helpers/activity-facts.mjs";
import * as analysis from "../../shared/dist/activity-analysis.js";

const { compareFlow } = await distImport("workflow/compare.js");
const { localDowHour } = await distImport("store/index.js");
const statuses = ["not_attempted", "in_progress", "succeeded", "failed", "cancelled", "unknown"];

test("all synchronous fact read methods equal actual local Store on identical source rows", t => {
  const f = seedParity(t), facts = f.facts();
  const scope = f.store.flowEventScope(f.flowId);
  const cases = [
    ["sessions", {}], ["trace", f.human], ["trace", "missing"],
    ["flow", {}, "first_load"], ["flow", {}, "all_loads"], ["flow", {}, "search_requests"], ["flow", {}, "load_requests"],
    ["heatmap", {}, "Asia/Seoul", 1, 2], ["skillWeek", {}], ["stats"], ["stats", { from: NOW - 600, to: NOW }],
    ["treeSessionData", f.human], ["treeSessionData", f.human, scope], ["treeSessionData", "missing"],
    ["treeFlowData", "w"], ["treeFlowData", f.flowId], ["treeFlowData", f.flowId, scope], ["treeFlowData", "loose"], ["treeFlowData", "missing"],
    ["outsideHerdrSessionIds", { from: 0, to: NOW + DAY, limit: 100 }],
    ["outsideHerdrSessions", { from: 0, to: NOW + DAY, limit: 2, automated: "exclude" }],
    ["outsideHerdrSessions", { from: 0, to: NOW + DAY, limit: 2, automated: "only" }],
    ["sessionAutomation", [...f.ids, "title", "no-activity", "empty-search", "requests-only", "missing"]],
    ["getLoad", "raw-load"], ["getLoad", "missing"], ["latestLoad", uri("pr-review-ko")], ["latestLoad", "missing"],
    ["traceSession", "chosen-trace"], ["traceSession", "missing"],
    ["findEventByToolUseId", "same-tool"], ["findEventByToolUseId", "missing"],
    ["hasSourceKey", "missing"], ["openSessions", "codex", 0], ["openSessions", "unknown", 0], ["evalCases"],
    ["workflowSpecs"], ["workflowSpecVersions", "pipeline"], ["workflowSpecVersions", "missing"],
    ["workflowSpec", "pipeline"], ["workflowSpec", "pipeline", 1], ["workflowSpec", "pipeline", 99],
    ["getFlow", f.flowId], ["getFlow", "null-flow"], ["getFlow", "missing"], ["flowSteps", f.flowId], ["flowSteps", "missing"],
    ["flowPaneUsage", f.flowId], ["flowPaneUsage", f.flowId, { excludeSessions: [f.human], scope }],
    ["flowSessionIds", f.flowId], ["flowSessionIds", f.flowId, scope], ["flowSessionIds", "missing"],
    ["flowEventScope", f.flowId], ["flowEventScope", "legacy"], ["flowEventScope", "null-flow"], ["flowEventScope", "missing"],
    ["flowUnattributedLoads", f.flowId, [f.human]], ["flowUnattributedLoads", f.flowId, [f.human], scope],
    ["flowUnattributedLoads", "missing", [f.human]],
    ["listFlows", { from: 0, to: NOW + 1, limit: 100, automated: "include" }],
    ["listFlows", { limit: 1 }], ["listFlows", { from: 0, limit: 100, automated: "only" }],
    ["reconcileLoads", { readOnly: true }],
    ["reconcileLoads", { readOnly: true, sessionIds: [f.human], from: NOW - 1000, to: NOW }],
    ["reconcileLoads", { readOnly: true, eventId: f.proof }],
    ["reconcileLoads", { readOnly: true, eventId: f.pending }],
    ["reconcileLoads", { readOnly: true, eventId: "missing" }],
    ["reconcileLoads", { readOnly: true, limit: 1 }],
    ["reconcileLoads", { readOnly: true, limit: 1, after: f.pending }],
  ];
  assert.deepEqual([...new Set(cases.map(c => c[0]))].sort(), Object.keys(facts).sort(), "every exported adapter method is covered");
  const before = snapshot(f.db);
  assertReadParity(f.store, facts, cases);
  assert.deepEqual(snapshot(f.db), before, "SQL reports do not repair pending rows");
  assert.equal(f.store.reconcileLoads({ readOnly: true }).count, 1);
  assert.deepEqual(facts.reconcileLoads(), f.store.reconcileLoads({ readOnly: true }), "fact reconciliation is always read-only");
});

test("all session filter dimensions and request/first/all-load report units preserve exact parity", t => {
  const f = seedParity(t), facts = f.facts();
  const filters = [{}, { from: 0 }, { from: NOW - 2000 }, { to: NOW - 2000 }, { from: NOW - 2000, to: NOW - 1999 },
    { from: NOW, to: NOW }, { runtime: [] }, { runtime: ["codex"] }, { runtime: ["codex", "claude-code"] },
    { skill: [] }, ...["pr-review-ko", "docs-writer", "request-0", "missing"].map(s => ({ skill: [uri(s)] })),
    ...["loaded", "exposed_only", "no_match", "aborted", "not_used"].map(state => ({ state: [state] })),
    ...statuses.flatMap(status => [{ searchStatus: [status] }, { loadStatus: [status] }]),
    { searchStatus: ["failed", "unknown"], loadStatus: ["succeeded", "in_progress"] },
    { searchResult: ["candidates_found"] }, { searchResult: ["no_candidates"] },
    { searchResult: ["candidates_found", "no_candidates"] },
    ...["a", "İ", "i\u0307", "한글", "\n", "TWO", "%", "_", "", "query\nboundary", "promptquery"].map(q => ({ q }))];
  for (const tz of ["UTC", "Asia/Seoul", "America/New_York"]) {
    for (let dow = 0; dow < 7; dow++) filters.push({ tz, dow });
    for (let hour = 0; hour < 24; hour++) {
      for (const hourSpan of [1, 2, 4, 24]) filters.push({ tz, hour, hourSpan });
    }
  }
  for (const base of filters) for (const automated of [undefined, "include", "only"]) {
    const filter = { ...base, ...(automated ? { automated } : {}) };
    assertReadParity(f.store, facts, [["sessions", filter], ["stats", filter], ["skillWeek", filter]]);
    for (const unit of ["first_load", "all_loads", "search_requests", "load_requests"]) {
      assertReadParity(f.store, facts, [["flow", filter, unit, 3]]);
    }
  }
  for (const top of [0, 1, 7, 15, 99]) for (const unit of ["first_load", "all_loads", "search_requests", "load_requests"]) {
    assertReadParity(f.store, facts, [["flow", { runtime: ["codex"], skill: [uri("pr-review-ko")], automated: "include" }, unit, top]]);
  }
  for (const tz of ["UTC", "Asia/Seoul", "America/New_York"]) for (const weekStart of [0, 1]) for (const bucket of [1, 2, 4]) {
    assertReadParity(f.store, facts, [["heatmap", { dow: 6, hour: 23, q: "a" }, tz, weekStart, bucket]]);
  }
  assert.throws(() => facts.sessions({ hour: 0, tz: "Not/AZone" }), { code: "invalid_tz" });
});

const expand = value => typeof value === "string" ? value : value.repeat.repeat(value.count) + value.suffix;
for (const check of fixtureJson("session-substring").cases) {
  test(`P0 exact JS per-string substring: ${check.id}`, t => {
    const f = parityStore(t);
    const fixture = fixtureJson("session-substring");
    for (const s of fixture.sessions) {
      f.db.prepare("INSERT INTO sessions(id,runtime,started_at,first_prompt) VALUES (?,'codex',900,?)").run(s.id, s.firstPrompt);
      for (const [i, e] of (s.events ?? []).entries()) {
        const data = { ...e.data };
        if (data.query !== undefined) data.query = expand(data.query);
        f.store.append({ id: `${s.id}-${i}`, ts: 1000 + i, source: "hook", ref: { runtime: "codex" }, ...e, data,
          ...(e.text !== undefined ? { text: expand(e.text) } : {}) }, { sessionId: s.id, method: "runtime_id" });
      }
    }
    const filter = { q: expand(check.q), automated: "include" };
    assertReadParity(f.store, f.facts(), [["sessions", filter], ["flow", filter, "first_load"]]);
    assert.deepEqual(f.facts().sessions(filter).map(s => s.id).sort(), [...check.expected].sort());
  });
}

test("runtime active requests, exact ingest snapshot, clock and timezone change results with identical rows", t => {
  const f = seedParity(t), rows = snapshot(f.db);
  const active = createFactStore(rows, { runtime: f.runtime() });
  assert.equal(active.sessions({ q: "Alpha" })[0].requests.load.counts.in_progress, 1);
  activeRequests.clear();
  const inactive = createFactStore(rows, { runtime: f.runtime() });
  assertReadParity(f.store, inactive, [["sessions", {}], ["trace", f.human], ["flow", {}, "load_requests"]]);
  assert.equal(inactive.sessions({ q: "Alpha" })[0].requests.load.counts.unknown, 2);
  f.store.countIngest("rejected", "changed");
  f.store.countIngest("accepted");
  const changed = createFactStore(rows, { runtime: f.runtime() });
  assertReadParity(f.store, changed, [["stats"]]);
  assert.deepEqual(snapshot(f.db), rows, "meta counters are separate from content rows");
  assert.notDeepEqual(active.stats().ingest, changed.stats().ingest);
  f.setNow(NOW + 100 * DAY);
  assertReadParity(f.store, createFactStore(rows, { runtime: f.runtime() }), [["stats"], ["skillWeek", {}]]);
  const runtime = { ...f.runtime(), tz: "Asia/Seoul" };
  const seoul = createFactStore(rows, { runtime });
  const override = createFactStore(rows, { runtime, tz: "UTC", now: () => NOW });
  const { dow, hour } = localDowHour(NOW - 2000, "Asia/Seoul");
  assert.deepEqual(seoul.sessions({ dow, hour }), f.store.sessions({ dow, hour, tz: "Asia/Seoul" }));
  assert.deepEqual(override.sessions({ dow, hour }), f.store.sessions({ dow, hour }));
});

test("real report handlers and portable kernel consume identical trees, findings, usage and comparison", t => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const f = seedParity(t), facts = f.facts();
  const sqlReport = reportReader(f.store), factReport = reportReader(facts);
  for (const automated of [undefined, "include", "only"]) {
    const query = { from: String(NOW - 55 * DAY), to: String(NOW + 1), ...(automated ? { automated } : {}) };
    for (const id of [f.flowId, "ws:w", "ws:loose", "outside", "missing"]) {
      assert.deepStrictEqual(factReport("/api/flows/:id", { id }, query), sqlReport("/api/flows/:id", { id }, query), `${id}/${automated}`);
    }
    for (const id of [f.human, "no-activity", "title", "missing"]) {
      assert.deepStrictEqual(factReport("/api/sessions/:id/skill-report", { id }, query),
        sqlReport("/api/sessions/:id/skill-report", { id }, query));
    }
    assert.deepStrictEqual(factReport("/api/skills/usage", {}, query), sqlReport("/api/skills/usage", {}, query));
    assert.deepStrictEqual(factReport("/api/flows", {}, query), sqlReport("/api/flows", {}, query));
  }
  for (const id of f.ids) {
    assert.deepStrictEqual(analysis.sessionTree(facts, id), analysis.sessionTree(f.store, id));
    assert.deepStrictEqual(analysis.sessionFinding(facts, id), analysis.sessionFinding(f.store, id));
  }
  assert.deepStrictEqual(analysis.flowTree(facts, f.flowId), analysis.flowTree(f.store, f.flowId));
  assert.deepStrictEqual(analysis.outsideHerdr(facts, { from: 0, to: NOW + 1, limit: 100 }),
    analysis.outsideHerdr(f.store, { from: 0, to: NOW + 1, limit: 100 }));
  assert.deepStrictEqual(compareFlow(facts, f.flowId), compareFlow(f.store, f.flowId));
});

test("late corrections, reattribution and retained candidates are read without repairing evidence", t => {
  const f = seedParity(t);
  const check = () => {
    const facts = f.facts(), scope = f.store.flowEventScope(f.flowId);
    assertReadParity(f.store, facts, [
      ["flowEventScope", f.flowId], ["treeSessionData", f.human, scope], ["treeFlowData", f.flowId, scope],
      ["flowUnattributedLoads", f.flowId, [f.human]], ["flowPaneUsage", f.flowId],
      ["reconcileLoads", { readOnly: true, eventId: f.proof }], ["reconcileLoads", { readOnly: true }],
      ["trace", f.human], ["sessions", { automated: "include" }],
    ]);
  };
  check();
  f.store.reconcileLoads({ eventId: f.proof });
  assert.equal(f.store.reconcileLoads({ readOnly: true }).count, 0);
  check();
  const contrary = f.add("a-human", "tool_call", NOW - 498, {
    text: JSON.stringify({ server: "gisool", uri: uri("pending") }), data: { success: true },
  });
  f.store.reconcileLoads({ eventId: contrary });
  assert.equal(f.store.reconcileLoads({ readOnly: true }).count, 1);
  check();
  f.db.exec("UPDATE otel_spans SET turn_key='corrected' WHERE start_ms IS NULL OR start_ms=" + (NOW - 400));
  check();
  f.store.reattribute(f.pending, f.human, "vendor_meta");
  check();
  f.store.retention(0);
  check();
});

test("outside membership filtering precedes limits and list cursors preserve zero/null ties", t => {
  const f = seedParity(t);
  for (let i = 0; i < 105; i++) {
    const id = f.session(`extra-auto-${i}`, NOW + i, "Generate a concise, single-line task title x");
    f.add(id, "prompt", NOW + i, { text: "Generate a concise, single-line task title x" });
  }
  const facts = f.facts();
  for (const automated of ["exclude", "include", "only"]) for (const limit of [0, 1, 2, 100, 101, 1001]) {
    assertReadParity(f.store, facts, [
      ["outsideHerdrSessions", { from: 0, to: NOW + DAY, limit, automated }],
      ["outsideHerdrSessionIds", { from: 0, to: NOW + DAY, limit }],
      ["listFlows", { from: 0, to: NOW + DAY, limit, automated }],
    ]);
  }
  for (const row of f.store.listFlows({ from: 0, to: NOW + DAY, limit: 100, automated: "include" })) {
    assertReadParity(f.store, facts, [["listFlows", { from: 0, to: NOW + DAY, limit: 1,
      automated: "include", cursor: { orderMs: row.orderMs, id: row.id } }]]);
  }
});

test("recorded P0 source vectors survive reversed transport order and endpoint arrivals", t => {
  const r = fixtureJson("recording-order"), f = parityStore(t, { now: r.start });
  f.db.prepare("UPDATE recording_clock SET domain=?").run(r.sourceDomain);
  f.db.exec(`INSERT INTO sessions(id,runtime,conversation_id,started_at) VALUES ('s','codex','conversation',900);
    INSERT INTO herdr_panes(id,workspace_id,created_ms) VALUES ('pane','w',0);
    INSERT INTO pane_sessions(pane_id,agent_session_value,session_id,source) VALUES ('pane','conversation','s','reported')`);
  const add = e => f.store.append({ ...e, kind: "llm_call", source: "otel", ref: { runtime: "codex", conversationId: "conversation" },
    data: {}, sourceKey: e.id }, { sessionId: "s", method: "runtime_id" });
  for (const e of r.events.filter(e => e.phase === "prior")) add(e);
  const { row: spec } = f.store.putWorkflowSpec({ name: "p0", steps: [] });
  const { flow } = f.store.createFlow({ workspaceId: "w", specId: spec.id });
  for (const e of r.events.filter(e => e.phase === "inside")) add(e);
  f.store.putSpans([{ traceId: "trace", spanId: "endpoint", name: "tool", runtime: "codex",
    conversationId: "conversation", startMs: r.end, receivedAt: 0 }]);
  f.setNow(r.end);
  f.store.endFlow(flow.id);
  for (const e of r.events.filter(e => e.phase === "late")) add(e);
  const facts = f.facts(), scope = facts.flowEventScope(flow.id);
  assertReadParity(f.store, facts, [["flowEventScope", flow.id], ["treeSessionData", "s", scope]]);
  assert.deepEqual({ eventIds: scope.eventIds, priorEventIds: scope.priorEventIds, boundary: scope.boundary }, r.sourceScope);
  assert.deepEqual(scope.spanKeys, r.spanKeys);
  f.db.exec(`UPDATE events SET recording_orders_json='{}' WHERE id='z-end'`);
  assertReadParity(f.store, f.facts(), [["flowEventScope", flow.id]]);
});

test("late pane membership retains recorded session ends and all three endpoint span joins", t => {
  const f = seedMembershipCut(t), { flow } = f;
  f.db.exec("INSERT INTO pane_sessions(pane_id,agent_session_value,session_id,source) VALUES ('p','own','s','reported')");
  const scope = f.store.flowEventScope(flow.id);
  assert.equal(scope.sessionEnds.s, 1100);
  assert.equal(scope.spanKeys.length, 4);
  assertReadParity(f.store, f.facts(), [["flowEventScope", flow.id], ["treeSessionData", "s", scope],
    ["treeFlowData", flow.id], ["listFlows", { from: 0, limit: 10 }]]);
  f.db.exec("UPDATE sessions SET ended_at=1101 WHERE id='s'; UPDATE otel_spans SET turn_key='late-correction'");
  assertReadParity(f.store, f.facts(), [["flowEventScope", flow.id],
    ["treeSessionData", "s", f.store.flowEventScope(flow.id)]]);
  f.db.exec(`UPDATE flows SET start_order=NULL,end_order=NULL,start_order_domain=NULL,end_order_domain=NULL,
    start_event_ids_json='["start"]',end_event_ids_json='["end"]',
    end_sessions_json='{"s":1100}',end_spans_json='[["exact","exact"]]'`);
  assertReadParity(f.store, f.facts(), [["flowEventScope", flow.id],
    ["treeSessionData", "s", f.store.flowEventScope(flow.id)]]);
});
