import assert from "node:assert/strict";
import test from "node:test";
import {
  privateSkillExportSchema, privateSkillPublishSchema, privateSkillResourceSchema,
} from "../../shared/dist/private-skills.js";
import { createPrivateSkillPackage, verifyPrivateSkillPackage } from "../../shared/dist/private-skill-package.js";
import { classifyFailure, routes, SkillsRequestError } from "../src/skills/api.ts";
import {
  buildPackage, draftFromExport, draftProblems, emptyDraft, exportFileName, mediaTypeFor, mergePickedFiles, readFrontMatter,
  relativePaths, removeFile, skillHash, skillIdFromHash, sortByUpdated,
} from "../src/skills/model.ts";

const text = new TextEncoder();
const skillId = "11223344-1122-4122-8122-112233445566";
const document = "---\nname: synthetic\ndescription: A fixture skill\n---\nBody text.\n";
const supporting = { path: "scripts/run.sh", mediaType: "application/x-sh", bytes: text.encode("echo hi\n") };
const head = { digest: "a".repeat(64), revision: 3 };

function readyDraft() {
  return { ...emptyDraft(skillId), document, files: [supporting], acknowledged: true };
}

test("folder picks drop the picked folder's own name and keep nested paths; file picks keep their names", () => {
  // Given
  const folder = [
    { name: "SKILL.md", relativePath: "my-skill/SKILL.md" },
    { name: "run.sh", relativePath: "my-skill/scripts/run.sh" },
  ];
  const files = [{ name: "SKILL.md", relativePath: "" }, { name: "notes.txt", relativePath: "" }];
  const mixed = [{ name: "a.md", relativePath: "one/a.md" }, { name: "b.md", relativePath: "two/b.md" }];
  // When / Then
  assert.deepEqual(relativePaths(folder), ["SKILL.md", "scripts/run.sh"]);
  assert.deepEqual(relativePaths(files), ["SKILL.md", "notes.txt"]);
  assert.deepEqual(relativePaths(mixed), ["one/a.md", "two/b.md"]);
});

test("media types prefer known text extensions, then a valid browser type, then octet-stream, and always satisfy the resource schema", () => {
  // Given
  const cases = [
    ["SKILL.md", "", "text/markdown"],
    ["scripts/check.ts", "video/mp2t", "text/plain"],
    ["assets/pixel.bin", "", "application/octet-stream"],
    ["assets/photo.heic", "IMAGE/HEIC; charset=binary", "image/heic"],
    ["assets/odd.xyz", "not a type", "application/octet-stream"],
  ];
  for (const [path, browserType, expected] of cases) {
    // When
    const mediaType = mediaTypeFor(path, browserType);
    // Then
    assert.equal(mediaType, expected, path);
    assert.equal(privateSkillResourceSchema.safeParse({ path, mediaType, bytes: 0, digest: "f".repeat(64) }).success, true, path);
  }
});

test("front matter name and description are read from plain, quoted, folded and CRLF blocks", () => {
  assert.deepEqual(readFrontMatter(document), { name: "synthetic", description: "A fixture skill" });
  assert.deepEqual(readFrontMatter("---\r\nname: \"quoted\"\r\ndescription: 'single'\r\n---\r\nbody"), { name: "quoted", description: "single" });
  assert.deepEqual(readFrontMatter("---\nname: folded\ndescription: >\n  first line\n  second line\n---\n"), { name: "folded", description: "first line second line" });
  assert.deepEqual(readFrontMatter("# No front matter\n"), { name: null, description: null });
  assert.deepEqual(readFrontMatter("---\nname:\ndescription: x\n---\n"), { name: null, description: "x" });
});

