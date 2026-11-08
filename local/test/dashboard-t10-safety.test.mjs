import assert from "node:assert/strict";
import test from "node:test";
import { act, all, buttonNamed, loadViews, mount, waitFor } from "../../site/test/helpers/t10-dom.mjs";

const views = await loadViews(`
  export { api, configureApi } from "./local/dashboard/api.ts";
  export { SessionsView } from "./local/dashboard/views/sessions.tsx";
  export { TraceView, searchDetail } from "./local/dashboard/views/trace.tsx";
  export { WorkspacesView, WorkspaceView, Session, Header } from "./local/dashboard/views/workspaces.tsx";
  export { HeatmapView } from "./local/dashboard/views/heatmap.tsx";
  export { FlowView } from "./local/dashboard/views/flow.tsx";
`);
const live = { seq: 0, state: "paused" };
const props = { route: { view: "sessions", filter: {}, sessionId: "test", flowId: "test" }, live, navigate() {} };
const report = {
  kind: "workflow", workspaceId: "workspace-test", label: "test", generatedAt: 1800000000000,
  flow: { registeredMs: 1800000000000, endedMs: null }, tree: { tabs: [], sessions: [] },
  finding: { sessions: [], aggregate: { labels: {} } }, usage: { sessions: [], skills: [] },
  unattributedLoads: { count: 1, uris: ["skill://fixture"] }, excludedSessions: [],
};

test("CV-017 snapshots without end evidence expose unknown session status", async t => {
  // Given
  const session = { id: "test", runtime: "codex", startedAt: 1800000000000, endedAt: null, turns: [] };
  // When
  const { container } = await mount(t, views.Session, {
    session, route: props.route, findings: new Map(), usageBySpan: new Map(),
  });
  // Then
  assert.equal(all(container, node => node.hasAttribute("data-session-status"))[0].getAttribute("data-session-status"), "unknown");
});

test("CV-020 missing elapsed time differs from measured zero", () => {
  // Given
  const step = { ts: 1, kind: "search", summary: "", detail: { kind: "search" } };
  // When
  const missing = views.searchDetail(step);
  const measured = views.searchDetail({ ...step, detail: { ...step.detail, elapsedMs: 0 } });
  // Then
  assert.equal(missing.elapsedMs, undefined);
  assert.equal(measured.elapsedMs, 0);
});

test("CV-023 report refresh failure preserves the last good attribution report", async t => {
  // Given
  let reads = 0;
  views.configureApi({
    ...views.api, mode: "http", trace: async () => [], sessions: async () => [{ id: "test" }],
    skillReport: async () => {
      if (++reads > 1) throw new TypeError("offline");
      return { ...report, tree: { turns: [] }, finding: { turns: [] } };
    },
  });
  const { dom, container, show } = await mount(t, views.TraceView, props);
  await waitFor(dom, () => all(container, node => node.hasAttribute("data-load-attribution"))[0], "initial report");
  // When
  await show({ ...props, live: { state: "paused", seq: 1, last: { id: "test" } } });
  await waitFor(dom, () => reads === 2 && (all(container, node => node.getAttribute("role") === "alert").length > 0 ||
    all(container, node => node.hasAttribute("data-load-attribution")).length === 0), "refresh settlement");
  // Then
  assert.equal(all(container, node => node.hasAttribute("data-load-attribution")).length, 1);
});

for (const [name, Component, methods] of [
  ["sessions", views.SessionsView, ["sessions", "stats"]],
  ["trace", views.TraceView, ["trace", "sessions", "skillReport"]],
  ["workspaces", views.WorkspacesView, ["flows"]],
  ["heatmap", views.HeatmapView, ["heatmap", "skillWeek"]],
]) {
  test(`CV-056 ${name} stops being busy when the first query fails`, async t => {
    // Given
    const failure = () => Promise.reject(new TypeError("offline"));
    views.configureApi({ ...views.api, ...Object.fromEntries(methods.map(method => [method, failure])) });
    const { dom, container } = await mount(t, Component, props);
    await waitFor(dom, () => all(container, node => node.getAttribute("role") === "alert")[0], "failed request");
    // When: request settled
    const section = all(container, node => node.hasAttribute("aria-busy"))[0];
    // Then
    assert.equal(section.getAttribute("aria-busy"), "false");
  });
}

for (const [name, Component, method] of [
  ["sessions", views.SessionsView, "sessions"], ["trace", views.TraceView, "trace"],
  ["workspaces", views.WorkspacesView, "flows"], ["workspace", views.WorkspaceView, "flowReport"],
  ["heatmap", views.HeatmapView, "heatmap"], ["flow", views.FlowView, "flow"],
]) {
  test(`CV-057 ${name} retries the failed query`, async t => {
    // Given
    let calls = 0;
    const retry = Promise.withResolvers();
    const failure = () => Promise.reject(new TypeError("offline"));
    views.configureApi({
      ...views.api, sessions: failure, stats: failure, trace: failure, skillReport: failure,
      flows: failure, flowReport: failure, heatmap: failure, skillWeek: failure, flow: failure, skills: failure,
      [method]: () => { calls += 1; if (calls === 2) retry.resolve(); return failure(); },
    });
    const { dom, container } = await mount(t, Component, props);
    await waitFor(dom, () => all(container, node => node.getAttribute("role") === "alert")[0], "failed request");
    // When
    const button = buttonNamed(container, "다시 시도")[0];
    assert.ok(button, "a failed query has a retry action");
    await act(() => button.click());
    await Promise.race([retry.promise, new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error("No retry request")), 1000);
      retry.promise.finally(() => clearTimeout(timeout));
    })]);
    // Then
    assert.equal(calls, 2);
  });
}
