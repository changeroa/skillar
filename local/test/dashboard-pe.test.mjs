import assert from "node:assert/strict";
import test from "node:test";
import { act, all, loadViews, mount } from "../../site/test/helpers/t10-dom.mjs";

const ui = await loadViews(`
  export { parseHash, buildHash, serializeFilter } from "./local/dashboard/state.ts";
  export { destination } from "./local/dashboard/components/command-jump.tsx";
  export { histogramBars } from "./local/dashboard/views/sessions/histogram.tsx";
  export { readSkills, candidateSkills, sortSessions } from "./local/dashboard/views/sessions/model.ts";
  export { SessionTable } from "./local/dashboard/views/sessions/table.tsx";
  export { createTimelineKeys } from "./local/dashboard/views/trace/plan.ts";
  export { ganttGeometry } from "./local/dashboard/views/trace/geometry.ts";
  export { EventConsole } from "./local/dashboard/views/trace/event-console.tsx";
  export { summaryFacts } from "./local/dashboard/views/trace/summary.tsx";
  export { RankedCandidates } from "./local/dashboard/components/ranked-candidates.tsx";
`);

test("local view preferences round-trip without leaking into API filters", () => {
  const route = {
    view: "sessions", filter: { runtime: ["codex"], q: "request & skill", from: 100, automated: "include" },
    sort: "-reads", columns: ["started", "runtime", "reads", "id"], density: "compact",
    peek: "session/with space", event: "source:event/1", traceTab: "timeline", format: "raw", attributes: true,
  };
  assert.deepEqual(ui.parseHash(ui.buildHash(route)), route);
  assert.equal(ui.serializeFilter(route.filter), "from=100&runtime=codex&q=request%20%26%20skill&automated=include");
  assert.ok(!ui.serializeFilter(route.filter).includes("peek"));
});

test("Gantt geometry uses actual offsets and only explicitly bounded intervals", () => {
  const items = [
    { kind: "step", key: "first", step: { kind: "prompt", ts: 100, detail: {} } },
    { kind: "step", key: "tool", step: { kind: "tool_call", ts: 125, detail: { durationMs: 9000 } } },
    { kind: "span", key: "span:activation", span: { startedAt: 150, endedAt: 200 } },
  ];
  const graph = ui.ganttGeometry(items, 100, 200);
  assert.deepEqual(graph.points.map(point => [point.x, point.width, point.offsetMs, point.bounded]), [
    [0, 0, 0, false], [25, 0, 25, false], [50, 50, 50, true],
  ]);
  assert.equal(ui.ganttGeometry([], 100, 200), undefined);
  const outside = ui.ganttGeometry([...items, { kind: "span", key: "outside", span: { startedAt: 1000, endedAt: 2000 } }], 100, 200);
  assert.equal(outside.end, 200);
  assert.equal(outside.points.at(-1).outside, true);
  assert.deepEqual(outside.points.slice(0, 3), graph.points);
});

test("source event selection IDs reproduce across reloads and remain session scoped", () => {
  const source = [
    { kind: "prompt", ts: 100, summary: "a", detail: { kind: "prompt", text: "a" } },
    { kind: "tool_call", ts: 200, summary: "A", detail: { kind: "tool_call", args: "first" } },
    { kind: "tool_call", ts: 200, summary: "B", detail: { kind: "tool_call", args: "second" } },
    { kind: "search", ts: 300, summary: "q", detail: { kind: "search", traceId: "immutable-search", chosen: [] } },
  ];
  const first = ui.createTimelineKeys("session-a")(source);
  const reloaded = ui.createTimelineKeys("session-a")(structuredClone(source));
  assert.deepEqual(first.map(item => item.key), reloaded.map(item => item.key));
  assert.notEqual(first[1].key, first[2].key);
  const updated = structuredClone(source);
  updated[3].detail.chosen = ["skill://read"];
  assert.equal(ui.createTimelineKeys("session-a")(updated)[3].key, first[3].key);
  assert.notEqual(ui.createTimelineKeys("session-b")(source)[0].key, first[0].key);
  const route = { view: "trace", sessionId: "session-a", filter: {}, event: first[2].key };
  assert.equal(ui.parseHash(ui.buildHash(route)).event, reloaded[2].key);
});