test("a complete acknowledged draft has no problems and each guard adds exactly one", () => {
  // Given
  const draft = readyDraft();
  // When / Then
  assert.deepEqual(draftProblems(draft), []);
  assert.equal(draftProblems({ ...draft, acknowledged: false }).length, 1);
  assert.equal(draftProblems({ ...draft, document: "# no front matter" }).length, 2);
  assert.equal(draftProblems({ ...draft, files: [{ ...supporting, path: "archive.zip" }] }).length, 1);
  assert.equal(draftProblems({ ...draft, files: [{ ...supporting, path: "SKILL.md" }] }).length, 1);
  assert.equal(draftProblems({ ...draft, files: [{ ...supporting, bytes: new Uint8Array(512 * 1024 + 1) }] }).length, 1);
  assert.equal(draftProblems(emptyDraft()).length, 2);
});

test("a built package verifies, keeps supporting paths and bytes, and forms a valid publish body", async () => {
  // Given
  const draft = readyDraft();
  // When
  const built = await buildPackage(draft);
  // Then
  assert.equal(built.ok, true);
  const verified = await verifyPrivateSkillPackage(built.package);
  assert.deepEqual([...verified.files.keys()], ["SKILL.md", "scripts/run.sh"]);
  assert.deepEqual(verified.files.get("scripts/run.sh"), supporting.bytes);
  assert.equal(new TextDecoder().decode(verified.files.get("SKILL.md")), document);
  assert.equal(built.package.manifest.resources.find(resource => resource.path === "SKILL.md")?.mediaType, "text/markdown");
  const body = { base: null, acknowledgePrivateUpload: true, package: built.package };
  assert.deepEqual(privateSkillPublishSchema.parse(body), body);
  assert.deepEqual(privateSkillPublishSchema.parse({ ...body, base: head }).base, head);
});

test("a compressed archive among the files is refused by name without a request", async () => {
  // Given
  const archive = { path: "guide.txt", mediaType: "text/plain", bytes: new Uint8Array([0x50, 0x4b, 3, 4, 0]) };
  // When
  const built = await buildPackage({ ...readyDraft(), files: [supporting, archive] });
  // Then
  assert.equal(built.ok, false);
  assert.equal(built.problems.length, 1);
  assert.equal(built.problems[0].startsWith("guide.txt"), true);
});

test("an export round-trips into an editable draft whose unchanged publish reproduces the same manifest digest", async () => {
  // Given
  const original = await createPrivateSkillPackage([
    { path: "SKILL.md", mediaType: "text/markdown", bytes: text.encode(document) }, supporting,
    { path: "assets/pixel.bin", mediaType: "application/octet-stream", bytes: new Uint8Array([0, 255, 128]) },
  ]);
  const exported = privateSkillExportSchema.parse({
    skillId, version: { digest: original.manifestDigest, createdAt: 1_800_000_000_000, pinned: false }, package: original,
  });
  // When
  const draft = await draftFromExport(exported, { digest: original.manifestDigest, revision: 1 });
  const rebuilt = await buildPackage({ ...draft, acknowledged: true });
  // Then
  assert.equal(draft.document, document);
  assert.deepEqual(draft.files.map(file => file.path), ["assets/pixel.bin", "scripts/run.sh"]);
  assert.deepEqual(draft.files[0].bytes, new Uint8Array([0, 255, 128]));
  assert.equal(draft.acknowledged, false);
  assert.deepEqual(draft.base, { digest: original.manifestDigest, revision: 1 });
  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.package.manifestDigest, original.manifestDigest);
});

test("a version whose SKILL.md is not UTF-8 text cannot become an editable draft", async () => {
  // Given
  const binary = await createPrivateSkillPackage([{ path: "SKILL.md", mediaType: "text/markdown", bytes: new Uint8Array([0xff, 0xfe, 0x00]) }]);
  const exported = { skillId, version: { digest: binary.manifestDigest, createdAt: 0, pinned: false }, package: binary };
  // When / Then
  await assert.rejects(draftFromExport(exported, { digest: binary.manifestDigest, revision: 1 }), { code: "document_not_text" });
});

