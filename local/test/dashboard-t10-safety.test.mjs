import assert from "node:assert/strict";
import test from "node:test";
import { act, all, buttonNamed, loadViews, mount, waitFor } from "../../site/test/helpers/t10-dom.mjs";

const views = await loadViews(`
  export { api, configureApi } from "./local/dashboard/api.ts";
  export { SessionsView } from "./local/dashboard/views/sessions.tsx";
  export { TraceView, searchDetail } from "./local/dashboard/views/trace.tsx";
`);
const live = { seq: 0, state: "paused" };
const props = { route: { view: "sessions", filter: {}, sessionId: "test" }, live, navigate() {} };
const report = {
  kind: "workflow", workspaceId: "workspace-test", label: "test", generatedAt: 1800000000000,
  flow: { registeredMs: 1800000000000, endedMs: null }, tree: { tabs: [], sessions: [] },
  finding: { sessions: [], aggregate: { labels: {} } }, usage: { sessions: [], skills: [] },
  unattributedLoads: { count: 1, uris: ["skill://fixture"] }, excludedSessions: [],
};

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
