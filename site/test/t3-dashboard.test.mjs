import assert from "node:assert/strict";
import test from "node:test";
import { act, all, buttonNamed, loadViews, mount, waitFor } from "./helpers/t10-dom.mjs";
import { DashboardRequestError, describeFailure, readSession, routes } from "../src/dashboard/api.ts";

const { Dashboard, SignedIn, HomeChecklist } = await loadViews(`
  export * from "./site/src/dashboard/app.tsx";
  export * from "./site/src/dashboard/home-checklist.tsx";
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

for (const state of ["loading", "failed"]) {
  test(`${state} source guidance is the only panel before a source choice`, async t => {
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
    assert.deepEqual(panels.map(node => node.getAttribute("class").split(" ")[0]), ["dash-empty"]);
  });
}

test("no viewable source shows the empty skills view, not the removed onboarding block", async t => {
  // Given
  t.mock.method(globalThis, "fetch", async url => url === routes.profiles ?
    Response.json(response([])) : Response.json({ devices: [] }));
  const { dom, container } = await mount(t, SignedIn, common);
  // When: the empty skills view appears (owner ts 1795051070.800359: onboarding block removed)
  await waitFor(dom, () => all(container, node => node.getAttribute("data-analysis-dashboard") !== null)[0], "empty skills view");
  // Then: KPIs are unmeasured, never 0, and the table area says data is absent
  const tiles = all(container, node => node.getAttribute("class") === "lf-metric__value");
  assert.deepEqual(tiles.map(tile => tile.textContent), ["미측정", "미측정", "미측정"]);
  assert.deepEqual(tiles.map(tile => tile.getAttribute("data-measured")), ["false", "false", "false"]);
  assert.ok(container.textContent.includes("데이터 없음"));
  // And: no onboarding remnants (steps card, upload-scope button, revoked disclosure, guidance heading)
  assert.equal(home(container), undefined);
  assert.equal(all(container, node => node.textContent.includes("해제된 기기")).length, 0);
  assert.equal(buttonNamed(container, "업로드 범위 확인").length, 0);
  assert.equal(picker(container), undefined);
});

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
    // When: metadata-only sources are not viewable, so the empty skills view shows instead of the old checklist
    await waitFor(dom, () => all(container, node => node.getAttribute("data-analysis-dashboard") !== null)[0], "empty skills view");
    // Then
    assert.equal(picker(container), undefined);
    assert.equal(home(container), undefined);
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

test("explicitly selected data mounts the embedded local views inside the snapshot panel", async t => {
  // Given
  globalThis.__t10Cloud = () => ({ mode: "cloud", dispose() {}, refresh() {} });
  t.mock.method(globalThis, "fetch", async url => url === routes.session ? Response.json({ user }) :
    url === routes.profiles ? Response.json(response([profile])) : Response.json({ devices: [] }));
  const { dom, container } = await mount(t, Dashboard, { signal });
  await waitFor(dom, () => buttonNamed(container, "기록 보기")[0], "source");
  assert.equal(all(container, node => node.id === "snapshot-title").length, 0);
  // When
  await act(() => buttonNamed(container, "기록 보기")[0].click());
  // Then: the snapshot panel appears; the embedded local app labels its own views (세션/스킬)
  assert.ok(all(container, node => node.localName === "h2" && node.id === "snapshot-title")[0]);
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

test("successful empty or unavailable sources show the empty skills view instead of a picker", async t => {
  // Given
  t.mock.method(globalThis, "fetch", async url => url === routes.profiles ?
    Response.json(response([{ ...profile, availability: "metadata-only" }])) : Response.json({ devices: [] }));
  const { dom, container } = await mount(t, SignedIn, common);
  // When
  await waitFor(dom, () => all(container, node => node.getAttribute("data-analysis-dashboard") !== null)[0], "empty skills view");
  // Then
  assert.equal(picker(container), undefined);
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
