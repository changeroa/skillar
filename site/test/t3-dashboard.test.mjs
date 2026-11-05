import assert from "node:assert/strict";
import test from "node:test";
import { act, all, buttonNamed, loadViews, mount, waitFor } from "./helpers/t10-dom.mjs";
import { DashboardRequestError, describeFailure, readSession, routes } from "../src/dashboard/api.ts";

const { Dashboard, SignedIn, HomeChecklist, PermissionSummary } = await loadViews(`
  export * from "./site/src/dashboard/app.tsx";
  export * from "./site/src/dashboard/home-checklist.tsx";
  export * from "./site/src/dashboard/permission-summary.tsx";
`, { signedIn: true, cloud: true });
const user = { sub: "fixture", email: "fixture@example.test", name: "예시", picture: "", createdAt: 1, lastLogin: 1 };
const signal = new AbortController().signal;
const profile = { deviceId: "device-test", sourceDomain: "source-test", sourceSequence: 1, journalThrough: 1,
  runtimeSequence: 1, capturedAtMs: 1800000000000, receivedAtMs: 1800000000000, availability: "ready" };
const response = profiles => ({ schemaVersion: 1, devices: [], profiles, ingestEnabled: true });
const common = { user, signal, selected: null, report: null, failure: null, onSelect() {}, onClose() {}, onRebuild() {}, onUnauthorized() {} };
const picker = container => all(container, node => node.localName === "details" && node.getAttribute("class") === "dash-source-picker")[0];
const home = container => all(container, node => node.id === "dash-empty-title")[0];

test("source loading transitions through failure and retry to explicit choice", async t => {
  // Given
  const held = Promise.withResolvers();
  let reads = 0, selections = 0;
  t.mock.method(globalThis, "fetch", async url => url === routes.profiles ?
    ++reads === 1 ? held.promise : Response.json(response([profile])) : Response.json({ devices: [] }));
  const { dom, container } = await mount(t, SignedIn, { ...common, onSelect() { selections++; } });
  assert.equal(home(container)?.getAttribute("data-state"), "loading");
  assert.equal(picker(container), undefined);
  await act(async () => { held.resolve(Response.json({ error: "dashboard_unavailable" }, { status: 503 })); });
  await waitFor(dom, () => home(container)?.getAttribute("data-state") === "failed", "failed state");
  assert.equal(picker(container), undefined);
  // When
  await act(() => buttonNamed(container, "다시 시도")[0].click());
  await waitFor(dom, () => home(container)?.getAttribute("data-state") === "choose", "choice state");
  // Then
  assert.ok(picker(container));
  assert.equal(selections, 0);
  await act(() => buttonNamed(container, "기록 보기")[0].click());
  assert.equal(selections, 1);
});

test("successful empty or unavailable sources show checklist instead of a picker", async t => {
  // Given
  t.mock.method(globalThis, "fetch", async url => url === routes.profiles ?
    Response.json(response([{ ...profile, availability: "metadata-only" }])) : Response.json({ devices: [] }));
  const { dom, container } = await mount(t, SignedIn, common);
  // When
  await waitFor(dom, () => home(container)?.getAttribute("data-state") === "none", "no viewable source");
  // Then
  assert.equal(picker(container), undefined);
  assert.equal(all(container, node => node.localName === "ol")[0]?.children.length, 3);
});

test("refreshed profile facts replace the originally selected snapshot facts", async t => {
  // Given
  let latest = profile;
  t.mock.method(globalThis, "fetch", async url => url === routes.profiles ?
    Response.json(response([latest])) : Response.json({ devices: [] }));
  const { dom, container } = await mount(t, SignedIn, { ...common, selected: profile });
  await waitFor(dom, () => picker(container), "source read");
  latest = { ...profile, sourceSequence: 928, journalThrough: 929 };
  // When
  await act(() => buttonNamed(container, "출처 다시 읽기")[0].click());
  await waitFor(dom, () => all(container, node => node.getAttribute("class") === "source__revisions")[0]?.textContent.includes("928"), "refreshed source");
  // Then
  const facts = all(container, node => node.getAttribute("class") === "account-status snapshot__facts")[0];
  assert.ok(facts.textContent.includes("928"));
  assert.ok(facts.textContent.includes("929"));
});

