import assert from "node:assert/strict";
import test from "node:test";
import { act, all, loadViews, mount, waitFor } from "../../site/test/helpers/t10-dom.mjs";

const ui = await loadViews(`
  export { api, configureApi } from "./local/dashboard/api.ts";
  export { TraceView } from "./local/dashboard/views/trace.tsx";
`);
const props = {
  route: { view: "trace", sessionId: "gate-session", filter: {} },
  live: { state: "paused", seq: 0 }, navigate() {},
};
const promptText = "가".repeat(800);
// The real store's prompt TraceStep does not contain detail.eventId.
const prompt = {
  ts: 100, kind: "prompt", summary: promptText.slice(0, 200),
  detail: { kind: "prompt", text: promptText, textLength: promptText.length },
};
const promptEvent = { id: "real-prompt-id", ts: 100, kind: "prompt", text: promptText };
const report = {
  tree: { turns: [{ id: "turn", events: [promptEvent], skillSpans: [] }], unassignedEvents: [] },
  finding: { turns: [] }, unattributedLoads: { count: 0, uris: [] },
};

test("prompt disclosure survives refresh when a previously unavailable report becomes available", async t => {
  // Given
  let available = false;
  let traceCalls = 0;
  ui.configureApi({
    ...ui.api,
    trace: async () => { traceCalls++; return [structuredClone(prompt)]; },
    sessions: async () => [{ id: "gate-session", startedAt: 100 }],
    skillReport: async () => { if (!available) throw Error("temporary report failure"); return report; },
  });
  const { dom, container, show } = await mount(t, ui.TraceView, props);
  await waitFor(dom, () => all(container, n => n.getAttribute("aria-expanded") === "false")[0], "initial prompt");
  const original = all(container, n => n.getAttribute("aria-expanded") === "false")[0];
  await act(() => original.click());
  assert.equal(original.getAttribute("aria-expanded"), "true");
  // When
  available = true;
  await show({ ...props, live: { state: "paused", seq: 1 } });
  await waitFor(dom, () => traceCalls === 2 && all(container, n => n.getAttribute("aria-busy") === "false")[0], "refresh completed");
  const current = all(container, n => n.hasAttribute("aria-expanded"))[0];
  // Then
  assert.ok(current === original, "the same recorded prompt must keep its DOM node across report recovery");
  assert.equal(current.getAttribute("aria-expanded"), "true");
});

test("captured tool arguments remain accessible when a skill report groups the call into a span", async t => {
  // Given
  const args = "인자".repeat(200) + "CAPTURED_TAIL";
  const event = {
    id: "tool-event", ts: 200, kind: "tool_call", text: args,
    data: { toolName: "Bash", success: true, durationMs: 4 },
  };
  const span = { id: "skill-span", skill: "fixture", name: "예시 스킬", uri: null, startedAt: 100, endedAt: 300, events: [event] };
  const groupedReport = {
    ...report, tree: { turns: [{ id: "turn", events: [promptEvent, event], skillSpans: [span] }], unassignedEvents: [] },
  };
  ui.configureApi({
    ...ui.api,
    trace: async () => [prompt, { ts: 200, kind: "tool_call", summary: "Bash", detail: { kind: "tool_call", toolName: "Bash", args } }],
    sessions: async () => [{ id: "gate-session", startedAt: 100 }],
    skillReport: async () => groupedReport,
  });
  // When
  const { dom, container } = await mount(t, ui.TraceView, props);
  await waitFor(dom, () => all(container, n => n.getAttribute("data-kind") === "skill_span")[0], "grouped span");
  // Then
  assert.ok(container.textContent.includes("Bash"), "the grouped call itself renders");
  assert.ok(container.textContent.includes(args), "all captured arguments must remain available in a disclosure or full-content path");
  assert.equal(all(container, n => n.localName === "pre")[0].parentNode.localName, "details");
});

test("ungrouped captured tool arguments remain accessible as a control", async t => {
  // Given
  const args = "인자".repeat(200) + "CAPTURED_TAIL";
  ui.configureApi({
    ...ui.api,
    trace: async () => [{ ts: 200, kind: "tool_call", summary: "Bash", detail: { kind: "tool_call", toolName: "Bash", args } }],
    sessions: async () => [{ id: "gate-session", startedAt: 100 }],
    skillReport: async () => { throw Error("no report"); },
  });
  // When
  const { dom, container } = await mount(t, ui.TraceView, props);
  await waitFor(dom, () => all(container, n => n.localName === "pre")[0], "argument disclosure");
  // Then
  assert.ok(container.textContent.includes(args));
});

