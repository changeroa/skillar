import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { act, all, loadViews, mount, waitFor } from "../../site/test/helpers/t10-dom.mjs";

const views = await loadViews(`
  export { api, configureApi } from "./local/dashboard/api.ts";
  export { DashboardView } from "./local/dashboard/views/dashboard.tsx";
`);
const fixtures = JSON.parse(readFileSync(new URL("../dashboard/dev-fixtures.json", import.meta.url), "utf8"));
const base = () => ({ ...views.api, mode: "http", sessions: async () => [], trace: async () => [], stats: async () => fixtures.stats,
  skills: async () => fixtures.skills });

for (const [name, Component, method] of [
  ["dashboard", views.DashboardView, "sessions"],
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

test("unavailable traces do not become zero request measurements", async t => {
  views.configureApi({ ...base(), sessions: async () => [fixtures.sessions[0]], trace: async () => { throw new Error("synthetic trace unavailable"); } });
  const props = { route: { view: "dashboard", filter: {} }, live: { state: "paused", seq: 0 }, navigate() {} };
  const { dom, container } = await mount(t, views.DashboardView, props);
  const metrics = () => all(container, node => (node.getAttribute("class") ?? "").split(/\s+/).includes("lf-metric__value"));
  await waitFor(dom, () => metrics().length === 3, "dashboard request metrics");
  assert.deepEqual([metrics()[1].textContent, metrics()[2].textContent], ["미측정", "미측정"]);
});

