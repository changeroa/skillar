import assert from "node:assert/strict";
import test from "node:test";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { createPrivateSkillPackage } from "../../shared/dist/private-skill-package.js";
import { routes } from "../src/skills/api.ts";
import { loadViews } from "./helpers/t10-dom.mjs";
import { all, buttonNamed, byTag, classed, FakeEvent, installFakeDom, waitFor } from "./helpers/fake-dom.mjs";
const { confirmationText, confirmsDeletion, SkillPanel } =
  await loadViews('export { confirmationText, confirmsDeletion, SkillPanel } from "./site/src/skills/skill.ts";');

const text = new TextEncoder();
const skillId = "11223344-1122-4122-8122-112233445566";
const skillDocument = "---\nname: synthetic\ndescription: A fixture skill\n---\nBody text.\n";
const pkg = await createPrivateSkillPackage([{ path: "SKILL.md", mediaType: "text/markdown", bytes: text.encode(skillDocument) }]);
const head = { digest: pkg.manifestDigest, revision: 2 };
const older = "b".repeat(64);
const detail = {
  skill: { skillId, name: "synthetic", description: "A fixture skill", head, updatedAt: 1_800_000_000_000 },
  versions: [{ digest: head.digest, createdAt: 1_800_000_000_000, pinned: false }, { digest: older, createdAt: 1_700_000_000_000, pinned: false }],
};
const exported = { skillId, version: { digest: head.digest, createdAt: 1_800_000_000_000, pinned: false }, package: pkg };
const skillField = "confirm-delete-skill";
const olderField = `confirm-delete-${older.slice(0, 16)}`;
const olderTrigger = `version-delete-${older.slice(0, 16)}`;

/** Serves the fixture skill over the P10 routes; `onDelete` lets a test hold the skill DELETE in flight. */
function fakeApi(t, onDelete = () => ({ deleted: true })) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const method = init.method ?? "GET";
    const call = { method, url, body: init.body === undefined ? null : JSON.parse(init.body) };
    calls.push(call);
    const json = payload => ({ ok: true, status: 200, json: async () => payload });
    if (method === "GET" && url === routes.skill(skillId)) return json(detail);
    if (method === "GET" && url === routes.version(skillId, head.digest)) return json(exported);
    if (method === "DELETE" && url === routes.skill(skillId)) return json(await onDelete(call));
    if (method === "DELETE" && url === routes.version(skillId, older)) return json({ ...detail, versions: detail.versions.slice(0, 1) });
    throw new Error(`Unexpected request ${method} ${url}`);
  });
  return { calls, deletes: () => calls.filter(call => call.method === "DELETE").map(({ method, url, body }) => ({ method, url, body })) };
}

async function mountPanel(t, onDelete) {
  const dom = installFakeDom();
  const api = fakeApi(t, onDelete);
  const container = dom.createElement("div");
  dom.body.appendChild(container);
  const deleted = Promise.withResolvers();
  const changed = Promise.withResolvers();
  const events = { deleted: [] };
  const props = {
    skillId, summary: null, signal: new AbortController().signal, focusHeading: 0,
    onChanged: () => changed.resolve(), onDeleted: name => { events.deleted.push(name); deleted.resolve(name); }, onBack: () => {}, onUnauthorized: () => {},
  };
  await act(() => { render(h(SkillPanel, props), container); });
  await waitFor(dom, () => buttonNamed(container, "새 버전 게시")[0], "the skill panel to finish loading");
  t.after(() => render(null, container));
  return { dom, api, container, events, deleted: deleted.promise, changed: changed.promise };
}

async function type(field, value) {
  await act(() => {
    field.value = value;
    field.dispatchEvent(new FakeEvent("input"));
  });
}

test("a delete trigger opens a typed confirmation whose Confirm delete stays disabled, so repeated clicks never issue DELETE", async t => {
  // Given
  const { dom, api, container, events } = await mountPanel(t);
  const section = classed(container, "skill__danger")[0];
  // When: the first click opens the confirmation
  await act(() => dom.getElementById("skill-delete").click());
  // Then: focus is in the field, which is also the first control where the trigger used to be, and Confirm delete is disabled
  const field = dom.getElementById(skillField);
  assert.ok(field);
  assert.equal(dom.activeElement, field);
  assert.equal(all(section, node => node.localName === "button" || node.localName === "input")[0], field);
  assert.equal(buttonNamed(section, "삭제 확인")[0].disabled, true);
  // When: a pointer mashes every button in the section, round after round, without typing anything
  for (let round = 0; round < 6; round += 1) {
    for (const button of byTag(section, "button")) await act(() => button.click());
  }
  // Then
  assert.deepEqual(api.deletes(), []);
  assert.deepEqual(events.deleted, []);
});

test("typing the skill name arms Confirm delete; one DELETE names this skill at its head and nothing else fires while busy", async t => {
  // Given
  const held = Promise.withResolvers();
  const { dom, api, container, deleted } = await mountPanel(t, () => held.promise);
  const section = classed(container, "skill__danger")[0];
  await act(() => dom.getElementById("skill-delete").click());
  const field = dom.getElementById(skillField);
  const confirm = () => buttonNamed(section, "삭제 확인")[0];
  // When: a near miss, then the exact name with surrounding whitespace
  await type(field, "synthetic!");
  assert.equal(confirm().disabled, true);
  await type(field, " synthetic ");
  assert.equal(confirm().disabled, false);
  await act(() => confirm().click());
  // Then: exactly one DELETE for this skill at its head, and every control is disabled while it is in flight
  assert.deepEqual(api.deletes(), [{ method: "DELETE", url: routes.skill(skillId), body: { base: head } }]);
  assert.equal(field.disabled, true);
  assert.ok(byTag(section, "button").every(button => button.disabled));
  await act(() => { for (const button of byTag(section, "button")) button.click(); });
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "Escape" })));
  assert.equal(api.deletes().length, 1);
  assert.equal(all(section, node => node.getAttribute("role") === "group").length, 1);
  // When: the server answers
  held.resolve({ deleted: true });
  // Then
  assert.equal(await deleted, "synthetic");
});

