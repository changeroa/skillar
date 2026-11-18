import assert from "node:assert/strict";
import test from "node:test";
import { act, all, loadViews, mount } from "../../site/test/helpers/t10-dom.mjs";

const ui = await loadViews(`
  export { parseHash, buildHash, serializeFilter } from "./local/dashboard/state.ts";
  export { destination } from "./local/dashboard/components/command-jump.tsx";
  export { histogramBars, SessionHistogram } from "./local/dashboard/views/sessions/histogram.tsx";
  export { readSkills, candidateSkills, sortSessions } from "./local/dashboard/views/sessions/model.ts";
  export { SessionTable } from "./local/dashboard/views/sessions/table.tsx";
  export { createTimelineKeys } from "./local/dashboard/views/trace/plan.ts";
  export { EventConsole } from "./local/dashboard/views/trace/event-console.tsx";
  export { summaryFacts } from "./local/dashboard/views/trace/summary.tsx";
  export { RankedCandidates } from "./local/dashboard/components/ranked-candidates.tsx";
  export { JsonViewer } from "./local/dashboard/components/json-viewer.tsx";
`);

test("local view preferences round-trip without leaking into API filters", () => {
  const route = {
    view: "sessions", filter: { runtime: ["codex"], q: "request & skill", from: 100, automated: "include" },
    sort: "-reads", density: "compact", workspace: "ws:team space",
    peek: "session/with space", event: "source:event/1", format: "raw", attributes: true,
  };
  assert.deepEqual(ui.parseHash(ui.buildHash(route)), route);
  assert.equal(ui.serializeFilter(route.filter), "from=100&runtime=codex&q=request%20%26%20skill&automated=include");
  assert.ok(!ui.serializeFilter(route.filter).includes("peek"));
});

test("every daily histogram bar shares the baseline, including labelled zero ticks", () => {
  const day = 86400000;
  const start = Date.parse("2026-01-01T00:00:00+09:00");
  const rows = Array.from({ length: 31 }, (_, index) => Array.from({ length: (index * 7) % 13 }, () => ({ startedAt: start + index * day + 1000 }))).flat();
  const bars = ui.histogramBars(rows, start, start + 31 * day);
  assert.equal(bars.length, 31);
  assert.equal(bars.reduce((total, bar) => total + bar.count, 0), rows.length);
  for (const bar of bars) {
    assert.equal(bar.y + bar.height, bars[0].baseline);
    assert.equal(bar.width, bars[0].width);
    if (bar.count === 0) assert.equal(bar.height, 1);
  }
  const empty = ui.histogramBars([], start, start + 3 * day);
  assert.deepEqual(empty.map(bar => bar.count), [0, 0, 0]);
  for (const bar of empty) { assert.equal(bar.height, 1); assert.equal(bar.y + bar.height, bar.baseline); }
});

const loaded = { id: "loaded", runtime: "codex", state: "loaded", startedAt: 10, endedAt: 110, skills: ["skill://a", "skill://b"], firstPrompt: "captured" };
const exposed = { id: "exposed", runtime: "codex", state: "exposed_only", startedAt: 20, skills: ["skill://candidate"], firstPrompt: "captured" };

test("candidate exposure never contributes to actual-read counts or read sorting", () => {
  assert.deepEqual(ui.readSkills(exposed), []);
  assert.deepEqual(ui.candidateSkills(loaded), []);
  assert.deepEqual(ui.candidateSkills(exposed), exposed.skills);
  assert.deepEqual(ui.sortSessions([exposed, loaded], "-reads").map(row => row.id), ["loaded", "exposed"]);
  assert.deepEqual(ui.sortSessions([loaded, exposed], "started").map(row => row.id), ["loaded", "exposed"]);
});

test("the actual table renders candidate-only sessions with zero reads and candidate names in the search cell", async t => {
  const { container } = await mount(t, ui.SessionTable, { rows: [loaded, exposed], route: { view: "sessions", filter: {}, sort: "-reads" }, navigate() {} });
  const cells = all(container, node => node.localName === "td" && node.getAttribute("class") === "cell-reads");
  assert.equal(cells[1].textContent, "0");
  assert.ok(!cells[1].textContent.includes("candidate"));
  // 2차 declutter: "후보" 열은 사라지고 대표 후보 스킬 이름은 검색 열에 합쳐진다.
  const searches = all(container, node => node.localName === "td" && node.getAttribute("class") === "cell-search");
  assert.ok(searches[1].textContent.includes("candidate"));
  assert.ok(!searches[0].textContent.includes("candidate"));
  assert.equal(all(container, node => node.localName === "td" && node.getAttribute("class") === "cell-candidates").length, 0);
  assert.equal(all(container, node => node.getAttribute("aria-sort") === "descending").length, 1);
  assert.equal(all(container, node => node.getAttribute("href")?.includes("peek=")).length, 2);
});

test("the fixed session columns always render a keyboard-accessible session link", async t => {
  // 2차 declutter: 열 선택 UI가 사라져 첫 요청 열(세션 링크)은 항상 렌더된다.
  const { container } = await mount(t, ui.SessionTable, {
    rows: [loaded, exposed], route: { view: "sessions", filter: {} }, navigate() {},
  });
  assert.equal(all(container, node => node.localName === "a" && node.getAttribute("href")?.includes("peek=")).length, 2);
  const heads = all(container, node => node.localName === "th").map(node => node.textContent.trim());
  assert.deepEqual(heads, ["시작", "실행 환경", "읽은 스킬", "첫 요청", "검색"]);
});


