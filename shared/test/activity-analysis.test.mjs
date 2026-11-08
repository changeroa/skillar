import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeSession, assembleSession, compare, flowTree, rangeUsage, scopeSession, sessionUsage,
} from "../dist/activity-analysis.js";

const event = (id, ts, kind, extra = {}) => ({
  id, ts, kind, source: "mcp", turnKey: null, callId: null, spanId: null, skillUri: null, text: null, textLength: null,
  data: {}, ...extra,
});
const candidates = [
  { uri: "skill://a/x/SKILL.md", name: "x", rank: 1, digest: "d1" },
  { uri: "skill://b/x/SKILL.md", name: "x", rank: 2, digest: "d1" },
  { uri: "skill://a/y/SKILL.md", name: "y", rank: 3, digest: "d2" },
];
const data = {
  id: "s1", runtime: "claude-code", startedAt: 0, endedAt: null, spans: [],
  events: [
    event("early", 500, "tool_call", { data: { toolName: "Read" } }),
    event("p1", 1000, "prompt", { source: "hook", text: "do it" }),
    event("q1", 1100, "search", { data: { query: "q", candidates } }),
    event("l1", 1200, "load", { skillUri: "skill://a/y/SKILL.md", data: { name: "y", loadId: "L1" } }),
    event("t1", 1300, "tool_call", { data: { toolName: "Bash", success: false } }),
    event("m1", 1400, "llm_call", { data: { inputTokens: 10, inputIncludesCache: false } }),
    event("p2", 2000, "prompt", { source: "hook", text: "no, wrong" }),
  ],
};

test("assembly keeps inferred turns, row order and events before any boundary unassigned", () => {
  const tree = assembleSession(data);
  assert.deepEqual(tree.turns.map((t) => [t.id, t.startedAt, t.endedAt, t.basis]),
    [["prompt:p1", 1000, 2000, "inferred_time"], ["prompt:p2", 2000, 2000, "inferred_time"]]);
  assert.deepEqual(tree.turns[0].events.map((e) => [e.id, e.attribution]),
    [["p1", "no_skill"], ["q1", "no_skill"], ["l1", "no_skill"], ["t1", "single"], ["m1", "single"]]);
  assert.deepEqual(tree.unassignedEvents.map((e) => e.id), ["early"]);
  assert.deepEqual(tree.turns[0].skillSpans.map((s) => [s.skill, s.events.map((e) => e.id)]), [["skill://a/y/SKILL.md", ["t1", "m1"]]]);
});

test("finding collapses identical digests into one rank and keeps the raw rank", () => {
  const finding = analyzeSession(assembleSession(data));
  const [turn] = finding.turns;
  assert.equal(turn.label, "found_lower");
  assert.deepEqual(turn.loadedSkills.map((s) => s.rankInSearch), [2]);
  assert.deepEqual(turn.candidates.map((c) => [c.uri, c.rank, c.rawRank, c.copies]),
    [["skill://a/x/SKILL.md", 1, 1, 2], ["skill://b/x/SKILL.md", 1, 2, 2], ["skill://a/y/SKILL.md", 2, 3, 1]]);
  assert.equal(finding.aggregate.meanRank, 2);
  assert.equal(finding.aggregate.labels.no_search, 1);
});

test("usage keeps unreported cost and tokens null instead of zero", () => {
  const [span] = sessionUsage(assembleSession(data)).spans;
  assert.equal(span.durationMs, 800);
  assert.equal(span.followThrough, 1);
  assert.equal(span.toolFailures, 1);
  assert.deepEqual(span.activity, { version: 1, observations: 1, commands: 1, unresolvedExec: 0,
    results: { success: 0, failure: 1, unknown: 0 }, workExecutions: 1 });
  assert.equal(span.costUsd, null);
  assert.equal(span.costUnknownCalls, 1);
  assert.equal(span.tokens[0].inputTokens, 10);
  assert.equal(span.tokens[0].outputTokens, null);
  assert.equal(span.tokens[0].unknownCalls.outputTokens, 1);
  assert.deepEqual(span.nextPromptCorrection, { status: "correction", label: "heuristic", matched: ["no,", "wrong"], reason: null });
});

test("scopeSession keeps only owned events and records the execution window", () => {
  const scope = { from: 1150, to: null, eventIds: ["l1", "t1"], paneIds: [], links: [], priorEventIds: [], sessionEnds: null,
    spanKeys: null, boundary: "recorded" };
  const scoped = scopeSession(assembleSession(data), scope);
  assert.deepEqual(scoped.executionWindow, { from: 1150, to: null });
  assert.equal(scoped.endedAt, null);
  assert.deepEqual(scoped.turns.map((t) => [t.id, t.startedAt, t.events.map((e) => e.id)]), [["prompt:p1", 1150, ["l1", "t1"]]]);
  assert.deepEqual(scoped.unassignedEvents, []);
});

test("store-backed reads go through the AnalysisStore contract", () => {
  const store = {
    treeSessionData: (id) => (id === "s1" ? data : undefined),
    treeFlowData: () => ({ id: "f1", workspaceId: "w1", label: null, registered: true,
      tabs: [{ id: "tab", label: null, createdMs: null, closedMs: null }],
      panes: [{ id: "pane", tabId: "tab", label: null, createdMs: null, closedMs: null }],
      links: [{ paneId: "pane", sessionId: "s1", agentSessionValue: "a", source: "inferred:cwd_time", firstSeenMs: null, lastSeenMs: null },
        { paneId: "pane", sessionId: null, agentSessionValue: "b", source: null, firstSeenMs: 5, lastSeenMs: null }] }),
    flowEventScope: () => undefined,
    sessions: () => [{ id: "s1" }, { id: "missing" }],
  };
  const flow = flowTree(store, "f1");
  assert.deepEqual(flow.tabs[0].panes[0].sessions.map((s) => [s.basis, s.session?.id ?? null]), [["inferred", "s1"], ["reported", null]]);
  const range = rangeUsage(store, { from: 0, to: 3000, detailLimit: 0 });
  assert.deepEqual([range.sessionCount, range.truncated, range.sessions.length, range.skills.map((s) => s.skill)],
    [1, true, 0, ["skill://a/y/SKILL.md"]]);
});

test("compare reports step status, deviations and unplanned panes", () => {
  const result = compare({
    spec: { steps: [
      { id: "a", skills: ["x"], together: false, expectTools: [] },
      { id: "b", skills: ["y", "x"], together: true, expectTools: ["Read"] },
      { id: "c", skills: ["z"], together: false, expectTools: [] },
    ] },
    steps: [{ stepId: "a", paneId: "p1" }, { stepId: "b", paneId: "p2" }],
    paneSkillUse: { p1: ["x"], p2: ["x"], p3: ["q"] },
    paneTools: { p2: ["Read", "Bash"] },
  });
  assert.deepEqual(result.steps.map((s) => [s.stepId, s.status, s.missingSkills, s.unexpectedTools]),
    [["a", "matched", [], []], ["b", "partial", ["y"], ["Bash"]], ["c", "not_run", ["z"], []]]);
  assert.deepEqual(result.unplanned, [{ paneId: "p3", usedSkills: ["q"] }]);
});
