import assert from "node:assert/strict";
import test from "node:test";
import { act, all, buttonNamed, byTag, FakeEvent, h, loadViews, mount, waitFor } from "./helpers/t10-dom.mjs";
import { installFakeDom } from "./helpers/fake-dom.mjs";

const { connectionRows, ConnectionsWorkspace } = await loadViews('export { connectionRows, ConnectionsWorkspace } from "./site/src/connections-workspace.ts";');
const now = 1793870000;
const mcp = { connectionId: "test", name: "test", kind: "pat", createdAt: now - 10, expiresAt: now + 10,
  revokedAt: null, scopes: ["skills:read"], recordActivity: false };
const device = { deviceId: "test", createdAt: now - 20, revokedAt: null, version: 1, consent: { mode: "local-only" } };

test("device and MCP identifiers cannot collide in a combined connection table", () => {
  // Given
  const model = { connections: [mcp] };
  // When
  const rows = connectionRows(model, [device], now);
  // Then
  assert.equal(new Set(rows.map(row => row.id)).size, 2);
  assert.equal(rows[0].device, device);
  assert.equal(rows[1].mcp, mcp);
});

test("combined connection status uses expiry and revocation without inventing online state", () => {
  // Given
  const connections = [mcp, { ...mcp, connectionId: "expired", expiresAt: now },
    { ...mcp, connectionId: "revoked", revokedAt: now - 1 }];
  // When
  const rows = connectionRows({ connections }, [{ ...device, revokedAt: now - 1 }], now);
  // Then
  assert.equal(rows[0].status, rows[3].status);
  assert.notEqual(rows[1].status, rows[2].status);
  assert.notEqual(rows[2].status, rows[3].status);
  assert.equal(rows[2].created, mcp.createdAt);
});

test("switching devices clears the previous consent draft and revoke confirmation", async t => {
  // Given: both devices have the same consent version, so version alone cannot isolate their drafts.
  const devices = ["device-a", "device-b"].map(deviceId => ({
    deviceId, createdAt: device.createdAt, revokedAt: null, consentVersion: 1, consent: device.consent,
  }));
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push({ path, method: init.method });
    return Response.json({ schemaVersion: 1, devices, profiles: [], ingestEnabled: true });
  });
  const previous = Object.fromEntries(["window", "location", "history", "CSS", "HTMLElement"]
    .map(key => [key, globalThis[key]]));
  const win = new EventTarget();
  win.location = new URL("https://skillar.sh/connections/");
  win.history = { pushState: (_state, _title, href) => { globalThis.location = win.location = new URL(href); } };
  win.matchMedia = () => Object.assign(new EventTarget(), { matches: false });
  const prototype = Object.getPrototypeOf(installFakeDom().body);
  prototype.close = function () { this.open = false; };
  prototype.show = function () { this.open = true; };
  Object.assign(globalThis, { window: win, location: win.location, history: win.history,
    CSS: { escape: value => value }, HTMLElement: prototype.constructor });
  function Fixture(props) {
    document.querySelector = selector => all(document.body, node =>
      selector === `.connection-row[data-id="${node.getAttribute("data-id")}"]`)[0] ?? null;
    return h(ConnectionsWorkspace, props);
  }
  const { dom, container } = await mount(t, Fixture, {
    model: { connections: [] }, operationMessage: "", onUnauthorized: () => assert.fail("unexpected unauthorized response"),
  });
  t.after(() => {
    Object.assign(globalThis, previous);
    delete prototype.close;
    delete prototype.show;
  });
  const row = id => all(container, node => node.getAttribute("data-id") === `device:${id}` && node.localName === "button")[0];
  await waitFor(dom, () => row("device-b"), "both device rows");
  await act(() => row("device-a").click());
  const consent = all(container, node => node.getAttribute("class") === "device__consent")[0];
  consent.open = true;
  await act(() => byTag(consent, "input").find(field => field.value === "managed-content")
    .dispatchEvent(new FakeEvent("change")));
  const processing = byTag(consent, "input").filter(field => field.type === "checkbox").at(-1);
  await act(() => { processing.checked = true; processing.dispatchEvent(new FakeEvent("change")); });
  await act(() => buttonNamed(container, "기기 연결 해제…")[0].click());
  assert.equal(buttonNamed(container, "연결 해제 확인").length, 1);
  assert.equal(processing.checked, true);
  // When: select B directly while A's draft and destructive confirmation are still open.
  await act(() => row("device-b").click());
  // Then: B starts with only its own stored consent and requires a fresh disconnect request.
  assert.equal(all(container, node => node.id === "connection-peek-title")[0].textContent, "device-b");
  const nextConsent = all(container, node => node.getAttribute("class") === "device__consent")[0];
  assert.deepEqual({
    modes: byTag(nextConsent, "input").filter(field => field.type === "radio" && field.checked).map(field => field.value),
    confirming: buttonNamed(container, "연결 해제 확인").length,
    revoke: buttonNamed(container, "기기 연결 해제…").length,
    consentOpen: Boolean(nextConsent.open),
    contentChoices: byTag(nextConsent, "input").filter(field => field.type === "checkbox" && field.checked).length,
  }, { modes: ["local-only"], confirming: 0, revoke: 1, consentOpen: false, contentChoices: 0 });
  assert.deepEqual(calls, [{ path: "/api/dashboard/profiles", method: "GET" }]);
});

