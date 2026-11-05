import assert from "node:assert/strict";
import test from "node:test";
import { createPrivateSkillPackage } from "../../../shared/dist/private-skill-package.js";
import { classifyFailure, describeFailure, routes, SkillsRequestError, technicalDetail } from "./api.ts";
import { lineDiff } from "./diff.ts";
import { VersionDiff } from "./diff-panel.ts";
import { DraftEditor } from "./editor.ts";
import { LibraryPanel, sortSkills } from "./library.ts";
import { draftIssues, draftProblems, emptyDraft } from "./model.ts";
import { candidateHead, SearchBox } from "./search.ts";
import { publishDraft } from "./skill-publish.ts";
import { SkillsHeading } from "./heading.ts";
import { act, all, byTag, buttonNamed, FakeEvent, input, mount, submit, waitFor } from "../../test/helpers/t10-dom.mjs";

const skillId = "11223344-1122-4122-8122-112233445566";
const otherId = "11223344-1122-4122-8122-112233445567";
const signal = new AbortController().signal;
const document = "---\nname: fixture\ndescription: fixture\n---\noriginal";
const makePackage = text => createPrivateSkillPackage([
  { path: "SKILL.md", mediaType: "text/markdown", bytes: new TextEncoder().encode(text) },
]);
const packages = await Promise.all([makePackage(document), makePackage(document + "\nnew")]);
const versions = packages.map(pkg => ({ digest: pkg.manifestDigest, pinned: false, createdAt: 1800000000000 }));
const summary = { skillId, name: "나", description: "합성", head: { digest: versions[1].digest, revision: 2 }, updatedAt: 2 };
const older = { ...summary, skillId: otherId, name: "가", updatedAt: 1 };
const detail = { skill: summary, versions };
const candidate = { uri: `skillar://private/${skillId}/${versions[0].digest}/SKILL.md`, name: "나", description: "합성", digest: versions[0].digest,
  rank: 1, score: 1, matched: ["합성"], invocation: "automatic" };
const result = { query: "합성", traceId: "fixture", mode: "discovery", elapsedMs: 1, candidates: [candidate] };
const searchProps = { skills: [summary], signal, onOpen() {}, onUnauthorized() {} };
const exported = digest => ({ skillId, version: versions.find(v => v.digest === digest),
  package: packages.find(pkg => pkg.manifestDigest === digest) });

test("sort uses response timestamps by default and names when selected without mutating catalog", () => {
  // Given
  const skills = [older, summary];
  // When
  const recent = sortSkills(skills, "updated");
  const names = sortSkills(skills, "name");
  // Then
  assert.deepEqual(recent.map(s => s.skillId), [skillId, otherId]);
  assert.deepEqual(names.map(s => s.skillId), [otherId, skillId]);
  assert.deepEqual(skills, [older, summary]);
});

test("library places search and sorting before cards and selected detail immediately after its card", async t => {
  // Given
  const { h } = await import("preact");
  const props = { ...searchProps, skills: [summary, older], status: "ready", message: "", notice: "",
    selectedId: skillId, onReload() {}, detail: h("section", { id: "selected-detail" }, "상세") };
  // When
  const { dom, container } = await mount(t, LibraryPanel, props);
  // Then
  const list = all(container, n => n.getAttribute("class") === "source-list skill-list")[0];
  assert.equal(list.childNodes[1].childNodes[0].id, "selected-detail");
  assert.equal(byTag(container, "form")[0].getAttribute("role"), "search");
  assert.equal(byTag(container, "select")[0].value, "updated");
  assert.equal(dom.getElementById("library-title").getAttribute("tabindex"), "-1");
  const selectedDetail = dom.getElementById("selected-detail");
  await input(byTag(container, "select")[0], "name", "change");
  assert.equal(list.childNodes[0].textContent.includes("가"), true);
  assert.equal(dom.getElementById("selected-detail"), selectedDetail);
});

test("candidate digest relationship distinguishes current, different and absent catalog entries", () => {
  // Given / When
  const relationships = [
    candidateHead({ ...candidate, digest: summary.head.digest }, [summary]),
    candidateHead(candidate, [summary]), candidateHead(candidate, []),
  ];
  // Then
  assert.deepEqual(relationships, ["current", "different", "unknown"]);
});

test("catalog arrival moves the selected detail without unmounting its workspace", async t => {
  // Given
  const { h } = await import("preact");
  const props = { ...searchProps, skills: [], status: "loading", message: "", notice: "", selectedId: skillId,
    onReload() {}, detail: h("section", { id: "retained-detail" }, "상세") };
  const { dom, show } = await mount(t, LibraryPanel, props);
  const workspace = dom.getElementById("retained-detail");
  // When
  await show({ ...props, skills: [older, summary], status: "ready" });
  // Then
  assert.equal(dom.getElementById("retained-detail") === workspace, true);
});

