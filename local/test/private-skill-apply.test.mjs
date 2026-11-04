import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPrivateSkillPackage } from "../../shared/dist/private-skill-package.js";
import { PRIVATE_SKILL_MAX_REQUEST_BYTES, PRIVATE_SKILL_MAX_RESOURCE_BYTES } from "../../shared/dist/private-skills.js";
import { distImport } from "./_helpers.mjs";

const { previewSkill } = await distImport("skills/plan.js");
const { MAX_PLAN_BYTES } = await distImport("skills/plan.js");
const { applySkill } = await distImport("skills/apply.js");
const { rollbackSkill } = await distImport("skills/rollback.js");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

async function fixture(t) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "skillar-private-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root");
  mkdirSync(root);
  const binary = Buffer.from([0, 255, 128, 42, 13, 10]);
  const packet = await createPrivateSkillPackage([
    { path: "SKILL.md", mediaType: "text/markdown", bytes: Buffer.from("# Local data\n$(touch should-not-exist)\n") },
    { path: "data/asset.bin", mediaType: "application/octet-stream", bytes: binary },
  ]);
  const exported = { skillId: "00000000-0000-4000-8000-000000000001",
    version: { digest: packet.manifestDigest, createdAt: 1, pinned: false }, package: packet };
  const packagePath = join(base, "export.json"), planPath = join(base, "plan.json");
  writeFileSync(packagePath, JSON.stringify(exported));
  const preview = extra => previewSkill({ packagePath, destinationRoot: root, planPath, ...extra });
  return { base, root, binary, exported, packagePath, planPath, preview };
}

test("preview records create paths and digests without mutating the destination", async t => {
  const f = await fixture(t);
  const before = statSync(f.root);
  const plan = await f.preview();
  assert.deepEqual(readdirSync(f.root), []);
  assert.equal(statSync(f.root).mtimeMs, before.mtimeMs);
  assert.equal(statSync(f.planPath).mode & 0o777, 0o600);
  assert.deepEqual(plan.files.map(file => [file.path, file.before]), [["SKILL.md", null], ["data/asset.bin", null]]);
  assert.equal(plan.exported.package.manifestDigest, f.exported.version.digest);
});

test("preview refuses overwrites without explicit permission and leaves all bytes alone", async t => {
  const f = await fixture(t);
  writeFileSync(join(f.root, "SKILL.md"), "original");
  await assert.rejects(f.preview(), { code: "overwrite_requires_permission" });
  assert.equal(readFileSync(join(f.root, "SKILL.md"), "utf8"), "original");
  assert.equal(existsSync(f.planPath), false);
  const plan = await f.preview({ allowOverwrite: true });
  assert.equal(plan.files[0].before.digest, hash("original"));
});

test("apply and explicit rollback preserve binary original bytes and modes", async t => {
  const f = await fixture(t);
  const original = Buffer.from([0, 1, 254, 250]);
  writeFileSync(join(f.root, "SKILL.md"), original, { mode: 0o640 });
  await f.preview({ allowOverwrite: true });
  const applied = await applySkill(f.planPath);
  assert.equal(applied.status, "applied");
  assert.deepEqual(readFileSync(join(f.root, "data/asset.bin")), f.binary);
  assert.equal(statSync(applied.receipt).mode & 0o777, 0o600);
  assert.equal(statSync(join(f.root, "SKILL.md")).mode & 0o777, 0o600);
  const receipt = JSON.parse(readFileSync(applied.receipt, "utf8"));
  assert.deepEqual(Buffer.from(receipt.entries[0].beforeBody, "base64"), original);
  const rolled = await rollbackSkill(applied.receipt);
  assert.equal(rolled.status, "rolled_back");
  assert.deepEqual(readFileSync(join(f.root, "SKILL.md")), original);
  assert.equal(statSync(join(f.root, "SKILL.md")).mode & 0o777, 0o640);
  assert.equal(existsSync(join(f.root, "data/asset.bin")), false);
  assert.equal((await rollbackSkill(applied.receipt)).status, "rolled_back");
  assert.equal(existsSync(join(f.root, "should-not-exist")), false);
});