test("every grouped tool call retains a disclosure beyond the metadata list fold limit", async t => {
  // Given
  const events = Array.from({ length: 14 }, (_, index) => ({
    id: `tool-${index}`, ts: 200 + index, kind: "tool_call", text: index === 0 ? "x" : `${"인자".repeat(200)}TAIL_${index}`,
    data: { toolName: `tool-${index}`, success: true, durationMs: 4 },
  }));
  const span = { id: "skill-span", skill: "fixture", name: "예시 스킬", uri: null, startedAt: 100, endedAt: 300, events };
  ui.configureApi({
    ...ui.api,
    trace: async () => [prompt, ...events.map(event => ({
      ts: event.ts, kind: event.kind, summary: event.data.toolName,
      detail: { kind: event.kind, toolName: event.data.toolName, args: event.text },
    }))],
    sessions: async () => [{ id: "gate-session", startedAt: 100 }],
    skillReport: async () => ({ ...report, tree: { turns: [{ id: "turn", events: [promptEvent, ...events], skillSpans: [span] }], unassignedEvents: [] } }),
  });
  // When
  const { dom, container } = await mount(t, ui.TraceView, props);
  await waitFor(dom, () => all(container, n => n.getAttribute("data-kind") === "skill_span")[0], "grouped calls");
  // Then
  const payloads = all(container, n => n.localName === "pre");
  assert.deepEqual(payloads.map(node => node.textContent), events.map(event => event.text));
  assert.ok(payloads.every(node => node.parentNode.localName === "details"));
});

test("grouped calls preserve captured data arguments when event text is absent", async t => {
  // Given
  const args = `${"인자".repeat(200)}DATA_TAIL`;
  const event = { id: "tool-data", ts: 200, kind: "tool_call", text: null, textLength: null, data: { toolName: "Bash", args } };
  const span = { id: "skill-span", skill: "fixture", name: "예시 스킬", uri: null, startedAt: 100, endedAt: 300, events: [event] };
  ui.configureApi({
    ...ui.api,
    trace: async () => [{ ts: event.ts, kind: event.kind, summary: "Bash", detail: { kind: event.kind, args } }],
    sessions: async () => [{ id: "gate-session", startedAt: 100 }],
    skillReport: async () => ({ ...report, tree: { turns: [{ id: "turn", events: [event], skillSpans: [span] }], unassignedEvents: [] } }),
  });
  // When
  const { dom, container } = await mount(t, ui.TraceView, props);
  await waitFor(dom, () => all(container, n => n.getAttribute("data-kind") === "skill_span")[0], "grouped data call");
  // Then
  assert.equal(all(container, n => n.localName === "pre")[0]?.textContent, args);
});

test("a later load preserves the same search candidate disclosure", async t => {
  const uri = "skill://local/gate/example/SKILL.md";
  const candidate = {
    uri, name: "예시 스킬", description: "후보 설명", digest: "digest",
    rank: 1, score: 0.9, matched: ["example"], invocation: "automatic", chosen: false,
  };
  const search = {
    ts: 100, kind: "search", summary: "search example",
    detail: {
      kind: "search", traceId: "recorded-search", query: "example", mode: "automatic",
      chosen: [], candidates: [candidate], elapsedMs: 12, total: 1,
    },
  };
  let steps = [search];
  ui.configureApi({
    ...ui.api, trace: async () => structuredClone(steps),
    sessions: async () => [{ id: "gate-session", startedAt: 100 }],
    skillReport: async () => { throw Error("report unavailable"); },
  });
  const props = {
    route: { view: "trace", sessionId: "gate-session", filter: {} },
    live: { state: "paused", seq: 0 }, navigate() {},
  };
  const { dom, container, show } = await mount(t, ui.TraceView, props);
  const findDisclosure = () => all(container, n => n.localName === "details" && n.getAttribute("class") === "cand__desc")[0];
  await waitFor(dom, findDisclosure, "initial candidate disclosure");
  const original = findDisclosure();
  await act(() => { original.open = true; });
  // The real store recomputes chosen and candidate.chosen from later loads carrying this traceId.
  steps = [
    { ...search, detail: { ...search.detail, chosen: [uri], candidates: [{ ...candidate, chosen: true }] } },
    { ts: 200, kind: "load", summary: "load example", detail: { kind: "load", traceId: "recorded-search", loadId: "load-one", uri, manifestDigest: "digest" } },
  ];
  await show({ ...props, live: { state: "paused", seq: 1 } });
  await waitFor(dom, () => all(container, n => n.getAttribute("data-chosen") === "true")[0], "updated read attribution");
  assert.ok(findDisclosure() === original, "the same search must preserve its disclosure DOM when chosen attribution changes");
  assert.equal(findDisclosure().open, true, "the candidate disclosure must remain expanded");
});
