import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { PACKAGE_ROOT } from "./_helpers.mjs";

async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, PACKAGE_ROOT))],
    bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", jsxImportSource: "preact", logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const [bars, data, state, workspace, flow, clock, histogram] = await Promise.all([
  load("dashboard/charts/bars.tsx"), load("dashboard/views/analysis-data.ts"), load("dashboard/state.ts"), load("dashboard/views/workspace/list.tsx"), load("dashboard/views/flow.tsx"), load("dashboard/time.ts"), load("dashboard/views/sessions/histogram.tsx"),
]);

test("flow unit picker offers request units without the retired first-load unit", () => {
  assert.deepEqual(flow.FLOW_UNITS, ["search_requests", "load_requests"]);
  assert.ok(!flow.FLOW_UNITS.includes("first_load"));
});

test("grouped bars share baseline, width and scale, including zero ticks", () => {
  const result = bars.barGeometry([{ label: "a", values: [0, 2] }, { label: "b", values: [1, 2] }]);
  assert.equal(new Set(result.bars.map(bar => bar.width)).size, 1);
  for (const bar of result.bars) assert.equal(bar.y + bar.height, result.baseline);
  assert.equal(result.bars[0].height, 1);
  assert.equal(result.bars[1].height, result.bars[3].height);
  assert.equal(result.bars[2].height * 2, result.bars[1].height);
});

test("analysis URLs round trip sort, facets, selection and request unit", () => {
  const route = { view: "workspaces", filter: { from: 100, automated: "include" }, peek: "space/1",
    analysisSort: "-sessions", analysisQuery: "release", facet: "flow", flowUnit: "load_requests", flowMode: "table" };
  assert.deepEqual(state.parseHash(state.buildHash(route)), route);
});

test("normalized requests count start plus terminal once and exclude supporting reads", () => {
  const steps = [
    { kind: "skill_request", ts: 10, detail: { requestId: "r", operation: "load", status: "in_progress" } },
    { kind: "skill_request", ts: 20, detail: { requestId: "r", operation: "load", status: "succeeded", uri: "skill://a/SKILL.md" } },
    { kind: "load", ts: 20, detail: { requestId: "r", uri: "skill://a/SKILL.md" } },
    { kind: "read_file", ts: 22, detail: { uri: "skill://a/references/a.md" } },
  ];
  const requests = data.traceRequests(steps);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, "succeeded");
  assert.equal(requests[0].startedAt, 10);
});

test("daily series counts requests rather than outcomes and preserves missing days", () => {
  const records = [{ operation: "search", status: "failed", startedAt: 0 }, { operation: "load", status: "succeeded", endedAt: 172800000 }];
  assert.deepEqual(data.requestSeries(records, {}).map(group => group.values), [[1, 0], [0, 0], [0, 1]]);
});

test("daily request and session buckets switch at KST midnight, not UTC midnight", () => {
  const before = Date.UTC(2026, 9, 4, 14, 59, 59, 999), midnight = before + 1;
  const requests = [{ operation: "load", status: "succeeded", endedAt: before }, { operation: "load", status: "succeeded", endedAt: midnight }];
  assert.deepEqual(data.requestSeries(requests, {}).map(group => group.label), ["10-04", "10-05"]);
  assert.deepEqual(histogram.histogramBars(requests.map(record => ({ startedAt: record.endedAt }))).map(bar => ({ date: bar.date, count: bar.count })),
    [{ date: "2026-10-04", count: 1 }, { date: "2026-10-05", count: 1 }]);
  assert.equal(data.requestsInRange(requests, { to: midnight }).length, 1);
  assert.equal(clock.kstPeriodStart(midnight + 3600000, 1), midnight);
  assert.equal(clock.kstPeriodStart(midnight + 3600000, 7), midnight - 6 * 86400000);
});

test("KST ISO weeks switch on Monday and preserve the ISO year boundary", () => {
  assert.equal(clock.kstIsoWeek(Date.UTC(2026, 9, 4, 14, 59)), "2026-W40");
  assert.equal(clock.kstIsoWeek(Date.UTC(2026, 9, 4, 15)), "2026-W41");
  assert.equal(clock.kstIsoWeek(Date.UTC(2027, 0, 3, 14, 59)), "2026-W53");
  assert.equal(clock.kstIsoWeek(Date.UTC(2027, 0, 3, 15)), "2027-W01");
});

test("duration distribution excludes unended sessions rather than adding zero", () => {
  const distribution = data.durationDistribution([{ startedAt: 0 }, { startedAt: 0, endedAt: 1200000 }]);
  assert.deepEqual(distribution.values, [1200000]);
  assert.deepEqual(distribution.groups.map(group => group.values[0]), [0, 0, 1, 0, 0, 0]);
});

test("weekly reads count only actual successful reads, honor skill selection and use ISO weeks", () => {
  const records = [
    { operation: "load", status: "succeeded", uri: "skill://a/SKILL.md", endedAt: Date.UTC(2026, 9, 6) },
    { operation: "load", status: "succeeded", uri: "skill://a/SKILL.md", endedAt: Date.UTC(2026, 9, 13) },
    { operation: "load", status: "succeeded", uri: "skill://b/SKILL.md", endedAt: Date.UTC(2026, 9, 13) },
    { operation: "search", status: "succeeded", uri: "skill://a/SKILL.md", endedAt: Date.UTC(2026, 9, 6) },
    { operation: "load", status: "failed", uri: "skill://a/SKILL.md", endedAt: Date.UTC(2026, 9, 6) },
  ];
  const result = data.requestsSkillWeek(records, ["skill://a/SKILL.md"]);
  assert.deepEqual(result.weeks, ["2026-W41", "2026-W42"]);
  assert.deepEqual(result.rows.map(row => ({ uri: row.uri, counts: row.counts })), [{ uri: "skill://a/SKILL.md", counts: [1, 1] }]);
  assert.deepEqual(data.requestsSkillWeek(data.requestsInRange(records, { from: Date.UTC(2026, 9, 12) }), ["skill://a/SKILL.md"]).rows[0].counts, [1]);
});

test("fixture heatmap derives only the supplied sessions in the named timezone", () => {
  const result = data.sessionsHeatmap([{ startedAt: Date.UTC(2026, 10, 1, 23) }], "Asia/Seoul", 1);
  assert.equal(result.cells.find(cell => cell.dow === 1 && cell.hour === 8).count, 1);
  assert.equal(result.rowTotals.reduce((sum, n) => sum + n, 0), 1);
  assert.equal(result.colTotals.reduce((sum, n) => sum + n, 0), 1);
});

test("workspace sorting keeps unknown times last in either direction", () => {
  const row = (id, startedMs) => ({ id, startedMs });
  assert.deepEqual(workspace.sortWorkspaces([row("unknown", null), row("early", 1), row("late", 2)], "-started").map(row => row.id), ["late", "early", "unknown"]);
  assert.deepEqual(workspace.sortWorkspaces([row("unknown", null), row("late", 2), row("early", 1)], "started").map(row => row.id), ["early", "late", "unknown"]);
});
