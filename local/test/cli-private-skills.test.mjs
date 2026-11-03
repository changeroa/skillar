import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createPrivateSkillPackage } from "../../shared/dist/private-skill-package.js";
import { cliSandbox, runCli } from "./helpers/cli.mjs";

async function fixture(t) {
  const sb = cliSandbox({ runtimes: [] });
  t.after(sb.cleanup);
  const home = realpathSync(sb.home), root = join(home, "skills");
  mkdirSync(root);
  const packagePath = join(home, "export.json"), planPath = join(home, "plan.json");
  const packet = await createPrivateSkillPackage([
    { path: "SKILL.md", mediaType: "text/markdown", bytes: Buffer.from("# Private\n") },
    { path: "resources/binary.bin", mediaType: "application/octet-stream", bytes: Buffer.from([0, 255, 13]) },
  ]);
  writeFileSync(packagePath, JSON.stringify({ skillId: "00000000-0000-4000-8000-000000000001",
    version: { digest: packet.manifestDigest, createdAt: 1, pinned: false }, package: packet }));
  const args = ["skills", "preview", "--package", packagePath, "--destination-root", root, "--plan", planPath];
  return { sb, root, packagePath, planPath, args, target: join(root, "SKILL.md") };
}

test("real CLI previews applies and rolls back binary packages locally", async t => {
  const f = await fixture(t);
  const preview = await runCli(f.args, f.sb.env);
  assert.equal(preview.code, 0, preview.output);
  const report = JSON.parse(preview.stdout);
  assert.equal(report.status, "preview");
  assert.deepEqual(report.files.map(file => file.action), ["create", "create"]);
  assert.equal(report.files[0].path, f.target);
  assert.match(report.files[0].afterDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(readdirSync(f.root), []);
  const apply = await runCli(["skills", "apply", "--plan", f.planPath], f.sb.env);
  assert.equal(apply.code, 0, apply.output);
  const receipt = JSON.parse(apply.stdout).receipt;
  assert.equal(JSON.parse(apply.stdout).status, "applied");
  assert.deepEqual(readFileSync(join(f.root, "resources/binary.bin")), Buffer.from([0, 255, 13]));
  const rollback = await runCli(["skills", "rollback", "--receipt", receipt], f.sb.env);
  assert.equal(rollback.code, 0, rollback.output);
  assert.equal(JSON.parse(rollback.stdout).status, "rolled_back");
  assert.equal(existsSync(f.target), false);
  assert.equal(existsSync(f.sb.env.SKILLAR_HOME), false);
});

test("real CLI reports overwrite permission and stale apply conflicts as failures", async t => {
  const f = await fixture(t);
  writeFileSync(f.target, "original");
  assert.equal((await runCli(f.args, f.sb.env)).code, 1);
  const preview = await runCli([...f.args, "--allow-overwrite"], f.sb.env);
  assert.equal(preview.code, 0, preview.output);
  assert.equal(JSON.parse(preview.stdout).files[0].action, "overwrite");
  writeFileSync(f.target, "user edit");
  const apply = await runCli(["skills", "apply", "--plan", f.planPath], f.sb.env);
  assert.equal(apply.code, 1);
  assert.equal(readFileSync(f.target, "utf8"), "user edit");
});

test("real CLI returns failure for partial rollback conflicts and retains recovery bytes", async t => {
  const f = await fixture(t);
  writeFileSync(f.target, "original");
  assert.equal((await runCli([...f.args, "--allow-overwrite"], f.sb.env)).code, 0);
  const apply = await runCli(["skills", "apply", "--plan", f.planPath], f.sb.env);
  assert.equal(apply.code, 0, apply.output);
  const receipt = JSON.parse(apply.stdout).receipt;
  writeFileSync(f.target, "user edit");
  const rollback = await runCli(["skills", "rollback", "--receipt", receipt], f.sb.env);
  assert.equal(rollback.code, 1, rollback.output);
  const report = JSON.parse(rollback.stdout);
  assert.equal(report.status, "conflict");
  assert.equal(report.outcomes.find(outcome => outcome.path === f.target).status, "conflict");
  assert.equal(readFileSync(f.target, "utf8"), "user edit");
  assert.equal(Buffer.from(JSON.parse(readFileSync(receipt, "utf8")).entries[0].beforeBody, "base64").toString(), "original");
});

test("real CLI rejects missing duplicate extra and offline arguments without side effects", async t => {
  const f = await fixture(t);
  for (const args of [
    ["skills"], ["skills", "run"], ["skills", "preview"], ["skills", "apply"],
    ["skills", "rollback"], ["skills", "apply", "--plan"], ["skills", "apply", "--plan", ""],
    ["skills", "apply", "--plan", f.planPath, "--allow-overwrite"],
    [...f.args, "--plan", f.planPath], [...f.args, "--offline"], [...f.args, "extra"],
    ["skills", "preview", "--package", f.packagePath, "--plan", f.planPath],
  ]) {
    const result = await runCli(args, f.sb.env);
    assert.equal(result.code, 2, JSON.stringify({ args, result }));
  }
  for (const args of [
    ["skills", "apply", "--plan", f.planPath],
    ["skills", "rollback", "--receipt", join(f.root, "missing.json")],
    ["skills", "preview", "--package", "https://offline.invalid/export.json", "--destination-root", f.root, "--plan", f.planPath],
  ]) assert.equal((await runCli(args, f.sb.env)).code, 1);
  assert.deepEqual(readdirSync(f.root), []);
  assert.equal(existsSync(f.sb.env.SKILLAR_HOME), false);
});