test("search arrows announce candidates and Enter opens the active result instead of submitting again", async t => {
  // Given
  let requests = 0;
  const opened = [];
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json(result); });
  const { dom, container } = await mount(t, SearchBox, { ...searchProps, onOpen: id => opened.push(id) });
  await input(byTag(container, "input")[0], "합성");
  await submit(byTag(container, "form")[0]);
  await waitFor(dom, () => byTag(container, "li").length === 1, "search result");
  // When
  const field = byTag(container, "input")[0];
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "ArrowDown" })));
  const active = dom.getElementById(field.getAttribute("aria-activedescendant"));
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "Enter" })));
  // Then
  assert.equal(active.getAttribute("aria-selected"), "true");
  assert.deepEqual(opened, [skillId]);
  assert.equal(requests, 1);
  assert.ok(container.textContent.includes(candidate.digest));
  assert.ok(container.textContent.includes(candidate.uri));
});

test("failed search retries the same draft and clears technical failure after success", async t => {
  // Given
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => ++reads === 1
    ? Response.json({ error: "internal_failure" }, { status: 500 }) : Response.json(result));
  const { dom, container } = await mount(t, SearchBox, searchProps);
  await input(byTag(container, "input")[0], "합성");
  await submit(byTag(container, "form")[0]);
  await waitFor(dom, () => buttonNamed(container, "다시 시도")[0], "search retry");
  // When
  await submit(byTag(container, "form")[0]);
  await waitFor(dom, () => byTag(container, "li")[0], "recovered candidates");
  // Then
  assert.equal(reads, 2);
  assert.equal(byTag(container, "input")[0].value, "합성");
  assert.equal(byTag(container, "details").length, 0);
});

for (const abstained of [undefined, { reason: "no_overlap", hint: "fixture" }]) {
  test(`search recovery ${abstained ? "focuses the retained abstained query" : "clears an empty query result"}`, async t => {
    // Given
    t.mock.method(globalThis, "fetch", async () => Response.json({ ...result, candidates: [], ...(abstained ? { abstained } : {}) }));
    const { dom, container } = await mount(t, SearchBox, searchProps);
    const field = byTag(container, "input")[0];
    await input(field, "합성");
    await submit(byTag(container, "form")[0]);
    const label = abstained ? "검색어 다시 쓰기" : "검색어 지우기";
    await waitFor(dom, () => buttonNamed(container, label)[0], "recovery action");
    // When
    await act(() => buttonNamed(container, label)[0].click());
    // Then
    assert.equal(dom.activeElement, field);
    assert.equal(field.value, abstained ? "합성" : "");
  });
}

for (const [before, after] of [["", ""], ["a", "a"], ["a\nb", "a\nnew\nb"], ["a\nb", "b"],
  ["a\nb\na", "a\na"], ["a\nb", "b\na"], ["last\n", "last"], ["", "new\n"]]) {
  test(`line diff reconstructs both documents for ${JSON.stringify([before, after])}`, () => {
    // Given / When
    const rows = lineDiff(before, after);
    // Then
    assert.equal(rows.filter(row => row.kind !== "added").map(row => row.text).join("\n"), before);
    assert.equal(rows.filter(row => row.kind !== "removed").map(row => row.text).join("\n"), after);
    assert.deepEqual(rows.filter(r => r.before !== null).map(r => r.before), before === "" ? [] : before.split("\n").map((_, i) => i + 1));
    assert.deepEqual(rows.filter(r => r.after !== null).map(r => r.after), after === "" ? [] : after.split("\n").map((_, i) => i + 1));
  });
}

test("comparison reads both retained packages and shows verified changes without mutating the head", async t => {
  // Given
  const reads = [];
  t.mock.method(globalThis, "fetch", async url => {
    reads.push(url);
    return Response.json(exported(url.split("/").at(-1)));
  });
  const { dom, container } = await mount(t, VersionDiff, { detail, signal, onUnauthorized() {} });
  // When
  await act(() => buttonNamed(container, "변경점 보기")[0].click());
  await waitFor(dom, () => byTag(container, "ol")[0], "comparison");
  // Then
  assert.deepEqual(new Set(reads), new Set(versions.map(v => routes.version(skillId, v.digest))));
  assert.equal(all(container, n => n.getAttribute("data-change") === "added").length, 1);
  assert.equal(summary.head.digest, versions[1].digest);
});

test("comparison failure offers retry and same-version comparison shows no added or removed rows", async t => {
  // Given
  let fail = true;
  t.mock.method(globalThis, "fetch", async url => fail ? Response.json({}, { status: 503 }) :
    Response.json(exported(url.split("/").at(-1))));
  const { dom, container } = await mount(t, VersionDiff, { detail, signal, onUnauthorized() {} });
  await input(byTag(container, "select")[0], versions[1].digest, "change");
  await act(() => buttonNamed(container, "변경점 보기")[0].click());
  await waitFor(dom, () => buttonNamed(container, "다시 시도")[0], "compare retry");
  fail = false;
  // When
  await act(() => buttonNamed(container, "다시 시도")[0].click());
  await waitFor(dom, () => byTag(container, "ol")[0], "same-version result");
  // Then
  assert.equal(all(container, n => ["added", "removed"].includes(n.getAttribute("data-change"))).length, 0);
});

