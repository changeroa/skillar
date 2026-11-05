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