test("every daily histogram bar shares the baseline, including labelled zero ticks", () => {
  const day = 86400000;
  const rows = Array.from({ length: 31 }, (_, index) => Array.from({ length: (index * 7) % 13 }, () => ({ startedAt: index * day + 1000 }))).flat();
  const bars = ui.histogramBars(rows, 0, 31 * day);
  assert.equal(bars.length, 31);
  assert.equal(bars.reduce((total, bar) => total + bar.count, 0), rows.length);
  for (const bar of bars) {
    assert.equal(bar.y + bar.height, bars[0].baseline);
    assert.equal(bar.width, bars[0].width);
    if (bar.count === 0) assert.equal(bar.height, 1);
  }
  const empty = ui.histogramBars([], 0, 3 * day);
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
  for (const sort of ["duration", "-duration"]) assert.equal(ui.sortSessions([exposed, loaded], sort).at(-1).id, exposed.id);
});

test("the actual table renders candidate-only sessions with zero reads and a separate candidate cell", async t => {
  const { container } = await mount(t, ui.SessionTable, { rows: [loaded, exposed], route: { view: "sessions", filter: {}, sort: "-reads" }, navigate() {} });
  const cells = all(container, node => node.localName === "td" && node.getAttribute("class") === "cell-reads");
  assert.equal(cells[1].textContent, "0");
  assert.ok(!cells[1].textContent.includes("candidate"));
  const candidates = all(container, node => node.localName === "td" && node.getAttribute("class") === "cell-candidates");
  assert.ok(candidates[1].textContent.includes("candidate"));
  assert.equal(all(container, node => node.getAttribute("aria-sort") === "descending").length, 1);
  assert.equal(all(container, node => node.getAttribute("href")?.includes("peek=")).length, 2);
});

test("hiding prompt and ID columns retains a keyboard-accessible session link", async t => {
  const { container } = await mount(t, ui.SessionTable, {
    rows: [loaded, exposed], route: { view: "sessions", filter: {}, columns: ["runtime", "reads"] }, navigate() {},
  });
  assert.equal(all(container, node => node.localName === "a" && node.getAttribute("href")?.includes("peek=")).length, 2);
});

test("formatted and raw inspect the same event while native argument state survives switches", async t => {
  const step = { kind: "tool_call", ts: 100, summary: "Bash", detail: { kind: "tool_call", toolName: "Bash", args: "captured".repeat(200) } };
  const source = ui.createTimelineKeys("event-session")([step]);
  const route = { view: "trace", sessionId: "event-session", filter: { q: "scope" }, event: source[0].key, sort: "-reads" };
  const props = { source, bounds: { startedAt: 100, lastTs: 100 }, route, navigate() {} };
  const { container, show } = await mount(t, ui.EventConsole, props);
  const original = all(container, node => node.localName === "details" && node.getAttribute("class") === "tl__args")[0];
  await act(() => { original.open = true; });
  await show({ ...props, route: { ...route, format: "raw" } });
  const raw = all(container, node => node.hasAttribute("data-event-raw"))[0];
  assert.deepEqual(JSON.parse(raw.textContent), step);
  assert.ok(all(container, node => node === original)[0]);
  assert.equal(original.open, true);
  await show({ ...props, route: { ...route, format: "formatted" } });
  assert.equal(all(container, node => node.hasAttribute("data-event-raw")).length, 0);
  assert.ok(all(container, node => node === original)[0]);
  assert.equal(original.open, true);
});

