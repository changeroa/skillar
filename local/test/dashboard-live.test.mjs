import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { descendants, installDom } from "./helpers/dashboard-dom.mjs";
import { bearer, http, startTestServer } from "./helpers/api.mjs";
import { seedEvidence } from "./helpers/dashboard-evidence.mjs";
import { channel, fakeScheduler, fakeTransport, fakeVisibility, modules, ready, replay, reportWire } from "./cloud-events-harness.test.mjs";

const bundled = await build({
  stdin: {
    contents: 'export {App} from "./dashboard/main.tsx"; export {configureApi} from "./dashboard/api.ts"; export {h, render} from "preact"; export {act} from "preact/test-utils";',
    resolveDir: new URL("../", import.meta.url).pathname, loader: "tsx",
  },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", jsxImportSource: "preact",
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const fixtures = JSON.parse(readFileSync(new URL("../dashboard/dev-fixtures.json", import.meta.url), "utf8"));
const sessionId = "ses_ac514fa3a9";

function host(t, hash, overrides = {}) {
  const newRoot = installDom();
  const root = newRoot();
  const events = new EventTarget();
  globalThis.location = new URL(`https://dashboard.example/${hash}`);
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  let handlers;
  const timers = new Map();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  // Release the view's debounce event explicitly; no wall-clock wait or hook is mocked.
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 300) return originalSetTimeout(callback, delay, ...args);
    const token = {};
    timers.set(token, callback);
    return token;
  };
  globalThis.clearTimeout = (token) => {
    if (!timers.delete(token)) originalClearTimeout(token);
  };
  const api = {
    mode: "cloud",
    sessions: async () => fixtures.sessions,
    stats: async () => fixtures.stats,
    skills: async () => fixtures.skills,
    trace: async () => fixtures.traces[sessionId],
    skillReport: async () => { throw new Error("optional report unavailable"); },
    flow: async (_filter, options) => ({ ...fixtures.flow12, unit: options.unit }),
    events(next) { handlers = next; next.onState("live"); return () => {}; },
    ...overrides,
  };
  const subscribe = api.events;
  api.events = (next) => { handlers = next; return subscribe(next); };
  const reads = [];
  const track = (read) => (...args) => {
    const result = read(...args);
    reads.push(result);
    return result;
  };
  for (const name of ["sessions", "stats", "skills", "trace", "skillReport", "flow", "flows", "flowReport", "workflowVersions"]) {
    if (api[name] === undefined) continue;
    api[name] = track(api[name]);
  }
  const settle = async () => {
    while (reads.length > 0) {
      const pending = reads.splice(0);
      await ui.act(async () => { await Promise.allSettled(pending); });
    }
  };
  ui.configureApi(api);
  t.after(async () => {
    await ui.act(() => ui.render(null, root));
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    for (const key of ["document", "HTMLDetailsElement", "location", "addEventListener", "removeEventListener"]) delete globalThis[key];
  });
  return {
    root, api,
    read(name, implementation) { api[name] = track(implementation); },
    pendingReads: () => reads.splice(0),
    async mount() { await ui.act(() => ui.render(ui.h(ui.App), root)); await settle(); },
    async state(next) { await ui.act(() => handlers.onState(next)); },
    async fireDebounce() {
      await ui.act(() => {
        for (const [token, callback] of [...timers]) { timers.delete(token); callback(); }
      });
    },
    async refresh() {
      await ui.act(() => handlers.onRefresh());
      await this.fireDebounce();
      await settle();
    },
  };
}
const find = (root, predicate) => {
  const node = descendants(root).find(predicate);
  assert.ok(node, `expected node in ${root.textContent}`);
  return node;
};
const classed = (root, name) => find(root, (node) => (node.attrs.class ?? "").split(" ").includes(name));
const click = (node) => node.listeners.click.call(node, { type: "click", target: node, currentTarget: node });

test("a live update preserves a populated Flow's selected unit and mounted controls", async (t) => {
  // Given
  const h = host(t, "#/flow");
  await h.mount();
  const group = find(h.root, (node) => node.attrs["aria-label"] === "Unit");
  const search = find(group, (node) => node.localName === "button" && node.attrs["aria-pressed"] === "false");
  await ui.act(async () => click(search));
  const section = find(h.root, (node) => node.attrs["data-unit"] === "search_requests");
  // When
  await h.refresh();
  // Then
  assert.ok(find(h.root, (node) => node.attrs["data-unit"] === "search_requests") === section);
  assert.ok(find(h.root, (node) => node.attrs["aria-label"] === "Unit") === group);
});

test("a live update keeps the Sessions search node and its unsubmitted draft", async (t) => {
  // Given
  const h = host(t, "#/sessions");
  await h.mount();
  const input = find(h.root, (node) => node.attrs.id === "session-search");
  input.value = "unsubmitted fixture query";
  input.focus();
  await ui.act(() => input.listeners.input?.call(input, { type: "input", target: input, currentTarget: input }));
  // When
  await h.refresh();
  // Then
  assert.ok(find(h.root, (node) => node.attrs.id === "session-search") === input);
  assert.equal(input.value, "unsubmitted fixture query");
});

