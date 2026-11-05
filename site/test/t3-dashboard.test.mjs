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

for (const name of [user.name, ""]) {
  test(`signed-in dashboard supplies the shell account and native logout with name ${JSON.stringify(name)}`, async t => {
    // Given
    t.mock.method(globalThis, "fetch", async url => url === routes.profiles ?
      Response.json(response([])) : Response.json({ devices: [] }));
    // When
    const { container } = await mount(t, SignedIn, { ...common, user: { ...user, name } });
    // Then
    const account = all(container, node => node.getAttribute("class") === "dash-account")[0];
    assert.ok(account, "the shell needs its account producer");
    assert.equal(all(account, node => node.getAttribute("class") === "account-name")[0]?.textContent, name || user.email);
    assert.ok(account.textContent.includes(user.email));
    const forms = all(account, node => node.localName === "form");
    assert.equal(forms.length, 1);
    assert.equal(forms[0].getAttribute("method"), "post");
    assert.equal(forms[0].getAttribute("action"), "/auth/logout");
    assert.equal(buttonNamed(account, "로그아웃")[0]?.type, "submit");
  });
}

for (const state of ["loading", "failed", "none"]) {
  test(`${state} source guidance precedes the first asset widget`, async t => {
    // Given
    const held = Promise.withResolvers();
    t.mock.method(globalThis, "fetch", async url => url === routes.profiles ?
      state === "loading" ? held.promise : state === "failed" ?
        Response.json({ error: "dashboard_unavailable" }, { status: 503 }) : Response.json(response([])) :
      url === "/api/skills" ? Response.json({ revision: 1, skills: [] }) :
      url === "/api/mcp/connections" ? Response.json({ resource: "https://skillar.sh/mcp", connections: [] }) :
      Response.json({ devices: [] }));
    const { dom, container } = await mount(t, SignedIn, common);
    // When
    await waitFor(dom, () => home(container)?.getAttribute("data-state") === state, `${state} guidance`);
    // Then
    const panels = all(container, node => node.localName === "section" &&
      ["dash-empty", "home-widgets"].includes(node.getAttribute("class")?.split(" ")[0]));
    assert.deepEqual(panels.map(node => node.getAttribute("class").split(" ")[0]), ["dash-empty", "home-widgets"]);
  });
}

for (const receivedAtMs of [null, profile.receivedAtMs]) {
  test(`metadata-only sources keep the first viewable record pending after receipt ${receivedAtMs}`, async t => {
    // Given
    const consent = { mode: "metadata", version: 1, grantedAtMs: 1,
      scope: { deviceId: profile.deviceId, projectIds: ["project"], rootIds: [] },
      retention: { contentDays: 30, projectionDays: 30, backupDays: 30 } };
    t.mock.method(globalThis, "fetch", async url => url === routes.profiles ?
      Response.json(response([{ ...profile, receivedAtMs, availability: "metadata-only" }])) :
      url === routes.consent(profile.deviceId) ? Response.json({ version: 1, consent }) :
        Response.json({ devices: [{ deviceId: profile.deviceId, createdAt: 1, revokedAt: null }] }));
    const { dom, container } = await mount(t, SignedIn, common);
    // When
    await waitFor(dom, () => home(container)?.getAttribute("data-state") === "none" &&
      all(container, node => node.localName === "ol")[0]?.children[0]?.getAttribute("data-state") === "done", "metadata-only checklist");
    // Then
    const steps = all(container, node => node.localName === "ol")[0].children;
    assert.deepEqual([...steps].map(step => step.getAttribute("data-state")), ["done", "done", "pending"]);
    assert.equal(picker(container), undefined);
    assert.equal(all(container, node => node.getAttribute("data-availability") === "metadata-only").length, 1);
    assert.ok(buttonNamed(container, "첫 세션 확인")[0]);
  });
}

