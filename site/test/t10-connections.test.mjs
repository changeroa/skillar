import assert from "node:assert/strict";
import test from "node:test";
import { createPat, classifyFailure, initialModel, update } from "../src/mcp-connections.ts";
import { act, all, byTag, buttonNamed, loadViews, mount, submit, waitFor } from "./helpers/t10-dom.mjs";

const { DevicesSection, ConsentForm, CommandsDisclosure } = await loadViews(`
  export { DevicesSection } from "./site/src/dashboard/devices.tsx";
  export { ConsentForm } from "./site/src/dashboard/consent-form.tsx";
  export { CommandsDisclosure } from "./site/src/dashboard/commands-panel.tsx";
`);
const signal = new AbortController().signal;
const common = { signal, onChanged() {}, onUnauthorized() {} };
const profile = { deviceId: "device-test", sourceDomain: "source-test", journalThrough: 4 };

test("CV-037 rejects create while an undismissed token exists", () => {
  // Given
  const shown = { ...initialModel, phase: "ready", token: "one-time-secret" };
  // When
  const next = update(shown, { type: "create" });
  // Then
  assert.equal(next.creating, false);
  assert.equal(next.token, shown.token);
});

test("CV-038 distinguishes an unconfirmed successful mutation from a refused request", async t => {
  // Given
  t.mock.method(globalThis, "fetch", async () => Response.json({ malformed: true }));
  // When
  const error = await createPat({ name: "test", expiresInDays: 7, recordActivity: false }).catch(error => error);
  // Then
  assert.equal(classifyFailure(error), "unconfirmed");
});

test("CV-039 ignores draft edits while token creation is pending", () => {
  // Given
  const pending = { ...initialModel, creating: true, draft: { name: "sent", expiresInDays: "7", recordActivity: true } };
  // When
  const next = update(pending, { type: "draft", draft: { ...pending.draft, name: "lost edit" } });
  // Then
  assert.deepEqual(next.draft, pending.draft);
});

test("CV-041 keeps the approval file when dismissal confirmation is cancelled", async t => {
  // Given
  t.mock.method(globalThis, "fetch", async () => Response.json({ grant: "g".repeat(43), deviceId: "device-test", expiresAt: 1800000600 }));
  const confirmations = [];
  globalThis.confirm ??= () => false;
  t.mock.method(globalThis, "confirm", text => { confirmations.push(text); return false; });
  const { dom, container } = await mount(t, DevicesSection, {
    ...common, devices: [], ingestEnabled: true, origin: "https://skillar.sh", settled: true, message: "",
  });
  await act(() => buttonNamed(container, "기기 연결")[0].click());
  await waitFor(dom, () => buttonNamed(container, "완료")[0], "approval file");
  // When
  await act(() => buttonNamed(container, "완료")[0].click());
  // Then
  assert.equal(confirmations.length, 1);
  assert.ok(buttonNamed(container, "완료")[0]);
});

test("CV-043 locks consent controls while the submitted snapshot is pending", async t => {
  // Given
  const held = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", () => held.promise);
  const { container } = await mount(t, ConsentForm, {
    deviceId: "device-test", version: 1, consent: { mode: "local-only" }, signal, onSaved() {}, onUnauthorized() {},
  });
  // When
  await submit(byTag(container, "form")[0]);
  // Then
  assert.ok(byTag(container, "input").every(node => node.disabled || all(container, parent =>
    parent.localName === "fieldset" && (parent.disabled || parent.hasAttribute("disabled")) && parent.contains(node)).length > 0));
  held.resolve(Response.json({ version: 2, consent: { mode: "local-only" } }));
});

test("CV-045 repeated initial submission sends one command and retry keeps its identity", async t => {
  // Given
  const held = Promise.withResolvers();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return held.promise;
  });
  const { dom, container } = await mount(t, CommandsDisclosure, {
    profile, sourcesBusy: false, sourcesLoad: 1, signal, onRefreshSources() {}, onUnauthorized() {},
  });
  const form = byTag(container, "form")[0];
  const select = byTag(container, "select")[0];
  const { FakeEvent } = await import("./helpers/fake-dom.mjs");
  await act(() => { select.value = "flow.end"; select.dispatchEvent(new FakeEvent("change")); });
  const field = byTag(form, "input")[0];
  await act(() => { field.value = "flow-test"; field.dispatchEvent(new FakeEvent("input")); });
  // When
  await act(() => { form.dispatchEvent(new FakeEvent("submit")); form.dispatchEvent(new FakeEvent("submit")); });
  // Then
  assert.equal(calls.length, 1);
  assert.equal(buttonNamed(container, "명령 대기열에 넣기")[0].disabled, true);
  held.reject(new TypeError("offline"));
  await waitFor(dom, () => buttonNamed(container, "같은 ID로 다시 시도")[0], "retry command");
  await act(() => buttonNamed(container, "같은 ID로 다시 시도")[0].click());
  assert.equal(calls.length, 2);
  assert.equal(calls[1].commandId, calls[0].commandId);
});
