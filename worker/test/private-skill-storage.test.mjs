// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { fixture, packet, skillId, key, uri, publishInput } from "./helpers/private-skill-backend.mjs";
import { privateSkillUri } from "../../shared/dist/private-skills.js";

test("accepted Unicode resource paths remain readable after canonical URI encoding", async t => {
  // Given a bounded relative path whose canonical URI exceeds the old ASCII-sized limit.
  const f = await fixture(t), path = [...Array(4).fill("한".repeat(70)), "notes.txt"].join("/");
  const bytes = new TextEncoder().encode("synthetic unicode resource");
  const value = await packet("quartz", [{ path, mediaType: "text/plain", bytes }]);
  assert.equal((await f.publish(value)).status, 200);
  const resourceUri = privateSkillUri(skillId, value.manifestDigest, path);
  assert.ok(resourceUri.length > 2048);
  // When the advertised immutable resource is requested.
  const result = await f.send("/resources/read", "POST", { uri: resourceUri });
  // Then it resolves through the manifest and byte verification, not a shorter URI guess.
  assert.equal(result.status, 200);
  assert.deepEqual(new Uint8Array(Buffer.from(result.body.body, "base64")), bytes);
});

for (const mode of ["missing", "tampered"]) test(`${mode} R2 bytes fail closed for exports and resources`, async t => {
  // Given published metadata whose actual object disappears or changes.
  const f = await fixture(t), value = await packet();
  await f.publish(value);
  if (mode === "missing") await f.bucket.delete(key(value));
  else await f.bucket.put(key(value), "wrong bytes");
  // When either byte-serving endpoint reads the object.
  const results = [
    await f.send(`/${skillId}/versions/${value.manifestDigest}`),
    await f.send("/resources/read", "POST", { uri: uri(value) }),
  ];
  // Then metadata alone never yields successful or unverified resources.
  assert.deepEqual(results.map(result => result.status), [409, 409]);
});

test("a conflicting immutable R2 object cannot be accepted on retry", async t => {
  // Given an existing object at the expected content-addressed key.
  const f = await fixture(t), value = await packet();
  await f.bucket.put(key(value), "tampered");
  // When the conditional PUT cannot replace it.
  const result = await f.publish(value);
  // Then the existing bytes must verify before any authoritative metadata commits.
  assert.equal(result.body.error, "resource_integrity");
  assert.deepEqual(await f.rows(f.accounts, "SELECT * FROM private_skills"), []);
});

test("failed purge finalization CAS cannot delete retained version manifests", async t => {
  // Given a tombstone whose revision changes during physical byte deletion.
  const f = await fixture(t), value = await packet();
  const published = await f.publish(value);
  const base = published.body.skill.head;
  await f.hook({ point: "delete", sql: "UPDATE private_skills SET revision=revision+1" });
  // When the final completion transaction loses its revision compare.
  const result = await f.send(`/${skillId}`, "DELETE", { base });
  // Then recovery metadata survives instead of following a failed head update.
  assert.equal(result.status, 409);
  assert.equal((await f.rows(f.accounts, "SELECT * FROM private_skill_versions")).length, 1);
  assert.deepEqual(await f.rows(f.accounts, "SELECT tombstoned,purge_complete FROM private_skills"),
    [{ tombstoned: 1, purge_complete: 0 }]);
});

test("a tombstone survives failed purge and retry acknowledges only after physical deletion", async t => {
  // Given a stored skill and a storage-boundary delete failure.
  const f = await fixture(t), value = await packet();
  const base = (await f.publish(value)).body.skill.head;
  await f.hook({ point: "delete", fail: true });
  // When deletion fails and the exact original base is retried.
  const failed = await f.send(`/${skillId}`, "DELETE", { base });
  assert.equal(failed.status, 503);
  assert.notEqual(await f.bucket.get(key(value)), null);
  assert.equal((await f.send(`/${skillId}`)).status, 404);
  assert.equal((await f.publish(value)).status, 409);
  const retried = await f.send(`/${skillId}`, "DELETE", { base });
  // Then no false ACK escaped and the permanent tombstone cannot silently recreate.
  assert.equal(retried.status, 200);
  assert.deepEqual(retried.body, { deleted: true });
  assert.equal(await f.bucket.get(key(value)), null);
  assert.equal((await f.publish(value)).body.error, "skill_tombstoned");
  assert.deepEqual(await f.rows(f.accounts, "SELECT tombstoned,purge_complete FROM private_skills"),
    [{ tombstoned: 1, purge_complete: 1 }]);
});