test("selected-source refresh failure exposes retry and stale facts without losing close focus", async t => {
  // Given
  let status = 200;
  t.mock.method(globalThis, "fetch", async url => url === routes.profiles ?
    status === 200 ? Response.json(response([profile])) :
      Response.json({ error: "dashboard_unavailable" }, { status }) : Response.json({ devices: [] }));
  const props = { ...common, selected: profile };
  const view = await mount(t, SignedIn, { ...props, onClose: () => view.show({ ...props, selected: null }) });
  const { dom, container } = view;
  await waitFor(dom, () => picker(container), "source read");
  status = 503;
  // When
  await act(() => buttonNamed(container, "출처 다시 읽기")[0].click());
  await waitFor(dom, () => buttonNamed(container, "다시 시도")[0], "visible refresh recovery");
  // Then
  assert.equal(home(container)?.getAttribute("data-state"), "failed");
  assert.equal(all(container, node => node.id === "dash-empty-title" || node === picker(container))[0], home(container));
  assert.ok(all(container, node => node.getAttribute("data-stale") === "true")[0]);
  assert.ok(all(container, node => node.getAttribute("class") === "account-status snapshot__facts")[0]);
  assert.ok(picker(container));
  await act(() => buttonNamed(container, "기록 닫기")[0].click());
  assert.equal(dom.activeElement, picker(container).children[0]);
  status = 200;
  await act(() => buttonNamed(container, "다시 시도")[0].click());
  await waitFor(dom, () => home(container)?.getAttribute("data-state") === "choose", "retry recovered");
  assert.equal(all(container, node => node.getAttribute("data-stale") === "true").length, 0);
});

test("explicitly selected data exposes the distinct sessions heading required by C6", async t => {
  // Given
  globalThis.__t10Cloud = () => ({ mode: "cloud", dispose() {}, refresh() {} });
  t.mock.method(globalThis, "fetch", async url => url === routes.session ? Response.json({ user }) :
    url === routes.profiles ? Response.json(response([profile])) : Response.json({ devices: [] }));
  const { dom, container } = await mount(t, Dashboard, { signal });
  await waitFor(dom, () => buttonNamed(container, "기록 보기")[0], "source");
  assert.equal(all(container, node => node.id === "dash-data-title").length, 0);
  // When
  await act(() => buttonNamed(container, "기록 보기")[0].click());
  // Then
  assert.equal(all(container, node => node.localName === "h2" && node.id === "dash-data-title")[0]?.textContent, "세션");
});

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

for (const [devices, expectedAction] of [
  [readyDevices([]), "기기 연결 안내"],
  [readyDevices([localDevice]), "업로드 범위 확인"],
  [readyDevices([{ ...localDevice, consent: { mode: "metadata" } }]), "첫 세션 확인"],
  [{ status: "loading", data: null, message: "", technical: "" }, "상태 다시 확인"],
  [{ status: "failed", data: [localDevice], message: "조회 실패", technical: "" }, "다시 시도"],
]) {
  test(`setup strip offers one next action for ${devices.status} ${expectedAction}`, async t => {
    // Given
    let managed = 0, retried = 0;
    const { container } = await mount(t, HomeChecklist, {
      state: "none", message: "", technical: "", profiles: [], devices,
      onRetry() { retried++; }, onManage() { managed++; },
    });
    const actions = all(container, node => node.localName === "a" || node.localName === "button");
    // When
    await act(() => actions[0].click());
    // Then
    assert.equal(actions.length, 1);
    assert.equal(actions[0].textContent, expectedAction);
    assert.equal(managed, expectedAction === "기기 연결 안내" || expectedAction === "업로드 범위 확인" ? 1 : 0);
    assert.equal(retried, 1 - managed);
  });
}

test("revoked notices deduplicate devices and keep raw IDs inside one closed disclosure", async t => {
  // Given
  const revoked = { ...localDevice, revokedAt: 2 };
  const { container } = await mount(t, HomeChecklist, {
    state: "none", message: "", technical: "",
    profiles: [{ ...profile, availability: "revoked" }, { ...profile, sourceDomain: "second", availability: "revoked" }],
    devices: readyDevices([revoked]), onRetry() {}, onManage() {},
  });
  // When
  const disclosures = all(container, node => node.localName === "details");
  const ids = all(container, node => node.localName === "code");
  // Then
  assert.equal(disclosures.length, 1);
  assert.equal(disclosures[0].hasAttribute("open"), false);
  assert.equal(disclosures[0].children[0].textContent, "해제된 기기 1개");
  assert.equal(ids.length, 1);
  assert.equal(ids[0].textContent, profile.deviceId);
  assert.equal(disclosures[0].contains(ids[0]), true);
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
