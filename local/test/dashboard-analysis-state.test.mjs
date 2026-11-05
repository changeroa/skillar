import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { act, all, loadViews, mount, waitFor } from "../../site/test/helpers/t10-dom.mjs";

const views = await loadViews(`
  export { api, configureApi } from "./local/dashboard/api.ts";
  export { FlowView } from "./local/dashboard/views/flow.tsx";
  export { HeatmapView } from "./local/dashboard/views/heatmap.tsx";
  export { WorkspacesView } from "./local/dashboard/views/workspaces.tsx";
  export { DashboardView } from "./local/dashboard/views/dashboard.tsx";
`);
const fixtures = JSON.parse(readFileSync(new URL("../dashboard/dev-fixtures.json", import.meta.url), "utf8"));
const base = () => ({ ...views.api, mode: "http", sessions: async () => [], trace: async () => [], stats: async () => fixtures.stats,
  skills: async () => fixtures.skills, flow: async () => ({ ...fixtures.flow, nodes: [], links: [], requestCount: 0, unit: "search_requests" }),
  heatmap: async () => fixtures.heatmap, skillWeek: async () => fixtures.skillWeek,
  flows: async () => ({ flows: [], generatedAt: 1, nextCursor: null }) });

for (const [name, Component, method] of [
  ["flow", views.FlowView, "flow"], ["heatmap", views.HeatmapView, "heatmap"],
  ["workspaces", views.WorkspacesView, "flows"], ["dashboard", views.DashboardView, "sessions"],
]) for (const embedded of [false, true]) test(`${name} ${embedded ? "embedded refreshes" : "standalone retains its report"} on a live sequence change`, async t => {
  const api = base(), implementation = api[method];
  let calls = 0;
  api[method] = async (...args) => { calls++; return implementation(...args); };
  views.configureApi(api);
  const props = { route: { view: name, filter: {} }, live: { state: "paused", seq: 0 }, embedded, navigate() {} };
  const { dom, container, show } = await mount(t, Component, props);
  await waitFor(dom, () => calls === 1 && !all(container, node => node.getAttribute("aria-busy") === "true").length, "initial report settled");
  await show({ ...props, live: { state: "live", seq: 1 } });
  assert.equal(calls, embedded ? 2 : 1);
});

for (const reject of [false, true]) test(`flow preserves fetched conditions through ${reject ? "failed" : "pending"} unit replacement`, async t => {
  const initial = { ...fixtures.flow, nodes: [], links: [], unit: "search_requests", requestCount: 0 };
  const held = Promise.withResolvers();
  let calls = 0;
  views.configureApi({ ...base(), flow: async () => ++calls === 1 ? initial : held.promise });
  const props = { route: { view: "flow", filter: {}, flowUnit: "search_requests" }, live: { state: "paused", seq: 0 }, navigate() {} };
  const { dom, container, show } = await mount(t, views.FlowView, props);
  await waitFor(dom, () => all(container, node => node.hasAttribute("data-result-conditions"))[0], "initial conditions");
  const before = all(container, node => node.hasAttribute("data-result-conditions"))[0].textContent;
  await show({ ...props, route: { ...props.route, flowUnit: "load_requests" } });
  assert.equal(calls, 2);
  if (reject) {
    await act(() => held.reject(new Error("synthetic replacement failure")));
    await waitFor(dom, () => all(container, node => node.getAttribute("role") === "alert")[0], "replacement failed");
  }
  assert.equal(all(container, node => node.hasAttribute("data-result-conditions"))[0].textContent, before);
});

test("unavailable traces do not become zero request measurements", async t => {
  views.configureApi({ ...base(), sessions: async () => [fixtures.sessions[0]], trace: async () => { throw new Error("synthetic trace unavailable"); } });
  const props = { route: { view: "dashboard", filter: {} }, live: { state: "paused", seq: 0 }, navigate() {} };
  const { dom, container } = await mount(t, views.DashboardView, props);
  const metrics = () => all(container, node => (node.getAttribute("class") ?? "").split(/\s+/).includes("analysis-number"));
  await waitFor(dom, () => metrics().length === 4, "dashboard request metrics");
  assert.deepEqual([metrics()[1].textContent, metrics()[2].textContent], ["미측정", "미측정"]);
});

test("unavailable traces keep weekly reads unmeasured", async t => {
  views.configureApi({ ...base(), sessions: async () => [fixtures.sessions[0]], trace: async () => { throw new Error("synthetic trace unavailable"); } });
  const props = { route: { view: "heatmap", filter: {} }, live: { state: "paused", seq: 0 }, navigate() {} };
  const { dom, container } = await mount(t, views.HeatmapView, props);
  await waitFor(dom, () => all(container, node => node.getAttribute("data-week-measured") === "false")[0], "weekly read measurement unavailable");
  const weekly = all(container, node => node.getAttribute("data-week-measured") === "false")[0];
  assert.ok(weekly.textContent.includes("미측정"));
  assert.equal(all(weekly, node => node.hasAttribute("data-count")).length, 0);
});
