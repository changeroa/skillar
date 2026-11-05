import assert from "node:assert/strict";
import test from "node:test";
import { useState } from "preact/hooks";
import { createPrivateSkillPackage } from "../../shared/dist/private-skill-package.js";
import { routes } from "../src/skills/api.ts";
import { DraftEditor } from "../src/skills/editor.ts";
import { PublishPanel } from "../src/skills/publish.ts";
import { SkillPanel } from "../src/skills/skill.ts";
import { emptyDraft } from "../src/skills/model.ts";
import { act, all, byTag, buttonNamed, h, input, mount, render, submit, waitFor } from "./helpers/t10-dom.mjs";

const skillId = "11223344-1122-4122-8122-112233445566";
const document = "---\nname: fixture\ndescription: fixture\n---\noriginal";
const bytes = text => new TextEncoder().encode(text);
const pkg = await createPrivateSkillPackage([{ path: "SKILL.md", mediaType: "text/markdown", bytes: bytes(document) }]);
const head = { digest: pkg.manifestDigest, revision: 1 };
const detail = { skill: { skillId, name: "fixture", description: "fixture", head, updatedAt: 1800000000000 },
  versions: [{ digest: head.digest, createdAt: 1800000000000, pinned: false }] };
const exported = { skillId, version: detail.versions[0], package: pkg };
const signal = new AbortController().signal;

async function skill(t, overrides = {}) {
  t.mock.method(globalThis, "fetch", async url => {
    if (overrides.fetch) return overrides.fetch(url);
    return Response.json(url === routes.skill(skillId) ? detail : exported);
  });
  return mount(t, SkillPanel, {
    skillId, summary: null, signal, focusHeading: 0, onChanged() {}, onDeleted() {}, onBack() {}, onUnauthorized() {},
    ...overrides,
  });
}

function Editor({ busy = false }) {
  const [draft, setDraft] = useState(() => ({ ...emptyDraft(skillId), document }));
  return h(DraftEditor, { draft, idPrefix: "test", busy, notes: [], onChange: next => setDraft(next) });
}

function pick(node, file) {
  node.files = [file];
  const event = { type: "change", currentTarget: node, target: node };
  return node.listeners.find(entry => entry.type === "change").listener.call(node, event);
}
function file(name, buffer) {
  return { name, webkitRelativePath: "", size: 1, type: "text/plain", arrayBuffer: () => buffer };
}

for (const stage of ["detail", "export"]) {
  test(`CV-028 retries initial ${stage} failure`, async t => {
    // Given
    let reads = 0;
    const { dom, container } = await skill(t, { fetch: async url => {
      const target = stage === "detail" ? routes.skill(skillId) : routes.version(skillId, head.digest);
      if (url === target && ++reads === 1) return Response.json({ error: "unavailable" }, { status: 503 });
      return Response.json(url === routes.skill(skillId) ? detail : exported);
    } });
    await waitFor(dom, () => all(container, node => node.getAttribute("role") === "status" && node.textContent.includes("실패")).length > 0 ||
      container.textContent.includes("다시"), "read failure");
    // When
    const retry = buttonNamed(container, "다시 시도")[0];
    assert.ok(retry);
    await act(() => retry.click());
    await waitFor(dom, () => byTag(container, "textarea")[0], "recovered editor");
    // Then
    assert.equal(reads, 2);
  });
}

test("CV-029 cancelling in-app navigation retains dirty skill content", async t => {
  // Given
  let left = 0;
  const confirms = [];
  globalThis.confirm ??= () => false;
  t.mock.method(globalThis, "confirm", message => { confirms.push(message); return false; });
  const { dom, container } = await skill(t, { onBack: () => left++ });
  await waitFor(dom, () => byTag(container, "textarea")[0], "editor");
  await input(byTag(container, "textarea")[0], document + "\nunsaved");
  // When
  await act(() => buttonNamed(container, "보관함으로 돌아가기")[0].click());
  // Then
  assert.equal(left, 0);
  assert.equal(confirms.length, 1);
  assert.equal(byTag(container, "textarea")[0].value, document + "\nunsaved");
});

test("CV-029 beforeunload protection follows dirty state and is removed on unmount", async t => {
  // Given
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const { dom, container } = await skill(t);
  await waitFor(dom, () => byTag(container, "textarea")[0], "editor");
  await input(byTag(container, "textarea")[0], document + "\nunsaved");
  const leaving = new Event("beforeunload", { cancelable: true });
  // When
  window.dispatchEvent(leaving);
  // Then
  assert.equal(leaving.defaultPrevented, true);
  await act(() => render(null, container));
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false);
});

