import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRIVATE_SKILL_MAX_BYTES, PRIVATE_SKILL_MAX_RESOURCE_BYTES, PRIVATE_SKILL_MAX_REQUEST_BYTES,
  privateSkillBodySchema,
  privateSkillDigestSchema, privateSkillIdSchema, privateSkillPathSchema,
  privateSkillUri, parsePrivateSkillUri, privateSkillPublishSchema,
} from "../dist/private-skills.js";
import { createPrivateSkillPackage, verifyPrivateSkillPackage } from "../dist/private-skill-package.js";

const text = new TextEncoder();
const file = (path, body = "synthetic") => ({ path, mediaType: "text/plain", bytes: text.encode(body) });
const skill = file("SKILL.md", "---\nname: synthetic\ndescription: fixture\n---\nFixture");

test("all 512 local collector resources round trip without truncation", async () => {
  // Given
  const files = [skill, ...Array.from({ length: 511 }, (_, i) => file(`notes/${i}.txt`, String(i)))];
  // When
  const verified = await verifyPrivateSkillPackage(await createPrivateSkillPackage(files));
  // Then
  assert.equal(verified.files.size, 512);
  for (const resource of files) assert.deepEqual(verified.files.get(resource.path), resource.bytes);
});

for (const path of ["SKILL.md", "asset.bin"]) {
  test(`the local collector 16 MiB total can reside in ${path}`, async () => {
    // Given
    const bytes = new Uint8Array(16 * 1024 * 1024 - (path === "SKILL.md" ? 0 : skill.bytes.length)).fill(97);
    const files = path === "SKILL.md" ? [{ ...skill, bytes }] : [skill,
      { path, mediaType: "application/octet-stream", bytes }];
    // When
    const verified = await verifyPrivateSkillPackage(await createPrivateSkillPackage(files));
    // Then
    assert.deepEqual(verified.files.get(path), bytes);
  });
}

test("the 513th resource is explicitly refused rather than dropped", async () => {
  // Given
  const files = [skill, ...Array.from({ length: 512 }, (_, i) => file(`notes/${i}.txt`))];
  // When / Then
  await assert.rejects(createPrivateSkillPackage(files), { code: "invalid_resource" });
});

test("the request envelope holds maximum bytes with long Unicode paths and per-file padding", async () => {
  // Given
  const paths = Array.from({ length: 511 }, (_, i) => `${"한".repeat(500)}/${String(i).padStart(3, "0")}.txt`);
  const files = paths.map(path => file(path, "a"));
  files.push({ ...skill, bytes: new Uint8Array(16 * 1024 * 1024 - 511).fill(97) });
  // When
  const packet = await createPrivateSkillPackage(files);
  const request = text.encode(JSON.stringify({ base: { digest: "a".repeat(64), revision: Number.MAX_SAFE_INTEGER },
    acknowledgePrivateUpload: true, package: packet }));
  // Then
  assert.ok(request.length < PRIVATE_SKILL_MAX_REQUEST_BYTES);
  assert.equal(packet.manifest.resources.length, 512);
});

for (const body of ["A", "AAA", "A===", "=AAA", "AA=A", "AA-=", "AA\n="]) {
  test(`malformed base64 ${JSON.stringify(body)} remains denied`, () => {
    // Given / When / Then
    assert.equal(privateSkillBodySchema.safeParse(body).success, false);
  });
}

test("UUID inputs normalize before canonical private URI construction", () => {
  // Given
  const expected = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
  // When
  const id = privateSkillIdSchema.parse(expected.toUpperCase());
  const uri = privateSkillUri(id, privateSkillDigestSchema.parse("a".repeat(64)),
    privateSkillPathSchema.parse("SKILL.md"));
  // Then
  assert.equal(id, expected);
  assert.equal(parsePrivateSkillUri(uri).skillId, expected);
  assert.throws(() => parsePrivateSkillUri(uri.replace(expected, expected.toUpperCase())));
});

test("one canonical package preserves binary resources and pinned URI identity", async () => {
  // Given
  const bytes = new Uint8Array([0, 255, 128]);
  // When
  const packet = await createPrivateSkillPackage([file("안내 문서.txt"), skill,
    { path: "assets/pixel.bin", mediaType: "application/octet-stream", bytes }]);
  const verified = await verifyPrivateSkillPackage(packet);
  // Then
  assert.deepEqual(verified.files.get("assets/pixel.bin"), bytes);
  const id = privateSkillIdSchema.parse("11223344-1122-4122-8122-112233445566");
  const path = privateSkillPathSchema.parse("안내 문서.txt");
  const uri = privateSkillUri(id, packet.manifestDigest, path);
  assert.deepEqual(parsePrivateSkillUri(uri), { skillId: id, digest: packet.manifestDigest, path });
  assert.equal(uri.includes("/private/"), true);
});