async function workspaceFixture(t, { query = "", response, phase = "ready" } = {}) {
  const previous = Object.fromEntries(["window", "location", "history"].map(key => [key, globalThis[key]]));
  const win = new EventTarget();
  win.location = new URL(`https://skillar.sh/connections/${query}`);
  const navigate = (_state, _title, href) => { globalThis.location = win.location = new URL(href); };
  win.history = { replaceState: navigate, pushState: navigate };
  win.matchMedia = () => Object.assign(new EventTarget(), { matches: false });
  Object.assign(globalThis, { window: win, location: win.location, history: win.history });
  const connections = [
    { ...mcp, connectionId: "active", expiresAt: 4102444800 },
    { ...mcp, connectionId: "revoked", revokedAt: now, expiresAt: 4102444800 },
    { ...mcp, connectionId: "expired", expiresAt: 1 },
  ];
  t.mock.method(globalThis, "fetch", () => response ?? Promise.resolve(Response.json({
    schemaVersion: 1, ingestEnabled: true, profiles: [],
    devices: [{ deviceId: device.deviceId, createdAt: device.createdAt, revokedAt: null,
      consent: device.consent, consentVersion: 1 }],
  })));
  const props = { model: { phase, connections }, operationMessage: "",
    onUnauthorized: () => assert.fail("unexpected unauthorized response") };
  const mounted = await mount(t, ConnectionsWorkspace, props);
  t.after(() => Object.assign(globalThis, previous));
  return { ...mounted, win, props,
    rows: () => byTag(mounted.container, "tbody").flatMap(body => byTag(body, "tr")),
    restore: async url => act(() => {
      navigate(null, "", url);
      win.dispatchEvent(new Event("popstate"));
    }),
  };
}

test("connections default to active rows and the revoked toggle round trips through the URL", async t => {
  // Given
  const fixture = await workspaceFixture(t);
  await waitFor(fixture.dom, () => fixture.rows().length === 2, "active rows");
  assert.deepEqual(fixture.rows().map(row => byTag(row, "button")[0].getAttribute("data-id")), ["active", "device:test"]);
  // When
  await act(() => all(fixture.container, node => node.id === "connections-show-revoked")[0].click());
  const url = fixture.win.location.href;
  await fixture.restore("https://skillar.sh/connections/");
  await fixture.restore(url);
  // Then
  assert.equal(new URL(url).searchParams.get("revoked"), "1");
  assert.equal(fixture.rows().length, 4);
  assert.equal(all(fixture.container, node => node.id === "connections-show-revoked")[0].getAttribute("aria-pressed"), "true");
});

test("explicit cleared and selected status facets survive URL restoration", async t => {
  // Given
  const fixture = await workspaceFixture(t, { query: "?status=all&kind=기기&q=test&sort=name&direction=ascending" });
  await waitFor(fixture.dom, () => fixture.rows().length === 1, "filtered device");
  // When
  await fixture.restore("https://skillar.sh/connections/?revoked=1&status=해제됨&sort=name&direction=ascending");
  // Then
  assert.equal(fixture.rows().length, 1);
  assert.equal(byTag(fixture.rows()[0], "button")[0].getAttribute("data-id"), "revoked");
  assert.equal(byTag(fixture.container, "th")[0].getAttribute("aria-sort"), "ascending");
});

test("connection counts wait for a pending device list", async t => {
  // Given
  const pending = Promise.withResolvers();
  const fixture = await workspaceFixture(t, { response: pending.promise });
  assert.equal(byTag(fixture.container, "caption").length, 0);
  assert.equal(fixture.rows().length, 0);
  // When
  await act(() => pending.resolve(Response.json({
    schemaVersion: 1, ingestEnabled: true, profiles: [],
    devices: [{ deviceId: device.deviceId, createdAt: device.createdAt, revokedAt: null,
      consent: device.consent, consentVersion: 1 }],
  })));
  await waitFor(fixture.dom, () => fixture.rows().length === 2, "settled combined rows");
  // Then
  assert.equal(byTag(fixture.container, "caption").length, 1);
  assert.equal(fixture.rows().length, 2);
});

test("connection counts remain hidden while the MCP list reloads", async t => {
  // Given
  const fixture = await workspaceFixture(t, { phase: "loading" });
  assert.equal(byTag(fixture.container, "caption").length, 0);
  // When
  await fixture.show({ ...fixture.props, model: { ...fixture.props.model, phase: "ready" } });
  await waitFor(fixture.dom, () => fixture.rows().length === 2, "both settled lists");
  // Then
  assert.equal(byTag(fixture.container, "caption").length, 1);
});
