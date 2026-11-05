import assert from "node:assert/strict";
import test from "node:test";
import { act, all, buttonNamed, loadViews, mount, waitFor } from "./helpers/t10-dom.mjs";
import { routes } from "../src/dashboard/api.ts";

const { SignedIn, Dashboard } = await loadViews('export * from "./site/src/dashboard/app.tsx";', { signedIn: true, cloud: true });
const user = { sub: "fixture", email: "fixture@example.test", name: "fixture", picture: "", createdAt: 1, lastLogin: 1 };
const signal = new AbortController().signal;
const profile = { deviceId: "device-test", sourceDomain: "source-test", sourceSequence: 1, journalThrough: 1,
  runtimeSequence: 1, capturedAtMs: 1800000000000, receivedAtMs: 1800000000000, availability: "ready" };
const profiles = { schemaVersion: 1, devices: [], profiles: [profile], ingestEnabled: true };
const common = { user, signal, selected: null, report: null, failure: null, onSelect() {}, onClose() {}, onRebuild() {}, onUnauthorized() {} };

test("CV-010 sources pending and failed never masquerade as selection waiting", async t => {
  // Given
  const held = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", async url => url === routes.profiles ? held.promise : Response.json({ devices: [] }));
  const { dom, container } = await mount(t, SignedIn, common);
  // When: the source query is pending
  const title = all(container, node => node.id === "dash-empty-title")[0];
  // Then
  assert.equal(title?.getAttribute("data-state"), "loading");
  held.resolve(Response.json({ error: "unavailable" }, { status: 503 }));
  await waitFor(dom, () => all(container, node => node.id === "dash-empty-title" && node.getAttribute("data-state") === "failed")[0], "failed source state");
  assert.ok(buttonNamed(container, "다시 시도")[0]);
});

test("CV-011 unrelated successes preserve failure while a matching recovery clears it", async t => {
  // Given
  let options;
  globalThis.__t10Cloud = (_profile, next) => { options = next; return { mode: "cloud", dispose() {}, refresh() {} }; };
  let failing = true;
  t.mock.method(globalThis, "fetch", async url => {
    if (url === routes.session) return Response.json({ user });
    if (url === routes.profiles) return Response.json(profiles);
    if (url === routes.devices) return Response.json({ devices: [] });
    return failing ? Response.json({ error: "test_failure" }, { status: 503 }) : Response.json({});
  });
  const { dom, container } = await mount(t, Dashboard, { signal });
  await waitFor(dom, () => buttonNamed(container, "기록 보기")[0], "source");
  await act(() => buttonNamed(container, "기록 보기")[0].click());
  // When
  await act(async () => { await options.fetch("/report/a"); });
  const alert = () => container.textContent.includes("test_failure");
  await waitFor(dom, alert, "request failure");
  failing = false;
  await act(async () => { await options.fetch("/report/b"); });
  // Then
  assert.equal(alert(), true);
  await act(async () => { await options.fetch("/report/a"); });
  assert.equal(alert(), false);
  // A fresh query request ID is transport identity, not a different failed query.
  const query = { profile: { deviceId: profile.deviceId, sourceDomain: profile.sourceDomain }, query: { kind: "sessions", filter: {} }, tz: "UTC" };
  failing = true;
  await act(async () => { await options.fetch("/api/dashboard/query", {
    method: "POST", body: JSON.stringify({ ...query, requestId: "11223344-1122-4122-8122-112233445566" }),
  }); });
  failing = false;
  await act(async () => { await options.fetch("/api/dashboard/query", {
    method: "POST", body: JSON.stringify({ ...query, requestId: "11223344-1122-4122-8122-112233445567" }),
  }); });
  assert.equal(alert(), false);
});

const source = { deviceId: profile.deviceId, sourceDomain: profile.sourceDomain };
const jobA = "11223344-1122-4122-8122-112233445570", jobB = "11223344-1122-4122-8122-112233445571";
const queryBody = requestId => ({ profile: source, query: { kind: "sessions", filter: {} }, tz: "UTC", requestId });
const report = jobId => ({
  schemaVersion: 1, jobId, state: "complete", generatedAt: 1, sourceCapturedAt: 1, sourceReceivedAt: 1,
  inputRevision: { sequence: 1, journalThrough: 1, runtimeSequence: 1 }, analysisVersion: 1,
  stale: false, pending: false, error: null, result: { parts: 1, bytes: 1, hash: "a".repeat(64) },
});

async function dashboardRequests(t, fetchReport) {
  let options;
  globalThis.__t10Cloud = (_profile, next) => { options = next; return { mode: "cloud", dispose() {}, refresh() {} }; };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === routes.session) return Response.json({ user });
    if (url === routes.profiles) return Response.json(profiles);
    if (url === routes.devices) return Response.json({ devices: [] });
    return fetchReport(url, init);
  });
  const { dom, container } = await mount(t, Dashboard, { signal });
  await waitFor(dom, () => buttonNamed(container, "기록 보기")[0], "source");
  await act(() => buttonNamed(container, "기록 보기")[0].click());
  return {
    failed: () => container.textContent.includes("gate_result_failed"),
    request: (path, body) => options.fetch(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    rebuild: () => buttonNamed(container, "보고서 다시 만들기")[0].click(),
  };
}