test("generic refresh replaces trace data without discarding its existing disclosure", async (t) => {
  // Given
  const steps = fixtures.traces[sessionId].map((step) => step.kind === "prompt"
    ? { ...step, detail: { ...step.detail, text: "trace disclosure fixture ".repeat(80) } } : step);
  const h = host(t, `#/sessions/${sessionId}`, { trace: async () => steps });
  await h.mount();
  const disclosure = classed(h.root, "foldbtn");
  await ui.act(() => click(disclosure));
  h.read("trace", async () => [...steps, {
    kind: "prompt", ts: steps.at(-1).ts + 1,
    summary: "new uploaded prompt", detail: { kind: "prompt", text: "new uploaded prompt" },
  }]);
  // When
  await h.refresh();
  // Then
  assert.ok(classed(h.root, "foldbtn") === disclosure);
  assert.equal(disclosure.attrs["aria-expanded"], "true");
  assert.ok(h.root.textContent.includes("new uploaded prompt"));
});

test("a healthy cloud event transport does not change an unended historical trace's duration", async (t) => {
  // Given
  const steps = fixtures.traces[sessionId].filter((step) => step.kind !== "session_end");
  const h = host(t, `#/sessions/${sessionId}`, {
    trace: async () => steps,
    sessions: async () => fixtures.sessions.map((row) => row.id === sessionId ? { ...row, endedAt: undefined } : row),
    events(next) { next.onState("offline"); return () => {}; },
  });
  await h.mount();
  const duration = () => {
    const metadata = classed(h.root, "trace__meta");
    return find(metadata, (node) => node.localName === "div" && node.firstChild?.textContent === "Duration").textContent;
  };
  const historicalDuration = duration();
  // When
  await h.state("live");
  // Then
  assert.equal(duration(), historicalDuration);
});

test("generic refresh reconciles a workspace report with unchanged session rows and retains its disclosure", async (t) => {
  // Given
  const server = await startTestServer();
  t.after(() => server.stop());
  const fixture = seedEvidence(server.skillarHome);
  const response = await http(server.port, { path: `/api/flows/${fixture.flowId}`, headers: bearer(server.token) });
  assert.equal(response.status, 200);
  const report = response.json;
  const h = host(t, `#/workspaces/${fixture.flowId}`, {
    flowReport: async () => report,
    workflowVersions: async () => (await http(server.port, {
      path: `/api/workflows/${report.spec.name}/versions`, headers: bearer(server.token),
    })).json,
  });
  await h.mount();
  const disclosure = find(h.root, (node) => node.attrs["data-pane"] !== undefined);
  disclosure.open = false;
  const replacement = Promise.withResolvers();
  const selected = channel("new workspace report");
  h.read("flowReport", () => { selected.push(true); return replacement.promise; });
  // When
  const refreshed = h.refresh();
  await selected.take();
  assert.ok(classed(h.root, "ws__title").textContent === report.label, "the previous report remains visible while its replacement loads");
  replacement.resolve({ ...report, label: "updated workspace fixture" });
  await refreshed;
  // Then
  assert.equal(classed(h.root, "ws__title").textContent, "updated workspace fixture");
  assert.ok(find(h.root, (node) => node.attrs["data-pane"] !== undefined) === disclosure);
  assert.equal(disclosure.open, false);
});

test("bootstrap reconciles the final upload after head adoption and ignores the older pinned report completing last", async (t) => {
  // Given
  const head = Promise.withResolvers();
  const older = Promise.withResolvers();
  const pinned = channel("initial session report revision selection");
  const transport = fakeTransport();
  const scheduler = fakeScheduler();
  const jobs = new Map();
  let revision = 0;
  const previous = { ...fixtures.sessions[0], firstPrompt: "previous uploaded fixture" };
  const latest = { ...previous, id: "latest-upload", firstPrompt: "latest uploaded fixture" };
  let held;
  const api = modules.createCloudApi({ deviceId: "fixture-device", sourceDomain: "fixture-source" }, {
    onUnauthorized() { assert.fail("the fixture session remains authorized"); },
    live: { connect: transport.connect, scheduler, visibility: fakeVisibility(), transports: ["websocket"] },
    fetch: async (path, init) => {
      if (path === "/api/changes") return head.promise;
      const body = JSON.parse(init.body);
      if (path === "/api/dashboard/query") {
        const wire = reportWire(body.query.kind === "sessions" ? [revision === 0 ? previous : latest] : fixtures.stats,
          { sequence: 2, journalThrough: 3, runtimeSequence: revision + 1 });
        const jobId = crypto.randomUUID();
        wire.status.jobId = jobId;
        jobs.set(jobId, wire);
        if (body.query.kind === "sessions" && revision === 0) {
          held = wire;
          pinned.push(true);
          return older.promise;
        }
        return Response.json(wire.status);
      }
      assert.equal(path, "/api/dashboard/reports/result");
      return Response.json(jobs.get(body.jobId).parts[body.part]);
    },
  });
  t.after(() => {
    if (held) older.resolve(Response.json(held.status));
    head.resolve(Response.json(replay({ head: 5 })));
    api.dispose();
  });
  const h = host(t, "#/sessions", api);
  await ui.act(() => ui.render(ui.h(ui.App), h.root));
  await pinned.take();
  const initialReads = h.pendingReads();
  // When: the only new upload lands between selecting R and adopting head N.
  revision = 1;
  await ui.act(async () => {
    head.resolve(Response.json(replay({ head: 5 })));
    const socket = await transport.sockets.take();
    ready(socket, scheduler.now() + 300_000);
  });
  await h.fireDebounce();
  await ui.act(async () => { await Promise.allSettled(h.pendingReads()); });
  older.resolve(Response.json(held.status));
  await ui.act(async () => { await Promise.allSettled(initialReads); });
  // Then: no second upload or manual refresh is needed, even when R arrives last.
  assert.ok(h.root.textContent.includes(latest.firstPrompt));
  assert.ok(!h.root.textContent.includes(previous.firstPrompt));
});