test("comparison expires the account on unauthorized reads", { timeout: 15000 }, async t => {
  // Given
  let expired = 0;
  const expiration = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 401 }));
  const { container } = await mount(t, VersionDiff, { detail, signal, onUnauthorized() { expired++; expiration.resolve(); } });
  // When
  await act(() => buttonNamed(container, "변경점 보기")[0].click());
  await expiration.promise;
  // Then
  assert.equal(expired, 1);
});

test("comparison stays usable when a previously selected retained version is deleted", async t => {
  // Given
  const reads = [];
  t.mock.method(globalThis, "fetch", async url => { reads.push(url); return Response.json(exported(url.split("/").at(-1))); });
  const { dom, container, show } = await mount(t, VersionDiff, { detail, signal, onUnauthorized() {} });
  const current = { ...detail, versions: [versions[1]] };
  await show({ detail: current, signal, onUnauthorized() {} });
  // When
  await act(() => buttonNamed(container, "변경점 보기")[0].click());
  await waitFor(dom, () => byTag(container, "ol")[0], "retained selection");
  // Then
  assert.deepEqual(byTag(container, "select").map(n => n.value), [versions[1].digest, versions[1].digest]);
  assert.deepEqual(reads, [routes.version(skillId, versions[1].digest), routes.version(skillId, versions[1].digest)]);
});

test("validation associates document and acknowledgement errors and focuses the first invalid field", async t => {
  // Given
  const draft = emptyDraft(skillId);
  // When
  const { dom, container } = await mount(t, DraftEditor, { draft, idPrefix: "invalid", busy: false, notes: [], showErrors: true, onChange() {} });
  // Then
  const fields = [byTag(container, "textarea")[0], byTag(container, "input").find(n => n.type === "checkbox")];
  for (const field of fields) {
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.ok(dom.getElementById(field.getAttribute("aria-describedby")));
  }
  assert.equal(dom.activeElement, fields[0]);
  assert.deepEqual(draftIssues(draft).map(issue => issue.message), draftProblems(draft));
  assert.deepEqual(draftIssues(draft).map(issue => issue.field), ["document", "acknowledged"]);
});

test("request diagnostics stay separate from friendly errors and malformed JSON is unexpected", () => {
  // Given
  const error = new SkillsRequestError(418, "opaque_server_code");
  // When
  const message = describeFailure(error, "게시");
  // Then
  assert.equal(message.includes(error.code), false);
  assert.ok(technicalDetail(error).includes(error.code));
  assert.equal(classifyFailure(new SyntaxError("invalid JSON")), "unexpected");
});

test("supporting-file validation identifies the file group and focuses its described error", async t => {
  // Given
  const draft = { ...emptyDraft(skillId), document, acknowledged: true,
    files: [{ path: "../escape.txt", mediaType: "text/plain", bytes: new TextEncoder().encode("fixture") }] };
  // When
  const { dom, container } = await mount(t, DraftEditor, { draft, idPrefix: "files", busy: false, notes: [], showErrors: true, onChange() {} });
  // Then
  const group = byTag(container, "fieldset")[0];
  assert.deepEqual(draftIssues(draft).map(issue => issue.field), ["files"]);
  assert.equal(group.getAttribute("aria-invalid"), "true");
  assert.equal(dom.getElementById(group.getAttribute("aria-describedby")), dom.activeElement);
});

test("publication preparation refuses invalid drafts before any request", async t => {
  // Given
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected transfer"); });
  // When
  const outcome = await publishDraft(emptyDraft(skillId), signal);
  // Then
  assert.equal(outcome.ok, false);
  assert.equal(fetch.mock.callCount(), 0);
});

test("publication preparation preserves the existing base and explicit acknowledgement payload", async t => {
  // Given
  const draft = { ...emptyDraft(skillId), document, acknowledged: true, base: summary.head };
  let body;
  t.mock.method(globalThis, "fetch", async (_url, init) => { body = JSON.parse(init.body); return Response.json(detail); });
  // When
  const outcome = await publishDraft(draft, signal);
  // Then
  assert.equal(outcome.ok, true);
  assert.deepEqual(body.base, summary.head);
  assert.equal(body.acknowledgePrivateUpload, true);
  assert.equal(body.package.manifestDigest, packages[0].manifestDigest);
});

test("entity heading updates T1's h1 container without creating a duplicate", async t => {
  // Given
  const { h } = await import("preact");
  function Shell({ name }) {
    globalThis.document.querySelector = () => globalThis.document.getElementById("skills-page-title");
    return h("div", null, h("h1", { id: "skills-page-title" }, "스킬"), h(SkillsHeading, { name }));
  }
  const { container, show } = await mount(t, Shell, { name: "선택한 스킬" });
  // When
  await show({ name: "다른 스킬" });
  // Then
  assert.equal(byTag(container, "h1").length, 1);
  assert.equal(byTag(container, "h1")[0].textContent, "다른 스킬");
});