test("version purge retry preserves head CAS and never deletes head or pinned versions", async t => {
  // Given a retained unpinned old digest and a newer head.
  const f = await fixture(t), old = await packet("old"), next = await packet("new");
  const first = await f.publish(old);
  const second = await f.publish(next, first.body.skill.head), base = second.body.skill.head;
  assert.equal((await f.send(`/${skillId}/versions/${next.manifestDigest}`, "DELETE", { base })).body.error, "version_protected");
  await f.hook({ point: "delete", fail: true });
  // When old-version deletion fails, then retries the same reserved base.
  const failed = await f.send(`/${skillId}/versions/${old.manifestDigest}`, "DELETE", { base });
  assert.equal(failed.status, 503);
  assert.equal((await f.send(`/${skillId}/versions/${old.manifestDigest}`)).status, 404);
  const retried = await f.send(`/${skillId}/versions/${old.manifestDigest}`, "DELETE", { base });
  // Then only old bytes are removed and exactly one per-skill revision is consumed.
  assert.equal(retried.status, 200);
  assert.equal(retried.body.skill.head.revision, base.revision + 1);
  assert.equal(retried.body.versions.length, 1);
  assert.equal(await f.bucket.get(key(old)), null);
  assert.notEqual(await f.bucket.get(key(next)), null);
});

test("package tampering traversal archives malformed metadata aliases and quotas fail before writes", async t => {
  // Given canonical package bytes and deliberately invalid boundary inputs.
  const f = await fixture(t), value = await packet();
  const tampered = structuredClone(value);
  tampered.contents[0].body = Buffer.from("changed").toString("base64");
  const traversal = structuredClone(value);
  traversal.manifest.resources[0].path = "../SKILL.md";
  const archive = structuredClone(value);
  archive.manifest.resources[0].path = "archive.zip";
  const disguised = structuredClone(value), bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  disguised.manifest.resources[0].bytes = bytes.length;
  disguised.manifest.resources[0].digest = createHash("sha256").update(bytes).digest("hex");
  disguised.contents[0].body = bytes.toString("base64");
  disguised.manifestDigest = createHash("sha256").update(JSON.stringify(disguised.manifest)).digest("hex");
  const cases = [
    tampered, traversal, archive, disguised,
    await packet("", [], "---\nname: Invalid Name\ndescription: example\n---\nbody"),
    await packet("", [], "---\nname: deploy\ndescription: example\nextra: &cycle [*cycle]\n---\nbody"),
    { ...value, manifest: { ...value.manifest, resources: Array(129).fill(value.manifest.resources[0]) } },
    { ...value, manifest: { ...value.manifest, resources: [{ ...value.manifest.resources[0], bytes: 524289 }] } },
    { ...value, manifest: { ...value.manifest, resources: [value.manifest.resources[0],
      ...Array.from({ length: 5 }, (_, index) => ({ ...value.manifest.resources[0], path: `file-${index}`, bytes: 524288 }))] } },
  ];
  // When each is published.
  const results = [];
  for (const input of cases) results.push(await f.publish(input));
  results.push(await f.send(`/${skillId}/versions`, "POST", { ...publishInput(value), metadata: { name: "caller" } }));
  results.push(await f.send(`/${skillId}/versions`, "POST", { ...publishInput(value), acknowledgePrivateUpload: false }));
  // Then rejected input creates neither upload intents, R2 objects nor authoritative entries.
  assert.deepEqual(results.map(result => result.status), Array(results.length).fill(400));
  assert.deepEqual(await f.rows(f.accounts, "SELECT * FROM private_skill_uploads"), []);
  assert.deepEqual((await f.bucket.list()).objects, []);
});

test("canonical resource membership rejects unknown and encoded traversal paths", async t => {
  // Given a valid private skill.
  const f = await fixture(t), value = await packet();
  await f.publish(value);
  // When a known digest is paired with an unlisted or noncanonical path.
  const results = [];
  for (const path of ["missing.md", "%53KILL.md", "..%2FSKILL.md", "folder%2FSKILL.md"]) {
    results.push(await f.send("/resources/read", "POST", { uri: uri(value, path) }));
  }
  // Then URI syntax and manifest membership are independently enforced.
  assert.deepEqual(results.map(result => result.status), [404, 400, 400, 400]);
});

test("primary version failure rolls back its head catalog revision and transactional outbox", async t => {
  // Given a real SQLite abort after the head statement but before version insertion completes.
  const f = await fixture(t), value = await packet();
  await f.accounts.prepare(`CREATE TRIGGER private_skill_fixture_abort BEFORE INSERT ON private_skill_versions
    BEGIN SELECT RAISE(ABORT,'fixture_version_failure'); END`).run();
  // When publication writes verified R2 bytes and then hits the failed metadata transaction.
  const failed = await f.publish(value);
  // Then no successful metadata ACK or head/outbox fragment survives; retry can publish.
  assert.equal(failed.status, 503);
  for (const table of ["private_skills", "private_skill_versions", "private_skill_catalogs", "account_control_outbox"]) {
    assert.deepEqual(await f.rows(f.accounts, `SELECT * FROM ${table}`), []);
  }
  await f.accounts.prepare("DROP TRIGGER private_skill_fixture_abort").run();
  assert.equal((await f.publish(value)).status, 200);
});