test("Keep and Escape cancel the confirmation, return focus to the trigger and forget the typed text", async t => {
  // Given
  const { dom, api, container } = await mountPanel(t);
  const section = classed(container, "skill__danger")[0];
  const trigger = () => dom.getElementById("skill-delete");
  await act(() => trigger().click());
  await type(dom.getElementById(skillField), "synth");
  // When: Escape from inside the field
  await act(() => dom.getElementById(skillField).dispatchEvent(new FakeEvent("keydown", { key: "Escape" })));
  // Then
  assert.equal(dom.getElementById(skillField), null);
  assert.equal(dom.activeElement, trigger());
  // When: reopened, the field starts empty; Keep closes it the same way
  await act(() => trigger().click());
  assert.equal(dom.getElementById(skillField).value, "");
  assert.equal(dom.activeElement, dom.getElementById(skillField));
  await act(() => buttonNamed(section, "스킬 유지")[0].click());
  assert.equal(dom.getElementById(skillField), null);
  assert.equal(dom.activeElement, trigger());
  assert.deepEqual(api.deletes(), []);
});

test("Enter inside the confirmation field never deletes, and the field sits outside every form", async t => {
  // Given
  const { dom, api, container, events } = await mountPanel(t);
  const section = classed(container, "skill__danger")[0];
  await act(() => dom.getElementById("skill-delete").click());
  const field = dom.getElementById(skillField);
  await type(field, "synthetic");
  assert.equal(buttonNamed(section, "삭제 확인")[0].disabled, false);
  // When
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "Enter" })));
  // Then
  assert.deepEqual(api.deletes(), []);
  assert.deepEqual(events.deleted, []);
  assert.equal(byTag(container, "form").some(form => form.contains(field)), false);
});

test("a version confirmation arms only for that version's digest prefix and deletes exactly that version at the current head", async t => {
  // Given
  const { dom, api, container, changed } = await mountPanel(t);
  const rows = () => classed(container, "version");
  const [current, old] = rows();
  assert.equal(rows().length, 2);
  assert.equal(byTag(current, "button").some(button => button.id.startsWith("version-delete-")), false);
  // When
  await act(() => dom.getElementById(olderTrigger).click());
  const field = dom.getElementById(olderField);
  const confirm = () => buttonNamed(old, "삭제 확인")[0];
  // Then: focus is in the field; the current version's prefix does not arm this row, its own prefix does in any case
  assert.equal(dom.activeElement, field);
  await type(field, head.digest.slice(0, 8));
  assert.equal(confirm().disabled, true);
  await type(field, older.slice(0, 8).toUpperCase());
  assert.equal(confirm().disabled, false);
  // When
  await act(() => confirm().click());
  // Then
  assert.deepEqual(api.deletes(), [{ method: "DELETE", url: routes.version(skillId, older), body: { base: head } }]);
  await changed;
  await waitFor(dom, () => rows().length === 1, "the deleted version to leave the list");
  assert.equal(dom.activeElement, dom.getElementById("versions-title"));
});

test("opening one confirmation closes another, so at most one deletion is ever armed", async t => {
  // Given
  const { dom, container } = await mountPanel(t);
  await act(() => dom.getElementById("skill-delete").click());
  assert.ok(dom.getElementById(skillField));
  // When
  await act(() => dom.getElementById(olderTrigger).click());
  // Then
  assert.equal(all(container, node => node.getAttribute("role") === "group" &&
    node.getAttribute("aria-labelledby")?.endsWith("-consequence")).length, 1);
  assert.equal(dom.getElementById(skillField), null);
  assert.equal(dom.activeElement, dom.getElementById(olderField));
});

test("deletion text is the skill name or the first eight digest characters, matched deliberately", () => {
  const skill = { kind: "skill", name: "synthetic" };
  const version = { kind: "version", digest: "abcdef0123456789".repeat(4) };
  assert.equal(confirmationText(skill), "synthetic");
  assert.equal(confirmationText(version), "abcdef01");
  assert.equal(confirmsDeletion(skill, "synthetic"), true);
  assert.equal(confirmsDeletion(skill, "  synthetic\n"), true);
  assert.equal(confirmsDeletion(skill, "Synthetic"), false);
  assert.equal(confirmsDeletion(skill, "synthetic!"), false);
  assert.equal(confirmsDeletion(skill, ""), false);
  assert.equal(confirmsDeletion({ kind: "skill", name: "안내 문서" }, "안내 문서".normalize("NFD")), true);
  assert.equal(confirmsDeletion({ kind: "skill", name: "" }, ""), false);
  assert.equal(confirmsDeletion(version, "abcdef01"), true);
  assert.equal(confirmsDeletion(version, "ABCDEF01"), true);
  assert.equal(confirmsDeletion(version, "abcdef0"), false);
  assert.equal(confirmsDeletion(version, "abcdef012"), false);
  assert.equal(confirmsDeletion(version, "b".repeat(8)), false);
});