test("CV-030 undo restores the unpublished document after file replacement", async t => {
  // Given
  const { container } = await mount(t, Editor, {});
  const node = byTag(container, "input").find(node => node.type === "file");
  // When
  await act(async () => { await pick(node, file("SKILL.md", Promise.resolve(bytes("replacement").buffer))); });
  const undo = buttonNamed(container, "되돌리기")[0];
  assert.ok(undo);
  await act(() => undo.click());
  // Then
  assert.equal(byTag(container, "textarea")[0].value, document);
});

test("CV-031 package generation locks publishing before any asynchronous digest completes", async t => {
  // Given
  const held = Promise.withResolvers();
  const original = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", async (...args) => { await held.promise; return original(...args); });
  const { container } = await mount(t, PublishPanel, { signal, onPublished() {}, onOpen() {}, onUnauthorized() {} });
  await input(byTag(container, "textarea")[0], document);
  const checkbox = byTag(container, "input").find(node => node.type === "checkbox");
  const { FakeEvent } = await import("./helpers/fake-dom.mjs");
  await act(() => { checkbox.checked = true; checkbox.dispatchEvent(new FakeEvent("change")); });
  // When
  await submit(byTag(container, "form")[0]);
  // Then
  assert.equal(buttonNamed(container, "스킬 게시")[0].disabled, true);
  assert.equal(byTag(container, "textarea")[0].disabled, true);
  held.resolve();
});

test("CV-032 out-of-order file reads discard stale generations and merge into the latest draft", async t => {
  // Given
  const first = Promise.withResolvers(), second = Promise.withResolvers();
  const { container } = await mount(t, Editor, {});
  const node = byTag(container, "input").find(node => node.type === "file");
  let firstRead, secondRead;
  await act(() => {
    firstRead = pick(node, file("old.txt", first.promise));
    secondRead = pick(node, file("new.txt", second.promise));
  });
  await input(byTag(container, "textarea")[0], document + "\nlatest");
  // When
  await act(async () => { second.resolve(bytes("new").buffer); await secondRead; first.resolve(bytes("old").buffer); await firstRead; });
  // Then
  assert.equal(byTag(container, "textarea")[0].value, document + "\nlatest");
  assert.equal(container.textContent.includes("old.txt"), false);
  assert.equal(container.textContent.includes("new.txt"), true);
});

test("CV-032 read failure keeps the draft and permits reselecting the same file", async t => {
  // Given
  const { container } = await mount(t, Editor, {});
  const node = byTag(container, "input").find(node => node.type === "file");
  node.value = "same-file";
  // When
  await act(async () => { await pick(node, file("notes.txt", Promise.reject(new DOMException("unreadable", "NotReadableError")))); });
  // Then
  assert.equal(byTag(container, "textarea")[0].value, document);
  assert.equal(node.value, "");
  assert.equal(all(container, node => node.getAttribute("role") === "alert").length, 1);
});

for (const completesWhileBusy of [false, true]) {
  test(`CV-032 pending selection survives unrelated busy action when read completes ${completesWhileBusy ? "during" : "after"} it`, async t => {
    // Given
    const held = Promise.withResolvers();
    const { container, show } = await mount(t, Editor, { busy: false });
    const node = byTag(container, "input").find(node => node.type === "file");
    let reading;
    await act(() => { reading = pick(node, file("pending-notes.txt", held.promise)); });
    // When
    await show({ busy: true });
    if (completesWhileBusy) {
      await act(async () => { held.resolve(bytes("notes").buffer); await reading; });
      assert.equal(container.textContent.includes("pending-notes.txt"), false);
    }
    await show({ busy: false });
    if (!completesWhileBusy) await act(async () => { held.resolve(bytes("notes").buffer); await reading; });
    // Then
    assert.equal(container.textContent.includes("pending-notes.txt"), true);
    assert.equal(byTag(container, "textarea")[0].value, document);
  });
}

test("CV-032 concurrent folder and file fields both retain their selected files", async t => {
  // Given
  const folder = Promise.withResolvers(), single = Promise.withResolvers();
  const { container } = await mount(t, Editor, {});
  const nodes = byTag(container, "input").filter(node => node.type === "file");
  let folderRead, singleRead;
  await act(() => {
    folderRead = pick(nodes[0], file("folder-notes.txt", folder.promise));
    singleRead = pick(nodes[1], file("single-notes.txt", single.promise));
  });
  // When
  await act(async () => { single.resolve(bytes("single").buffer); await singleRead; folder.resolve(bytes("folder").buffer); await folderRead; });
  // Then
  assert.equal(container.textContent.includes("folder-notes.txt"), true);
  assert.equal(container.textContent.includes("single-notes.txt"), true);
});
