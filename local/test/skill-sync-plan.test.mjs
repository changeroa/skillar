import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeTempDir, removeDir, distImport } from "./_helpers.mjs";
import { cliSandbox, runCli, snapshotTree } from "./helpers/cli.mjs";

const { planSkillSync } = await distImport("skills/sync-plan.js");
const md = (name) => `---\nname: ${name}\ndescription: test skill ${name}\n---\nbody\n`;
function skill(root, dir, files) {
  mkdirSync(join(root, dir), { recursive: true });
  for (const [f, c] of Object.entries(files)) writeFileSync(join(root, dir, f), c);
}

test("sync plan classifies skills and never reads outside or writes", async (t) => {
  const root = makeTempDir();
  t.after(() => removeDir(root));
  skill(root, "ok", { "SKILL.md": md("ok") });
  skill(root, "dupA", { "SKILL.md": md("dup") });
  skill(root, "dupB", { "SKILL.md": md("dup") });
  skill(root, "withenv", { "SKILL.md": md("withenv"), ".env": "TOKEN=x\n" });
  skill(root, "bin", { "SKILL.md": md("bin"), "a.zip": "x" });
  skill(root, "big", { "SKILL.md": md("big"), "data.txt": "x".repeat(512 * 1024 + 1) });
  skill(root, "nofm", { "SKILL.md": "no front matter\n" });
  skill(root, "plugins/vendorpack", { "SKILL.md": md("vendorpack") });
  skill(root, "link", { "SKILL.md": md("link") });
  symlinkSync("/etc/hostname", join(root, "link", "ref.txt"));
  const plan = await planSkillSync([{ id: "claude", path: root }, { id: "missing", path: join(root, "nope") }], { deviceId: "dev1" });
  const by = Object.fromEntries(plan.skills.map((s) => [s.dir, s]));
  assert.equal(by.ok.decision, "candidate");
  assert.equal(by.ok.key, "dev1/claude/ok");
  assert.equal(by.dupA.decision, "hold_name_conflict");
  assert.equal(by.dupB.decision, "hold_name_conflict");
  assert.equal(by.dupA.sameContentAs.length, 1);
  assert.equal(by.withenv.reason, "secret_like_file");
  assert.equal(by.bin.reason, "binary_or_archive_file");
  assert.equal(by.big.reason, "limit_exceeded");
  assert.equal(by.nofm.reason, "invalid_skill_md");
  assert.equal(by["plugins/vendorpack"].reason, "external_pack_unverified");
  assert.equal(by.link.reason, "symlink_or_special_file");
  assert.equal(plan.sent, false);
  assert.equal(plan.uploadDecision, "unknown_needs_review");
  assert.deepEqual(plan.unresolved, ["account_identity", "connection_generation", "remote_same_name_conflict", "ownership_unverified"]);
  assert.equal(plan.identity.final, false);
  assert.deepEqual(by.ok.review, plan.unresolved);
  assert.equal(plan.roots.find((r) => r.id === "missing").present, false);
});

test("skills sync-plan CLI is a dry run that leaves HOME unchanged", async (t) => {
  const sb = cliSandbox();
  t.after(sb.cleanup);
  skill(join(sb.home, ".claude", "skills"), "mine", { "SKILL.md": md("mine") });
  const before = snapshotTree(sb.home);
  const r = await runCli(["skills", "sync-plan", "--json"], sb.env);
  assert.equal(r.code, 0, r.output);
  const out = JSON.parse(r.stdout);
  assert.equal(out.dryRun, true);
  assert.equal(out.skills.filter((s) => s.decision === "candidate").length, 1);
  assert.deepEqual(snapshotTree(sb.home), before);
});

test("content scan blocks secrets in SKILL.md and referenced files without printing them, and leaves placeholders alone", async (t) => {
  const root = makeTempDir();
  t.after(() => removeDir(root));
  const fakeAws = "AKIA" + "ABCDEFGHIJKLMNOP";
  const fakeGh = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
  skill(root, "body-secret", { "SKILL.md": md("body-secret") + `use key ${fakeAws}\n` });
  mkdirSync(join(root, "ref-secret", "references"), { recursive: true });
  skill(root, "ref-secret", { "SKILL.md": md("ref-secret") });
  writeFileSync(join(root, "ref-secret", "references", "notes.md"), `token = ${fakeGh}\n`);
  skill(root, "pem", { "SKILL.md": md("pem"), "notes.txt": "-----BEGIN RSA PRIVATE KEY-----\nx\n" });
  skill(root, "assign", { "SKILL.md": md("assign") + 'password: "correct-horse-battery-staple-12345"\n' });
  skill(root, "placeholders", { "SKILL.md": md("placeholders") + [
    "Set API_KEY=your-key-here", "token: ${TOKEN}", 'password = "<password>"', "export SECRET=$SECRET_FROM_ENV",
    "Authorization: Bearer <token>", "the word token appears here", "see sk-learn docs", "AKIA is an AWS prefix", ""].join("\n") });
  const plan = await planSkillSync([{ id: "r", path: root }]);
  const by = Object.fromEntries(plan.skills.map((s) => [s.dir, s]));
  assert.equal(by["body-secret"].reason, "secret_pattern_in_content");
  assert.match(by["body-secret"].detail, /^SKILL\.md:\d+ matches aws_access_key_id$/);
  assert.equal(by["ref-secret"].reason, "secret_pattern_in_content");
  assert.match(by["ref-secret"].detail, /references\/notes\.md:1 matches github_token/);
  assert.equal(by.pem.reason, "secret_pattern_in_content");
  assert.equal(by.assign.reason, "secret_pattern_in_content");
  assert.equal(by.placeholders.decision, "candidate", by.placeholders.detail);
  const printed = JSON.stringify(plan);
  for (const secret of [fakeAws, fakeGh, "correct-horse-battery"]) assert.equal(printed.includes(secret), false, "matched text must never be printed");
});