test("event selection retains filters on the single tree view", async t => {
  // 2차 declutter: 트리/타임라인 전환이 사라지고 트리만 남는다.
  const source = ui.createTimelineKeys("event-session")([
    { kind: "prompt", ts: 100, summary: "captured", detail: { kind: "prompt", text: "captured" } },
    { kind: "search", ts: 200, summary: "query", detail: { kind: "search", query: "q", candidates: [] } },
  ]);
  const route = { view: "trace", sessionId: "event-session", filter: { q: "scope" }, event: source[0].key };
  let next;
  const { container } = await mount(t, ui.EventConsole, { source, bounds: { startedAt: 100 }, route, navigate(value) { next = value; } });
  assert.equal(all(container, node => node.getAttribute("role") === "tablist").length, 0);
  const rows = all(container, node => node.getAttribute("role") === "treeitem");
  assert.equal(rows.length, 2);
  await act(() => rows[1].click());
  assert.deepEqual(next, { ...route, event: source[1].key });
});

test("event navigation keeps one tab stop on the tree", async t => {
  const source = ui.createTimelineKeys("roving")([100, 200].map(ts => ({
    kind: "prompt", ts, summary: String(ts), detail: { kind: "prompt", text: String(ts) },
  })));
  const route = { view: "trace", filter: {}, event: source[0].key };
  const props = { source, bounds: { startedAt: 100, endedAt: 200 }, route, prefix: "roving", navigate() {} };
  const { container } = await mount(t, ui.EventConsole, props);
  const rows = all(container, node => node.getAttribute("role") === "treeitem");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(node => node.getAttribute("tabindex")), ["0", "-1"]);
  assert.equal(all(container, node => node.getAttribute("role") === "grid").length, 0);
});

test("event rows carry request status and the skill path tooltip the removed request table had", async t => {
  // 2차 declutter: 아래 "검색 및 읽기 요청" 표를 지운 대신 행에 상태와 스킬 경로 툴팁을 둔다.
  const source = ui.createTimelineKeys("row-status")([
    { kind: "load", ts: 100, summary: "read", detail: { kind: "load", uri: "skill://agents/deploy-checklist/SKILL.md", currentStatus: "succeeded" } },
    { kind: "search", ts: 200, summary: "query", detail: { kind: "search", query: "q", candidates: [], currentStatus: "failed" } },
  ]);
  const { container } = await mount(t, ui.EventConsole, { source, bounds: { startedAt: 100 }, route: { view: "trace", filter: {} }, navigate() {} });
  const badges = all(container, node => (node.getAttribute("class") ?? "").includes("badge--"));
  assert.deepEqual(badges.map(node => node.textContent.trim()), ["성공", "실패"]);
  const tips = all(container, node => node.getAttribute("title") === "skill://agents/deploy-checklist/SKILL.md");
  assert.equal(tips.length, 1);
  assert.equal(tips[0].textContent, "deploy-checklist");
});

test("raw JSON has native nested disclosures and preserves every captured primitive", async t => {
  const value = { ts: 100, kind: "search", detail: { candidates: [{ uri: "skill://a", score: .75 }], chosen: ["skill://a"], measured: false, missing: null } };
  const { container } = await mount(t, ui.JsonViewer, { value });
  const branches = all(container, node => node.localName === "details");
  assert.equal(branches.length, 5);
  assert.ok(branches[0].hasAttribute("open") && branches[1].hasAttribute("open"));
  assert.ok(!branches[2].hasAttribute("open") && !branches[3].hasAttribute("open"));
  assert.deepEqual(all(container, node => node.getAttribute("class") === "json-value").map(node => JSON.parse(node.textContent)),
    [100, "search", "skill://a", .75, "skill://a", false, null]);
  assert.equal(all(container, node => node.hasAttribute("data-event-raw")).length, 1);
});

test("session summary counts missing search latency separately from measured zero", () => {
  const search = { kind: "search", ts: 100, summary: "captured", detail: { kind: "search", candidates: [] } };
  assert.equal(ui.summaryFacts([search]).unmeasuredSearches, 1);
  assert.equal(ui.summaryFacts([{ ...search, detail: { ...search.detail, elapsedMs: 0 } }]).unmeasuredSearches, 0);
  assert.equal(ui.summaryFacts([{ kind: "prompt", ts: 100, detail: { kind: "prompt", text: "captured" } }]).unmeasuredSearches, 0);
});

test("JSON primitive paint selectors distinguish null from container objects", async t => {
  // Given
  const value = { count: 42, enabled: false, missing: null, text: "recorded" };
  // When
  const { container } = await mount(t, ui.JsonViewer, { value });
  // Then
  assert.deepEqual(all(container, node => node.getAttribute("class") === "json-value")
    .map(node => node.getAttribute("data-json-type")), ["number", "boolean", "null", "string"]);
});

test("unrecognised view preference values do not become active controls", () => {
  assert.deepEqual(ui.parseHash("#/sessions?sort=bad&density=bad&tab=graph&format=bad&runtime=codex"), {
    view: "sessions", filter: { runtime: ["codex"] },
  });
});

test("navigation-only command destinations retain the list scope and clear entity selection", () => {
  const route = {
    view: "trace", sessionId: "session", filter: { q: "migration", loadStatus: ["succeeded"] },
    sort: "started", density: "comfortable", peek: "session", event: "load-id",
  };
  const next = ui.destination(route, "dashboard");
  const parsed = ui.parseHash(ui.buildHash(next));
  assert.equal(parsed.view, "dashboard");
  assert.deepEqual(parsed.filter, route.filter);
  assert.equal(parsed.sort, route.sort);
  assert.equal(parsed.density, route.density);
  assert.equal(parsed.event, undefined);
  assert.equal(parsed.peek, undefined);
  assert.equal(parsed.sessionId, undefined);
});
