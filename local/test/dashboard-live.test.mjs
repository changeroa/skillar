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
    contents: 'export {App} from "./dashboard/main.tsx"; export {configureApi} from "./dashboard/api.ts"; export {createElement as h} from "react"; export {render} from "./dashboard/react-mount"; export {act} from "react";',
    resolveDir: new URL("../", import.meta.url).pathname, loader: "tsx",
  },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", jsxImportSource: "react",
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
    // The bundled React dev scheduler's MessageChannel task ports can outlive a test with pending
    // (already-asserted) work; unref them so the runner can exit. Browser behavior is unaffected.
    for (const handle of process._getActiveHandles?.() ?? []) {
      if (handle?.constructor?.name === "MessagePort" && typeof handle.unref === "function") handle.unref();
    }
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
const classed = (root, name) => find(root, (node) => (node.getAttribute("class") ?? "").split(" ").includes(name));
const click = (node) => node.click();

test("cloud transport states have distinct accessible labels and recover their live label", async (t) => {
  // Given
  const h = host(t, "#/sessions", {
    events(next) { next.onState("connecting"); return () => {}; },
  });
  await h.mount();
  const label = () => classed(h.root, "live").textContent;
  const connecting = label();
  // When
  await h.state("live");
  const live = label();
  await h.state("paused");
  const paused = label();
  assert.ok(classed(h.root, "live--paused"));
  assert.ok(paused.length > 0);
  await h.state("offline");
  const offline = label();
  await h.state("live");
  // Then
  assert.equal(new Set([connecting, live, paused, offline]).size, 4);
  assert.equal(label(), live);
});

test("a live update keeps the Sessions search node and its unsubmitted draft", async (t) => {
  // Given
  const h = host(t, "#/sessions");
  await h.mount();
  const input = find(h.root, (node) => node.getAttribute("id") === "session-search");
  const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set;
  setValue.call(input, "unsubmitted fixture query");
  input.focus();
  await ui.act(() => input.dispatchEvent(new (input.ownerDocument.defaultView.Event)("input", { bubbles: true })));
  // When
  await h.refresh();
  // Then
  assert.ok(find(h.root, (node) => node.getAttribute("id") === "session-search") === input);
  assert.equal(input.value, "unsubmitted fixture query");
});

test("workspace facet filters the session list to flow members and keeps member links", async (t) => {
  // Given: a flow whose membership covers exactly two of the fixture sessions, selected via ?ws=.
  const memberIds = ["ses_770bad4531", "ses_1fe658341a"];
  const entry = { id: "flow:release", kind: "flow", workspaceId: "ws-release", tabId: null, label: "릴리스 준비",
    registered: true, spec: null, startedMs: null, endedMs: null, paneIds: ["pane-release"],
    sessionIds: memberIds, counts: { panes: 1, sessions: memberIds.length },
    attribution: { reported: memberIds.length, inferred: 0, unlinked: 0 } };
  const flowsDto = { generatedAt: 0, from: null, to: null, limit: 100, automated: "exclude", flows: [entry], nextCursor: null };
  const h = host(t, `#/sessions?ws=${encodeURIComponent("flow:release")}`, { flows: async () => flowsDto });
  await h.mount();
  // Then: the facet lists the workspace as selected with its member count...
  const chip = find(h.root, (node) => node.textContent === "릴리스 준비");
  assert.ok(chip.closest("label")?.textContent.includes("2") || chip.parentElement?.textContent.includes("2"));
  assert.ok(h.root.textContent.includes("세션 2개"));
  // ...only member sessions render, each still linking to its detail peek.
  const links = descendants(h.root).filter((node) => node.getAttribute("href")?.includes("peek="));
  assert.equal(links.length, memberIds.length);
  for (const id of memberIds) assert.ok(links.some((node) => decodeURIComponent(node.getAttribute("href")).includes(id)));
  // And a live refresh keeps the filtered membership.
  await h.refresh();
  assert.equal(descendants(h.root).filter((node) => node.getAttribute("href")?.includes("peek=")).length, memberIds.length);
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
  assert.equal(disclosure.getAttribute("aria-expanded"), "true");
  assert.ok(h.root.textContent.includes("new uploaded prompt"));
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
