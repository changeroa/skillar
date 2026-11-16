import assert from "node:assert/strict";
import test from "node:test";
import { requestRecords } from "../../local/src/request-status.ts";
import {
  aggregateVersionMetrics, countLoads, loadRecordsFromSteps, privateVersionUri, sampleNote,
} from "../src/skills/version-metrics-core.ts";

const SKILL = "skl_test01";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const URI_A = `skill://private/${SKILL}/${DIGEST_A}/SKILL.md`;

test("privateVersionUri names the exact skill version resource", () => {
  assert.equal(privateVersionUri(SKILL, DIGEST_A), URI_A);
});

/** Parity: load-only restatement must agree with the 11/02 requestRecords on load records. */
const parity = (name, steps) => test(`loadRecordsFromSteps parity: ${name}`, () => {
  const events = steps.map((step, index) => ({ id: `e${index}`, ts: step.ts, kind: step.kind, data: step.detail }));
  const theirs = requestRecords(events)
    .filter(record => record.operation === "load")
    .map(record => ({ status: record.status, uri: record.uri ?? null, errorCode: record.errorCode ?? null }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const mine = loadRecordsFromSteps(steps)
    .map(record => ({ status: record.status, uri: record.uri ?? null, errorCode: record.errorCode ?? null }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(mine, theirs);
});

parity("tracked load start then terminal outcome", [
  { ts: 1, kind: "skill_request", detail: { requestId: "q1", operation: "load", status: "in_progress", uri: URI_A } },
  { ts: 2, kind: "skill_request", detail: { requestId: "q1", operation: "load", status: "succeeded", uri: URI_A } },
]);

parity("late start never overwrites a terminal outcome", [
  { ts: 2, kind: "skill_request", detail: { requestId: "q1", operation: "load", status: "failed", uri: URI_A, errorCode: "boom" } },
  { ts: 1, kind: "skill_request", detail: { requestId: "q1", operation: "load", status: "in_progress", uri: URI_A } },
]);

parity("historical in_progress reads as unknown, never failed", [
  { ts: 1, kind: "skill_request", detail: { requestId: "q1", operation: "load", status: "in_progress", uri: URI_A } },
]);

parity("cancelled and invalid statuses", [
  { ts: 1, kind: "skill_request", detail: { requestId: "q1", operation: "load", status: "cancelled", uri: URI_A } },
  { ts: 2, kind: "skill_request", detail: { requestId: "q2", operation: "load", status: "not_attempted", uri: URI_A } },
  { ts: 3, kind: "skill_request", detail: { requestId: "q3", operation: "search", status: "succeeded" } },
]);

parity("untracked completed load observation reads as succeeded", [
  { ts: 5, kind: "load", detail: { uri: URI_A, loadId: "l1", manifestDigest: DIGEST_A } },
]);

parity("load step tracked by a skill_request is not double counted", [
  { ts: 1, kind: "skill_request", detail: { requestId: "q1", operation: "load", status: "failed", uri: URI_A } },
  { ts: 2, kind: "load", detail: { uri: URI_A, requestId: "q1" } },
]);

parity("error steps classify by tool, never by missing logs", [
  { ts: 1, kind: "error", detail: { tool: "load_skill", uri: URI_A, code: "not_found" } },
  { ts: 2, kind: "error", detail: { tool: "resources/read", uri: URI_A, code: "denied" } },
  { ts: 3, kind: "error", detail: { tool: "resources/read", resourceKind: "supporting_file", uri: `skill://private/${SKILL}/${DIGEST_A}/ref.md` } },
  { ts: 4, kind: "error", detail: { tool: "resources/read", uri: `skill://private/${SKILL}/${DIGEST_A}/ref.md` } },
  { ts: 5, kind: "error", detail: { tool: "search_skills", code: "boom" } },
  { ts: 6, kind: "error", detail: { message: "unrelated" } },
]);

test("countLoads buckets only load records of the exact version", () => {
  const records = [
    { id: "1", status: "succeeded", uri: URI_A },
    { id: "2", status: "failed", uri: `skill://private/${SKILL}/${DIGEST_A}/reference.md` },
    { id: "3", status: "unknown", uri: URI_A },
    { id: "4", status: "succeeded", uri: `skill://private/${SKILL}/${DIGEST_B}/SKILL.md` },
    { id: "5", status: "succeeded", uri: `skill://private/other_skill/${DIGEST_A}/SKILL.md` },
    { id: "6", status: "succeeded", uri: "file:///home/user/.claude/skills/x/SKILL.md" },
    { id: "7", status: "succeeded" },
  ];
  const { total, counts } = countLoads(records, SKILL, DIGEST_A);
  assert.equal(total, 3);
  assert.deepEqual(counts, { succeeded: 1, failed: 1, cancelled: 0, in_progress: 0, unknown: 1 });
});

const candidate = (key, startedAt) => ({ key, sessionId: key, runtime: "codex", startedAt, firstPrompt: null });
const okTrace = (steps) => ({ kind: "ok", steps });
const loadStep = (uri, ts = 1) => ({ ts, kind: "load", detail: { uri } });

test("aggregateVersionMetrics sums counts across sampled sessions", () => {
  const candidates = [candidate("s1", 1000), candidate("s2", 2000)];
  const traces = new Map([
    ["s1", okTrace([loadStep(URI_A)])],
    ["s2", okTrace([
      { ts: 1, kind: "skill_request", detail: { requestId: "q1", operation: "load", status: "failed", uri: URI_A } },
      { ts: 2, kind: "skill_request", detail: { requestId: "q2", operation: "load", status: "failed", uri: URI_A } },
    ])],
  ]);
  const metrics = aggregateVersionMetrics(DIGEST_A, 1, candidates, SKILL, traces);
  assert.equal(metrics.sessionsTotal, 2);
  assert.equal(metrics.sessionsSampled, 2);
  assert.equal(metrics.truncated, false);
  assert.equal(metrics.loadTotal, 3);
  assert.equal(metrics.counts.succeeded, 1);
  assert.equal(metrics.counts.failed, 2);
  assert.deepEqual(metrics.sessions.map(s => s.sessionId), ["s2", "s1"]);
});

test("aggregateVersionMetrics reports truncation instead of hiding it", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => candidate(`s${index}`, 1000 + index));
  const traces = new Map(candidates.map(c => [c.key, okTrace([loadStep(URI_A)])]));
  const metrics = aggregateVersionMetrics(DIGEST_A, 1, candidates, SKILL, traces, 20);
  assert.equal(metrics.sessionsTotal, 25);
  assert.equal(metrics.sessionsSampled, 20);
  assert.equal(metrics.truncated, true);
  assert.equal(metrics.loadTotal, 20);
});

test("failed traces are excluded and never counted as zero loads", () => {
  const candidates = [candidate("s1", 1000), candidate("s2", 2000), candidate("s3", 3000)];
  const traces = new Map([
    ["s1", okTrace([loadStep(URI_A)])],
    ["s2", { kind: "failed" }],
    // s3 has no trace entry at all: also excluded.
  ]);
  const metrics = aggregateVersionMetrics(DIGEST_A, 2, candidates, SKILL, traces);
  assert.equal(metrics.sessionsExcluded, 2);
  assert.equal(metrics.loadTotal, 1);
  assert.equal(metrics.counts.succeeded, 1);
  const failed = metrics.sessions.find(s => s.sessionId === "s2");
  assert.equal(failed.loadCount, null);
  const missing = metrics.sessions.find(s => s.sessionId === "s3");
  assert.equal(missing.loadCount, null);
});

test("sampleNote states sample scope, exclusions and URI coverage", () => {
  const full = sampleNote({ sources: 2, fromLabel: "2026-11-01", toLabel: "2026-11-16", sessionsTotal: 8, sessionsSampled: 8, sessionsExcluded: 0 });
  assert.match(full, /출처 2개/);
  assert.match(full, /세션 8개 전부 집계/);
  assert.match(full, /읽기 URI가 기록된 세션만 포함/);
  const truncated = sampleNote({ sources: 1, fromLabel: "2026-11-10", toLabel: "2026-11-16", sessionsTotal: 30, sessionsSampled: 20, sessionsExcluded: 3 });
  assert.match(truncated, /세션 30개 중 최근 20개만 집계/);
  assert.match(truncated, /조회 실패로 제외 3개/);
});