test("tree/timeline selection retains event and filters and graph remains disabled", async t => {
  const source = ui.createTimelineKeys("event-session")([{ kind: "prompt", ts: 100, summary: "captured", detail: { kind: "prompt", text: "captured" } }]);
  const route = { view: "trace", sessionId: "event-session", filter: { q: "scope" }, event: source[0].key };
  let next;
  const { container } = await mount(t, ui.EventConsole, { source, bounds: { startedAt: 100 }, route, navigate(value) { next = value; } });
  const timeline = all(container, node => node.getAttribute("data-view") === "timeline")[0];
  await act(() => timeline.click());
  assert.deepEqual(next, { ...route, traceTab: "timeline" });
  const graph = all(container, node => node.getAttribute("aria-describedby") === "event-graph-reason")[0];
  assert.equal(graph.disabled || graph.hasAttribute("disabled"), true);
});

test("summary reads and selected-load digest come only from captured reads", async t => {
  const digest = "sha256:" + "a".repeat(64);
  const search = { kind: "search", ts: 100, summary: "q", detail: { kind: "search", chosen: ["skill://candidate"] } };
  assert.deepEqual(ui.summaryFacts([search]).reads, []);
  const load = { kind: "load", ts: 200, summary: "loaded", detail: { kind: "load", uri: "skill://actual", manifestDigest: digest } };
  assert.deepEqual(ui.summaryFacts([search, load]).reads, ["skill://actual"]);
  const source = ui.createTimelineKeys("digest-session")([load]);
  const { container } = await mount(t, ui.EventConsole, {
    source, bounds: { startedAt: 100 }, route: { view: "trace", filter: {}, event: source[0].key }, navigate() {},
  });
  assert.equal(all(container, node => node.hasAttribute("data-read-digest"))[0].textContent, digest);
});

test("an unavailable event URL never silently selects another captured event", async t => {
  const source = ui.createTimelineKeys("event-session")([{ kind: "prompt", ts: 100, summary: "captured", detail: { kind: "prompt", text: "captured" } }]);
  const { container } = await mount(t, ui.EventConsole, {
    source, bounds: { startedAt: 100 }, route: { view: "trace", filter: {}, event: "unavailable" }, navigate() {},
  });
  assert.equal(all(container, node => node.hasAttribute("data-event-kind") && node.getAttribute("aria-pressed") === "true").length, 0);
  assert.ok(all(container, node => node.getAttribute("role") === "status").length);
});

test("ranked candidates retain root disambiguation for identical recorded names", async t => {
  const candidates = ["agents", "claude"].map((root, index) => ({
    uri: `skill://local/${root}/same/SKILL.md`, name: "same", description: "captured",
    rank: index + 1, score: 1 - index / 10, invocation: "automatic",
  }));
  const { container } = await mount(t, ui.RankedCandidates, { candidates });
  assert.deepEqual(all(container, node => node.hasAttribute("data-root")).map(node => node.getAttribute("data-root")), ["agents", "claude"]);
});

test("unrecognised view preference values do not become active controls", () => {
  assert.deepEqual(ui.parseHash("#/sessions?sort=bad&density=bad&tab=graph&format=bad&runtime=codex"), {
    view: "sessions", filter: { runtime: ["codex"] },
  });
});

test("navigation-only command destinations retain the list scope and clear entity selection", () => {
  const route = {
    view: "trace", sessionId: "session", filter: { q: "migration", state: ["loaded"] },
    sort: "started", columns: ["started", "reads"], density: "comfortable", peek: "session", event: "load-id",
  };
  const next = ui.destination(route, "dashboard");
  const parsed = ui.parseHash(ui.buildHash(next));
  assert.equal(parsed.view, "dashboard");
  assert.deepEqual(parsed.filter, route.filter);
  assert.deepEqual(parsed.columns, route.columns);
  assert.equal(parsed.sort, route.sort);
  assert.equal(parsed.density, route.density);
  assert.equal(parsed.event, undefined);
  assert.equal(parsed.peek, undefined);
  assert.equal(parsed.sessionId, undefined);
});