test("picked files replace same-path files, a picked SKILL.md becomes the document, and removal is by path", () => {
  // Given
  const draft = readyDraft();
  const picked = [
    { path: "SKILL.md", mediaType: "text/markdown", bytes: text.encode("---\nname: replaced\ndescription: d\n---\n") },
    { path: "scripts/run.sh", mediaType: "application/x-sh", bytes: text.encode("echo replaced\n") },
    { path: "docs/guide.txt", mediaType: "text/plain", bytes: text.encode("guide") },
  ];
  // When
  const merged = mergePickedFiles(draft, picked);
  // Then
  assert.equal(merged.draft.document, "---\nname: replaced\ndescription: d\n---\n");
  assert.deepEqual(merged.draft.files.map(file => file.path), ["scripts/run.sh", "docs/guide.txt"]);
  assert.deepEqual(merged.draft.files[0].bytes, text.encode("echo replaced\n"));
  assert.equal(merged.notes.length, 2);
  assert.deepEqual(removeFile(merged.draft, "scripts/run.sh").files.map(file => file.path), ["docs/guide.txt"]);
  assert.equal(merged.draft.acknowledged, true);
});

test("failures classify by status first and then by the worker's fixed codes", () => {
  const cases = [
    [401, "unauthorized", "unauthorized"], [403, "insufficient_scope", "forbidden"], [404, "not_found", "gone"],
    [409, "head_conflict", "conflict"], [409, "version_protected", "protected"], [409, "skill_tombstoned", "deleting"],
    [400, "invalid_skill", "invalid-skill"], [400, "invalid_resource", "invalid"], [413, "request_too_large", "too-large"],
    [429, "rate_limited", "rate-limited"], [503, "private_skills_unavailable", "unavailable"], [415, "json_required", "other"],
  ];
  for (const [status, code, kind] of cases) assert.equal(classifyFailure(new SkillsRequestError(status, code)), kind, code);
  assert.equal(classifyFailure(new TypeError("fetch failed")), "unreachable");
  assert.equal(classifyFailure(new DOMException("aborted", "AbortError")), "cancelled");
  const zod = new Error("bad"); zod.name = "ZodError";
  assert.equal(classifyFailure(zod), "unexpected");
  assert.equal(classifyFailure(new Error("other")), "other");
});

test("routes follow the P10 contract and encode identifiers", () => {
  assert.equal(routes.catalog, "/api/skills");
  assert.equal(routes.search, "/api/skills/search");
  assert.equal(routes.skill(skillId), `/api/skills/${skillId}`);
  assert.equal(routes.versions(skillId), `/api/skills/${skillId}/versions`);
  assert.equal(routes.version("a/b", "c d"), "/api/skills/a%2Fb/versions/c%20d");
  assert.equal(routes.head(skillId), `/api/skills/${skillId}/head`);
  assert.equal(routes.pins(skillId), `/api/skills/${skillId}/pins`);
});

test("export file names carry a slug and the first eight digest characters", () => {
  assert.equal(exportFileName("My Skill!", head.digest), "skill-my-skill-aaaaaaaa.json");
  assert.equal(exportFileName("안내 문서", "b".repeat(64)), "skill-안내-문서-bbbbbbbb.json");
  assert.equal(exportFileName("___", "c".repeat(64)), "skill-skill-cccccccc.json");
});

test("skill hashes round-trip and reject anything that is not a skill UUID", () => {
  assert.equal(skillHash(skillId), `#skill/${skillId}`);
  assert.equal(skillIdFromHash(skillHash(skillId)), skillId);
  assert.equal(skillIdFromHash(`#skill/${skillId.toUpperCase()}`), skillId);
  assert.equal(skillIdFromHash("#skill/not-a-uuid"), null);
  assert.equal(skillIdFromHash("#sessions"), null);
  assert.equal(skillIdFromHash(""), null);
});

test("the library lists the most recently updated skill first and breaks ties by name", () => {
  const summary = (id, name, updatedAt) => ({ skillId: id, name, description: "d", head, updatedAt });
  const catalog = { revision: 3, skills: [
    summary("11223344-1122-4122-8122-000000000001", "b", 10), summary("11223344-1122-4122-8122-000000000002", "a", 10),
    summary("11223344-1122-4122-8122-000000000003", "c", 20),
  ] };
  assert.deepEqual(sortByUpdated(catalog).map(skill => skill.name), ["c", "a", "b"]);
});