test("corrupt exports fail before any plan or destination write", async t => {
  const f = await fixture(t);
  const mutations = [
    e => { e.version.digest = "0".repeat(64); },
    e => { e.package.manifestDigest = "1".repeat(64); },
    e => { e.package.contents[0].body = Buffer.from("changed").toString("base64"); },
    e => { e.package.contents.reverse(); },
    e => { e.package.contents.push(e.package.contents[0]); },
    e => { e.package.manifest.resources[0].path = "../outside"; },
    e => { e.package.manifest.resources[0].bytes = PRIVATE_SKILL_MAX_RESOURCE_BYTES + 1; },
    e => { e.package.contents[0].body = "AP=="; },
    e => { e.package.manifest.resources[0].path = "bundle.zip"; },
    e => {
      const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      e.package.contents[0].body = bytes.toString("base64");
      e.package.manifest.resources[0].bytes = bytes.length;
      e.package.manifest.resources[0].digest = hash(bytes);
      e.package.manifestDigest = hash(JSON.stringify(e.package.manifest));
      e.version.digest = e.package.manifestDigest;
    },
  ];
  for (const mutate of mutations) {
    const exported = structuredClone(f.exported);
    mutate(exported);
    writeFileSync(f.packagePath, JSON.stringify(exported));
    await assert.rejects(f.preview());
    assert.deepEqual(readdirSync(f.root), []);
    assert.equal(existsSync(f.planPath), false);
  }
});

test("corrupt serialized plans cannot choose unrelated targets or omit guards", async t => {
  const f = await fixture(t);
  const plan = await f.preview();
  const outside = join(f.base, "outside");
  writeFileSync(outside, "safe");
  for (const mutate of [
    p => { p.files[0].path = "../outside"; },
    p => { p.files[0].path = outside; },
    p => { p.files.pop(); },
    p => { p.directories.pop(); },
    p => { p.directories[0].path = outside; },
    p => { p.exported.package.contents[0].body = "AAAA"; },
    p => { p.exported.version.digest = "0".repeat(64); },
    p => { p.root += "/.."; },
  ]) {
    const bad = structuredClone(plan);
    mutate(bad);
    writeFileSync(f.planPath, JSON.stringify(bad));
    await assert.rejects(applySkill(f.planPath));
    assert.deepEqual(readdirSync(f.root), []);
    assert.equal(readFileSync(outside, "utf8"), "safe");
  }
});

test("bounded local documents and destination-contained plans are refused", async t => {
  const f = await fixture(t);
  await assert.rejects(f.preview({ planPath: join(f.root, "SKILL.md") }), { code: "plan_in_destination" });
  writeFileSync(f.packagePath, " ".repeat(PRIVATE_SKILL_MAX_REQUEST_BYTES + 1));
  await assert.rejects(f.preview(), { code: "quota" });
  writeFileSync(f.planPath, " ".repeat(MAX_PLAN_BYTES + 1));
  await assert.rejects(applySkill(f.planPath), { code: "quota" });
  assert.deepEqual(readdirSync(f.root), []);
});

test("preview refuses static symlink targets, parents, roots and file directory collisions", async t => {
  for (const kind of ["target", "parent", "root", "file-parent", "directory-target"]) {
    const f = await fixture(t);
    const outside = join(f.base, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "SKILL.md"), "safe");
    if (kind === "target") symlinkSync(join(outside, "SKILL.md"), join(f.root, "SKILL.md"));
    if (kind === "parent") symlinkSync(outside, join(f.root, "data"));
    if (kind === "root") { rmSync(f.root, { recursive: true }); symlinkSync(outside, f.root); }
    if (kind === "file-parent") writeFileSync(join(f.root, "data"), "file");
    if (kind === "directory-target") mkdirSync(join(f.root, "SKILL.md"));
    await assert.rejects(f.preview({ allowOverwrite: true }));
    assert.equal(readFileSync(join(outside, "SKILL.md"), "utf8"), "safe");
    assert.equal(existsSync(f.planPath), false);
  }
});

test("receipts reject tampered backups, membership and recovery paths before rollback", async t => {
  const f = await fixture(t);
  writeFileSync(join(f.root, "SKILL.md"), "original");
  await f.preview({ allowOverwrite: true });
  const applied = await applySkill(f.planPath);
  const receipt = JSON.parse(readFileSync(applied.receipt, "utf8"));
  for (const mutate of [
    r => { r.entries[0].beforeBody = Buffer.from("corrupt").toString("base64"); },
    r => { r.plan.files[0].path = "../outside"; },
    r => { r.entries.pop(); },
    r => { r.directories[0].path = f.base; },
    r => { r.runId = "00000000-0000-4000-8000-000000000002"; },
  ]) {
    const bad = structuredClone(receipt);
    mutate(bad);
    writeFileSync(applied.receipt, JSON.stringify(bad));
    await assert.rejects(rollbackSkill(applied.receipt));
    assert.deepEqual(readFileSync(join(f.root, "data/asset.bin")), f.binary);
  }
});
