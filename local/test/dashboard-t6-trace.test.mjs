import assert from "node:assert/strict";
import test from "node:test";
import { act, all, loadViews, mount, waitFor } from "../../site/test/helpers/t10-dom.mjs";

const views = await loadViews(`
  export { api, configureApi } from "./local/dashboard/api.ts";
  export { TraceView, timelineKey } from "./local/dashboard/views/trace.tsx";
  export { Candidates } from "./local/dashboard/components/candidates.tsx";
  export { SessionsView } from "./local/dashboard/views/sessions.tsx";
`);
const props = { route: { view: "trace", sessionId: "test", filter: { q: "review" } }, live: { state: "paused", seq: 0 }, navigate() {} };
const prompt = { ts: 1, kind: "prompt", summary: "request", detail: { kind: "prompt", eventId: "prompt-one", text: "가".repeat(800) } };

test("expanded prompt retains its DOM and state when an earlier event arrives", async t => {
  // Given
  let steps = [prompt];
  views.configureApi({ ...views.api, trace: async () => steps, sessions: async () => [{ id: "test", startedAt: 1 }],
    skillReport: async () => { throw new TypeError("unavailable"); } });
  const { dom, container, show } = await mount(t, views.TraceView, props);
  await waitFor(dom, () => all(container, node => node.getAttribute("aria-expanded") === "false")[0], "prompt fold");
  const fold = all(container, node => node.getAttribute("aria-expanded") === "false")[0];
  await act(() => fold.click());
  // When
  steps = [{ ts: 0, kind: "session_start", summary: "", detail: {} }, prompt];
  await show({ ...props, live: { state: "paused", seq: 1 } });
  await waitFor(dom, () => all(container, node => node.getAttribute("data-kind") === "session_start")[0], "new earlier event");
  // Then
  assert.equal(all(container, node => node.getAttribute("aria-expanded") === "true")[0], fold);
  assert.ok(container.textContent.includes(prompt.detail.text));
});

test("tool arguments preserve the complete captured text behind a disclosure", async t => {
  // Given
  const args = "인자".repeat(200);
  views.configureApi({ ...views.api, trace: async () => [{ ts: 1, kind: "tool_call", summary: "tool",
    detail: { kind: "tool_call", args } }], sessions: async () => [{ id: "test" }],
    skillReport: async () => { throw new TypeError("unavailable"); } });
  const { dom, container } = await mount(t, views.TraceView, props);
  // When
  await waitFor(dom, () => all(container, node => node.localName === "pre")[0], "argument disclosure");
  // Then
  const pre = all(container, node => node.localName === "pre")[0];
  assert.equal(pre.textContent, args);
  assert.equal(pre.parentNode.localName, "details");
});

test("candidate disclosure retains long names descriptions and all matched terms", async t => {
  // Given
  const candidate = { uri: "skill://local/test/SKILL.md", name: "긴 이름".repeat(40), description: "설명".repeat(300),
    matched: ["조건".repeat(100)], rank: 1, score: 0.9, invocation: "automatic", digest: "" };
  // When
  const { container } = await mount(t, views.Candidates, { candidates: [candidate] });
  // Then
  const disclosure = all(container, node => node.localName === "details")[0];
  for (const value of [candidate.name, candidate.description, ...candidate.matched]) assert.ok(disclosure.textContent.includes(value));
});

test("timeline identity uses canonical report events and stable content for legacy traces", () => {
  // Given
  const step = { ts: 10, kind: "prompt", summary: "request", detail: { text: "request" } };
  const item = { kind: "step", step };
  const report = { tree: { turns: [{ events: [{ id: "event-one", ts: 10, kind: "prompt", text: "request" }] }], unassignedEvents: [] } };
  // When / Then
  assert.equal(views.timelineKey(item, report), "event:event-one");
  assert.equal(views.timelineKey(item), views.timelineKey({ kind: "step", step: structuredClone(step) }));
  assert.notEqual(views.timelineKey(item), views.timelineKey({ kind: "step", step: { ...step, ts: 11 } }));
});

test("equal timestamps claim different canonical events instead of duplicate row keys", () => {
  // Given
  const item = { kind: "step", step: { ts: 10, kind: "tool_call", summary: "tool", detail: {} } };
  const report = { tree: { turns: [{ events: [{ id: "one", ts: 10, kind: "tool_call" }, { id: "two", ts: 10, kind: "tool_call" }] }], unassignedEvents: [] } };
  const claimed = new Set();
  // When
  const keys = [views.timelineKey(item, report, claimed), views.timelineKey(item, report, claimed)];
  // Then
  assert.deepEqual(keys, ["event:one", "event:two"]);
});

test("compact desktop session selection preserves the complete URL filter", async t => {
  // Given
  const rows = [{ id: "test", runtime: "claude", startedAt: 1, firstPrompt: "request" }];
  views.configureApi({ ...views.api, sessions: async () => rows, stats: async () => ({}) });
  // When
  const { dom, container } = await mount(t, views.SessionsView, { ...props, detail: true });
  await waitFor(dom, () => all(container, node => node.getAttribute("role") === "option")[0], "compact session option");
  // Then
  const option = all(container, node => node.getAttribute("role") === "option")[0];
  assert.equal(option.getAttribute("href"), "#/sessions/test?q=review");
  assert.equal(option.getAttribute("aria-selected"), "true");
  assert.equal(all(container, node => node.getAttribute("role") === "listbox")[0].getAttribute("tabindex"), "0");
});

for (const [name, Component, methods] of [
  ["sessions", views.SessionsView, ["sessions", "stats"]], ["trace", views.TraceView, ["trace", "sessions", "skillReport"]],
]) {
  test(`${name} exposes visible loading feedback while its request is pending`, async t => {
    // Given
    const pending = Promise.withResolvers();
    views.configureApi({ ...views.api, ...Object.fromEntries(methods.map(method => [method, () => pending.promise])) });
    // When
    const { container } = await mount(t, Component, props);
    // Then
    assert.ok(all(container, node => node.getAttribute("role") === "status").some(node => node.textContent.length > 0));
    assert.equal(all(container, node => node.hasAttribute("aria-busy"))[0].getAttribute("aria-busy"), "true");
  });
}