for (const path of ["../escape", "/tmp/escape", "a/../../escape", "a\\escape", "a/%2fescape",
  "a/%252e%252e", "a//escape", "a/./escape", "C:/escape", "a/.git/config", "CON.txt", "payload.zip"]) {
  test(`package refuses unsafe resource path ${path}`, async () => {
    // Given / When
    const operation = createPrivateSkillPackage([skill, file(path)]);
    // Then
    await assert.rejects(operation);
  });
}

test("case-colliding resources cannot overwrite one another on a connector filesystem", async () => {
  // Given / When
  const operation = createPrivateSkillPackage([skill, file("guide.txt"), file("GUIDE.txt")]);
  // Then
  await assert.rejects(operation);
});

test("file and directory aliases cannot form an uninstallable package", async () => {
  // Given / When
  const operation = createPrivateSkillPackage([skill, file("guide"), file("guide/step.txt")]);
  // Then
  await assert.rejects(operation);
});

test("a disguised compressed archive is refused without decompression", async () => {
  // Given
  const archive = { path: "guide.txt", mediaType: "text/plain", bytes: new Uint8Array([0x50, 0x4b, 3, 4, 0]) };
  // When / Then
  await assert.rejects(createPrivateSkillPackage([skill, archive]), { code: "archive_not_supported" });
});

test("a resource changed after manifest creation fails integrity verification", async () => {
  // Given
  const packet = await createPrivateSkillPackage([skill]);
  const changed = { ...packet, contents: [{ ...packet.contents[0], body: btoa("changed") }] };
  // When / Then
  await assert.rejects(verifyPrivateSkillPackage(changed), { code: "package_integrity" });
});

test("a caller cannot supply an extra resource outside the manifest", async () => {
  // Given
  const packet = await createPrivateSkillPackage([skill]);
  const changed = { ...packet, contents: [...packet.contents, { path: "extra.txt", body: btoa("extra") }] };
  // When / Then
  await assert.rejects(verifyPrivateSkillPackage(changed), { code: "package_integrity" });
});

test("a changed manifest cannot keep the former pinned digest", async () => {
  // Given
  const packet = await createPrivateSkillPackage([skill]);
  const changed = { ...packet, manifestDigest: privateSkillDigestSchema.parse("0".repeat(64)) };
  // When / Then
  await assert.rejects(verifyPrivateSkillPackage(changed), { code: "package_integrity" });
});

test("the resource byte quota rejects before encoding", async () => {
  // Given
  const big = { path: "large.bin", mediaType: "application/octet-stream",
    bytes: new Uint8Array(PRIVATE_SKILL_MAX_RESOURCE_BYTES + 1) };
  // When / Then
  await assert.rejects(createPrivateSkillPackage([skill, big]));
});

test("the aggregate byte quota rejects before encoding", async () => {
  // Given
  const big = { mediaType: "application/octet-stream",
    bytes: new Uint8Array(PRIVATE_SKILL_MAX_RESOURCE_BYTES) };
  const count = PRIVATE_SKILL_MAX_BYTES / PRIVATE_SKILL_MAX_RESOURCE_BYTES + 1;
  // When / Then
  await assert.rejects(createPrivateSkillPackage([skill, ...Array.from({ length: count }, (_, index) =>
    ({ ...big, path: `data-${index}.bin` }))]));
});

test("a symlink descriptor cannot cross the package boundary", async () => {
  // Given
  const packet = await createPrivateSkillPackage([skill]);
  const changed = { ...packet, contents: [{ ...packet.contents[0], type: "symlink", target: "/outside" }] };
  // When / Then
  await assert.rejects(verifyPrivateSkillPackage(changed));
});

test("encoded separators do not gain access through canonical resource URIs", () => {
  // Given
  const id = "11223344-1122-4122-8122-112233445566", digest = "a".repeat(64);
  // When / Then
  assert.throws(() => parsePrivateSkillUri(`skillar://private/${id}/${digest}/scripts%2Fcheck.sh`));
  assert.throws(() => parsePrivateSkillUri(`skillar://private/${id}/${digest}/%252e%252e/secret`));
});

test("publication requires explicit private-content acknowledgement", async () => {
  // Given
  const packet = await createPrivateSkillPackage([skill]);
  // When / Then
  assert.throws(() => privateSkillPublishSchema.parse({ base: null, package: packet }));
});

test("an edit must carry a revision as well as a digest to prevent head ABA", async () => {
  // Given
  const packet = await createPrivateSkillPackage([skill]);
  // When / Then
  assert.throws(() => privateSkillPublishSchema.parse({
    base: { digest: packet.manifestDigest }, package: packet, acknowledgePrivateUpload: true,
  }));
});