test("closing a selected record restores focus to the reopened source picker", async t => {
  // Given
  globalThis.__t10Cloud = () => ({ mode: "cloud", dispose() {}, refresh() {} });
  t.mock.method(globalThis, "fetch", async url => url === routes.session ? Response.json({ user }) :
    url === routes.profiles ? Response.json(response([profile])) : Response.json({ devices: [] }));
  const { dom, container } = await mount(t, Dashboard, { signal });
  await waitFor(dom, () => buttonNamed(container, "기록 보기")[0], "source");
  await act(() => buttonNamed(container, "기록 보기")[0].click());
  const close = buttonNamed(container, "기록 닫기")[0];
  close.focus();
  // When
  await act(() => close.click());
  // Then
  assert.equal(home(container)?.getAttribute("data-state"), "choose");
  assert.equal(picker(container).open, true);
  assert.equal(dom.activeElement.localName, "summary");
  assert.ok(picker(container).contains(dom.activeElement));
});

const localDevice = { deviceId: profile.deviceId, createdAt: 1, revokedAt: null, version: 0, consent: { mode: "local-only" } };
const readyDevices = data => ({ status: "ready", data, message: "", technical: "" });
test("connection alone completes only the connection checklist step", async t => {
  // Given
  const { container } = await mount(t, HomeChecklist, {
    state: "none", message: "", technical: "", profiles: [], devices: readyDevices([localDevice]), onRetry() {}, onManage() {},
  });
  // When
  const steps = all(container, node => node.localName === "li");
  // Then
  assert.deepEqual(steps.map(step => step.getAttribute("data-state")), ["done", "pending", "pending"]);
});

test("failed device reads never reuse stale consent as completed checklist steps", async t => {
  // Given
  const { container } = await mount(t, HomeChecklist, {
    state: "none", message: "", technical: "", profiles: [],
    devices: { status: "failed", data: [localDevice], message: "조회 실패", technical: "" }, onRetry() {}, onManage() {},
  });
  // When
  const steps = all(container, node => node.localName === "li");
  // Then
  assert.deepEqual(steps.map(step => step.getAttribute("data-state")), ["failed", "failed", "pending"]);
});

test("permission summary remains read only for each returned consent mode", async t => {
  // Given
  const consent = { mode: "managed-content", version: 1, grantedAtMs: 1,
    scope: { deviceId: profile.deviceId, projectIds: ["project"], rootIds: [] },
    retention: { contentDays: 30, projectionDays: 30, backupDays: 30 },
    contentKinds: ["prompt"], serverProcessingAcknowledged: true, externalModelTransfer: false };
  const { container } = await mount(t, PermissionSummary, {
    devices: readyDevices([localDevice, { ...localDevice, deviceId: "second", consent },
      { ...localDevice, deviceId: "metadata", consent: { mode: "metadata", version: 1, grantedAtMs: 1,
        scope: consent.scope, retention: consent.retention } },
      { ...localDevice, deviceId: "revoked", revokedAt: 2 }]), onRetry() {},
  });
  // When
  const lists = all(container, node => node.localName === "dl");
  // Then
  assert.equal(lists.length, 4);
  assert.deepEqual(lists.map(list => list.children.length), [5, 5, 5, 5]);
  assert.equal(all(container, node => ["input", "select", "form"].includes(node.localName)).length, 0);
});

for (const [error, expected] of [[new SyntaxError("bad JSON"), "unexpected"], [new TypeError("offline"), "unreachable"]]) {
  test(`session read distinguishes ${error.name} from other failure causes`, async t => {
    // Given
    t.mock.method(globalThis, "fetch", async () => { throw error; });
    // When
    const state = await readSession();
    // Then
    assert.equal(state.kind, expected);
  });
}

test("unknown server code is available on error but excluded from user message", () => {
  // Given
  const error = new DashboardRequestError(500, "untrusted_backend_code");
  // When
  const message = describeFailure(error, "출처 읽기");
  // Then
  assert.equal(message.includes(error.code), false);
  assert.ok(error.message.includes(error.code));
});