test("CV-011 successful retry with a new report job clears the previous job failure", async t => {
  // Given
  let queries = 0;
  const ui = await dashboardRequests(t, async path => path === "/api/dashboard/query"
    ? Response.json(report(++queries === 1 ? jobA : jobB))
    : queries === 1 ? Response.json({ error: "gate_result_failed" }, { status: 503 }) : Response.json({}));
  await act(async () => {
    await ui.request("/api/dashboard/query", queryBody(jobA));
    await ui.request("/api/dashboard/reports/result", { profile: source, jobId: jobA, part: 0 });
  });
  assert.equal(ui.failed(), true);
  // When
  await act(async () => {
    await ui.request("/api/dashboard/query", queryBody(jobB));
    await ui.request("/api/dashboard/reports/result", { profile: source, jobId: jobB, part: 0 });
  });
  // Then
  assert.equal(ui.failed(), false);
});

test("CV-011 old job failure cannot reinstate state after its replacement succeeds", async t => {
  // Given
  const held = Promise.withResolvers();
  let queries = 0;
  const ui = await dashboardRequests(t, async path => path === "/api/dashboard/query"
    ? Response.json(report(++queries === 1 ? jobA : jobB)) : queries === 1 ? held.promise : Response.json({}));
  await act(async () => { await ui.request("/api/dashboard/query", queryBody(jobA)); });
  const old = ui.request("/api/dashboard/reports/result", { profile: source, jobId: jobA, part: 0 });
  await act(async () => {
    await ui.request("/api/dashboard/query", queryBody(jobB));
    await ui.request("/api/dashboard/reports/result", { profile: source, jobId: jobB, part: 0 });
  });
  // When
  await act(async () => { held.resolve(Response.json({ error: "gate_result_failed" }, { status: 503 })); await old; });
  // Then
  assert.equal(ui.failed(), false);
});

for (const olderFails of [true, false]) {
  test(`CV-011 older ${olderFails ? "failure" : "success"} completion cannot overwrite the latest request`, async t => {
    // Given
    const held = Promise.withResolvers();
    let requests = 0;
    const ui = await dashboardRequests(t, () => ++requests === 1 ? held.promise :
      olderFails ? Response.json({}) : Response.json({ error: "gate_result_failed" }, { status: 503 }));
    const old = ui.request("/report/a");
    await act(async () => { await ui.request("/report/a"); });
    // When
    await act(async () => {
      held.resolve(olderFails ? Response.json({ error: "gate_result_failed" }, { status: 503 }) : Response.json({}));
      await old;
    });
    // Then
    assert.equal(ui.failed(), !olderFails);
  });
}

test("CV-011 a delayed failure body cannot overwrite a newer successful response", async t => {
  // Given
  let writer, requests = 0;
  const stream = new ReadableStream({ start(controller) { writer = controller; } });
  const ui = await dashboardRequests(t, () => ++requests === 1
    ? new Response(stream, { status: 503, headers: { "Content-Type": "application/json" } }) : Response.json({}));
  const old = ui.request("/report/a");
  await act(async () => { await ui.request("/report/a"); });
  // When
  await act(async () => {
    writer.enqueue(new TextEncoder().encode(JSON.stringify({ error: "gate_result_failed" })));
    writer.close();
    await old;
  });
  // Then
  assert.equal(ui.failed(), false);
});

test("CV-011 rebuild ignores completions from the cleared report generation", async t => {
  // Given
  const held = Promise.withResolvers();
  const ui = await dashboardRequests(t, () => held.promise);
  const old = ui.request("/report/a");
  await act(() => ui.rebuild());
  // When
  await act(async () => { held.resolve(Response.json({ error: "gate_result_failed" }, { status: 503 })); await old; });
  // Then
  assert.equal(ui.failed(), false);
});

test("CV-011 successful unrelated report leaves the failed logical query visible", async t => {
  // Given
  let queries = 0;
  const ui = await dashboardRequests(t, path => path === "/api/dashboard/query"
    ? Response.json(report(++queries === 1 ? jobA : jobB))
    : queries === 1 ? Response.json({ error: "gate_result_failed" }, { status: 503 }) : Response.json({}));
  await act(async () => {
    await ui.request("/api/dashboard/query", queryBody(jobA));
    await ui.request("/api/dashboard/reports/result", { profile: source, jobId: jobA, part: 0 });
  });
  // When
  await act(async () => {
    await ui.request("/api/dashboard/query", { ...queryBody(jobB), query: { kind: "stats", filter: {} } });
    await ui.request("/api/dashboard/reports/result", { profile: source, jobId: jobB, part: 0 });
  });
  // Then
  assert.equal(ui.failed(), true);
});