test("external-pack exclusion matches whole path segments of the skill dir only", async (t) => {
  const root = makeTempDir();
  t.after(() => removeDir(root));
  skill(root, "my-plugins-helper", { "SKILL.md": md("my-plugins-helper") });
  skill(root, "pluginsish", { "SKILL.md": md("pluginsish") });
  skill(root, "team/review", { "SKILL.md": md("review") });
  skill(root, "plugins/cache/x", { "SKILL.md": md("x") });
  skill(root, "node_modules/y", { "SKILL.md": md("y") });
  skill(root, "deep/vendor/z", { "SKILL.md": md("z") });
  const plan = await planSkillSync([{ id: "r", path: root }]);
  const by = Object.fromEntries(plan.skills.map((s) => [s.dir, s]));
  assert.equal(by["my-plugins-helper"].decision, "candidate");
  assert.equal(by.pluginsish.decision, "candidate");
  assert.equal(by["team/review"].decision, "candidate");
  for (const d of ["plugins/cache/x", "node_modules/y", "deep/vendor/z"]) assert.equal(by[d].reason, "external_pack_unverified", d);
});

test("a root path that contains an excluded word does not exclude its skills, and symlinked roots and directories are not followed", async (t) => {
  const base = makeTempDir();
  t.after(() => removeDir(base));
  const root = join(base, "plugins", "mine");
  skill(root, "ok", { "SKILL.md": md("ok") });
  const elsewhere = join(base, "elsewhere");
  skill(elsewhere, "hidden", { "SKILL.md": md("hidden") });
  symlinkSync(elsewhere, join(root, "linked-dir"));
  symlinkSync(root, join(base, "linked-root"));
  const plan = await planSkillSync([{ id: "r", path: root }, { id: "lr", path: join(base, "linked-root") }]);
  assert.deepEqual(plan.skills.map((s) => `${s.rootId}:${s.dir}:${s.decision}`), ["r:ok:candidate"]);
  assert.equal(plan.roots.find((r) => r.id === "lr").present, false);
});

test("provenance: managed synced folders and plugin package markers are excluded by structure, skill names alone never are", async (t) => {
  const root = makeTempDir();
  t.after(() => removeDir(root));
  const u = "0f8fad5b-d9cb-469f-a165-70867728950e", v = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  skill(root, `synced/${u}_${v}/pdf`, { "SKILL.md": md("pdf") });
  skill(root, `synced/${u}_${v}/skill-creator`, { "SKILL.md": md("skill-creator") });
  skill(root, "synced/my-notes", { "SKILL.md": md("my-notes") });
  skill(root, `synced/${u}/solo`, { "SKILL.md": md("solo") });
  skill(root, "pdf", { "SKILL.md": md("pdf-local") });
  skill(root, "deep-research", { "SKILL.md": md("deep-research") });
  mkdirSync(join(root, "pack", ".claude-plugin"), { recursive: true });
  skill(root, "pack/inner", { "SKILL.md": md("inner") });
  const plan = await planSkillSync([{ id: "claude", path: root }]);
  const by = Object.fromEntries(plan.skills.map((s) => [s.dir, s]));
  assert.equal(by[`synced/${u}_${v}/pdf`].reason, "managed_sync_external");
  assert.equal(by[`synced/${u}_${v}/skill-creator`].reason, "managed_sync_external");
  for (const d of ["synced/my-notes", `synced/${u}/solo`, "pdf", "deep-research"]) assert.equal(by[d].decision, "candidate", d);
  assert.equal(by["pack/inner"].reason, "external_pack_marker");
  assert.ok(by.pdf.review.includes("ownership_unverified"), "candidates stay ownership-unverified");
});

test("default exclusion policy: gajae runtime root is excluded unless a single skill is opted in; opted-in skills keep secret scan and unknown ownership", async (t) => {
  const root = makeTempDir();
  t.after(() => removeDir(root));
  skill(root, "deep-interview", { "SKILL.md": md("deep-interview") });
  skill(root, "mine", { "SKILL.md": md("mine") });
  skill(root, "leaky", { "SKILL.md": md("leaky"), "notes.txt": "key=sk-" + "a".repeat(40) + "\n" });
  let plan = await planSkillSync([{ id: "gajae", path: root }]);
  assert.ok(plan.skills.every((s) => s.reason === "runtime_default_excluded" && s.decision === "skipped"));
  assert.match(plan.skills[0].detail, /not a provenance finding/);
  plan = await planSkillSync([{ id: "gajae", path: root }], { include: ["gajae/mine", "gajae/leaky"] });
  const by = Object.fromEntries(plan.skills.map((s) => [s.dir, s]));
  assert.equal(by.mine.decision, "candidate");
  assert.ok(by.mine.review.includes("ownership_unverified"));
  assert.equal(by["deep-interview"].reason, "runtime_default_excluded");
  assert.equal(by.leaky.decision, "skipped");
  assert.equal(by.leaky.reason, "secret_pattern_in_content");
});
