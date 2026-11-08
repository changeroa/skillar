import assert from "node:assert/strict";
import {
  chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createPrivateSkillPackage } from "../../shared/dist/private-skill-package.js";
import { distImport } from "./_helpers.mjs";

const { previewSkill } = await distImport("skills/plan.js");
const { applySkill } = await distImport("skills/apply.js");
const { rollbackSkill } = await distImport("skills/rollback.js");

async function fixture(t, overwrite = true) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "skillar-private-race-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root");
  mkdirSync(join(root, "data"), { recursive: true });
  const packet = await createPrivateSkillPackage([
    { path: "SKILL.md", mediaType: "text/markdown", bytes: Buffer.from("installed") },
    { path: "data/asset.bin", mediaType: "application/octet-stream", bytes: Buffer.from([0, 250, 13]) },
  ]);
  const packagePath = join(base, "export.json"), planPath = join(base, "plan.json");
  writeFileSync(packagePath, JSON.stringify({ skillId: "00000000-0000-4000-8000-000000000001",
    version: { digest: packet.manifestDigest, createdAt: 1, pinned: false }, package: packet }));
  if (overwrite) writeFileSync(join(root, "SKILL.md"), "original");
  await previewSkill({ packagePath, destinationRoot: root, planPath, allowOverwrite: overwrite });
  return { base, root, planPath, target: join(root, "SKILL.md"), asset: join(root, "data/asset.bin") };
}

test("detected edits before apply fail preflight without writing recovery or targets", async t => {
  const f = await fixture(t);
  writeFileSync(f.target, "user edit");
  const before = readdirSync(f.root);
  await assert.rejects(applySkill(f.planPath), { code: "target_changed" });
  assert.deepEqual(readdirSync(f.root), before);
  assert.equal(readFileSync(f.target, "utf8"), "user edit");
  assert.equal(existsSync(f.asset), false);
});

test("new files that appear after preview are not overwritten", async t => {
  const f = await fixture(t, false);
  writeFileSync(f.target, "new user file");
  await assert.rejects(applySkill(f.planPath), { code: "target_changed" });
  assert.equal(readFileSync(f.target, "utf8"), "new user file");
});

test("detected edits between operations preserve the edit and restore earlier writes", async t => {
  const f = await fixture(t);
  const result = await applySkill(f.planPath, ({ phase, index }) => {
    if (phase === "before_apply" && index === 1) writeFileSync(f.asset, "user edit");
  });
  assert.equal(result.status, "conflict");
  assert.equal(readFileSync(f.target, "utf8"), "original");
  assert.equal(readFileSync(f.asset, "utf8"), "user edit");
  assert.ok(existsSync(result.receipt));
  assert.equal(result.outcomes.find(item => item.path === f.asset).status, "conflict");
});

test("midway failure rolls back byte equal originals with a retained receipt", async t => {
  const f = await fixture(t);
  const result = await applySkill(f.planPath, ({ phase, index }) => {
    if (phase === "before_apply" && index === 1) throw new Error("injected filesystem failure");
  });
  assert.equal(result.status, "rolled_back");
  assert.equal(readFileSync(f.target, "utf8"), "original");
  assert.equal(existsSync(f.asset), false);
  assert.equal(Buffer.from(JSON.parse(readFileSync(result.receipt, "utf8")).entries[0].beforeBody, "base64").toString(), "original");
  assert.equal((await rollbackSkill(result.receipt)).status, "rolled_back");
});

test("failure after displacement restores the uninstalled original without clobber", async t => {
  const f = await fixture(t);
  const result = await applySkill(f.planPath, ({ phase }) => {
    if (phase === "after_displace") throw new Error("injected link failure");
  });
  assert.equal(result.status, "rolled_back");
  assert.equal(readFileSync(f.target, "utf8"), "original");
  assert.equal(readFileSync(join(dirname(result.receipt), "displaced-0"), "utf8"), "original");
});

test("an occupant appearing after displacement makes no-replace install fail safely", async t => {
  const f = await fixture(t);
  const result = await applySkill(f.planPath, ({ phase }) => {
    if (phase === "after_displace") writeFileSync(f.target, "new occupant", { flag: "wx" });
  });
  assert.equal(result.status, "conflict");
  assert.equal(readFileSync(f.target, "utf8"), "new occupant");
  assert.equal(readFileSync(join(dirname(result.receipt), "displaced-0"), "utf8"), "original");
  assert.equal(existsSync(f.asset), false);
});

test("a detected edit to displaced bytes is retained and never replaced by package data", async t => {
  const f = await fixture(t);
  const result = await applySkill(f.planPath, ({ phase }) => {
    if (phase === "after_displace") {
      const recovery = readdirSync(f.root).find(name => name.startsWith(".skillar-private-"));
      writeFileSync(join(f.root, recovery, "displaced-0"), "late edit");
    }
  });
  assert.equal(result.status, "conflict");
  assert.equal(readFileSync(f.target, "utf8"), "late edit");
  assert.equal(readFileSync(join(dirname(result.receipt), "displaced-0"), "utf8"), "late edit");
  assert.equal(Buffer.from(JSON.parse(readFileSync(result.receipt, "utf8")).entries[0].beforeBody, "base64").toString(), "original");
});

test("edits to an earlier installed file prevent final apply success and survive rollback", async t => {
  const f = await fixture(t);
  const result = await applySkill(f.planPath, ({ phase, index }) => {
    if (phase === "after_apply" && index === 1) writeFileSync(f.target, "later edit");
  });
  assert.equal(result.status, "conflict");
  assert.equal(readFileSync(f.target, "utf8"), "later edit");
  assert.equal(existsSync(f.asset), false);
});

test("changed root and nested ancestor identities are refused before target writes", async t => {
  for (const name of ["root", "data"]) {
    const f = await fixture(t);
    const path = name === "root" ? f.root : join(f.root, "data");
    renameSync(path, `${path}-old`);
    mkdirSync(path);
    await assert.rejects(applySkill(f.planPath), { code: "ancestor_changed" });
    assert.equal(existsSync(f.asset), false);
    assert.equal(existsSync(join(f.root, ".skillar-private")), false);
  }
});

test("ancestor symlink mutation between writes stops apply and reports rollback conflicts", async t => {
  const f = await fixture(t);
  const outside = join(f.base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "asset.bin"), "safe");
  const result = await applySkill(f.planPath, ({ phase, index }) => {
    if (phase === "before_apply" && index === 1) {
      renameSync(join(f.root, "data"), join(f.root, "old-data"));
      symlinkSync(outside, join(f.root, "data"));
    }
  });
  assert.equal(result.status, "conflict");
  assert.equal(readFileSync(join(outside, "asset.bin"), "utf8"), "safe");
  assert.ok(existsSync(result.receipt));
  // Restore the original ancestor, then the same receipt can finish recovery.
  rmSync(join(f.root, "data"));
  renameSync(join(f.root, "old-data"), join(f.root, "data"));
  assert.equal((await rollbackSkill(result.receipt)).status, "rolled_back");
  assert.equal(readFileSync(f.target, "utf8"), "original");
});

test("explicit rollback keeps subsequent edits, replacements and deletions", async t => {
  for (const change of ["edit", "replacement", "delete"]) {
    const f = await fixture(t);
    const applied = await applySkill(f.planPath);
    if (change === "edit") writeFileSync(f.target, "user edit");
    if (change === "replacement") {
      rmSync(f.target);
      writeFileSync(f.target, "installed");
    }
    if (change === "delete") rmSync(f.target);
    const result = await rollbackSkill(applied.receipt);
    assert.equal(result.status, "conflict", change);
    assert.equal(result.outcomes.find(item => item.path === f.target).status, "conflict");
    assert.equal(existsSync(f.asset), false);
    if (change === "delete") assert.equal(existsSync(f.target), false);
    else assert.equal(readFileSync(f.target, "utf8"), change === "edit" ? "user edit" : "installed");
  }
});

test("rollback rechecks edits after its first read before mutating a target", async t => {
  const f = await fixture(t);
  const applied = await applySkill(f.planPath);
  const result = await rollbackSkill(applied.receipt, ({ phase, index }) => {
    if (phase === "before_restore" && index === 0) writeFileSync(f.target, "rollback concurrent edit");
  });
  assert.equal(result.status, "conflict");
  assert.equal(readFileSync(f.target, "utf8"), "rollback concurrent edit");
  assert.equal(existsSync(f.asset), false);
  assert.equal(Buffer.from(JSON.parse(readFileSync(applied.receipt, "utf8")).entries[0].beforeBody, "base64").toString(), "original");
});

test("automatic rollback also preserves edits arriving during restoration", async t => {
  const f = await fixture(t);
  const result = await applySkill(f.planPath, ({ phase, index }) => {
    if (phase === "before_apply" && index === 1) throw new Error("injected failure");
    if (phase === "before_restore" && index === 0) writeFileSync(f.target, "user during rollback");
  });
  assert.equal(result.status, "conflict");
  assert.equal(readFileSync(f.target, "utf8"), "user during rollback");
  assert.ok(existsSync(result.receipt));
});

test("rollback detects edits to targets restored earlier in the same rollback", async t => {
  const f = await fixture(t);
  const applied = await applySkill(f.planPath);
  const result = await rollbackSkill(applied.receipt, ({ phase, index }) => {
    if (phase === "before_restore" && index === 0) writeFileSync(f.asset, "new user file");
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.outcomes.find(item => item.path === f.asset).status, "conflict");
  assert.equal(readFileSync(f.asset, "utf8"), "new user file");
  assert.equal(readFileSync(f.target, "utf8"), "original");
});

test("rollback retains and returns an edit through an open descriptor after displacement", async t => {
  const f = await fixture(t);
  const applied = await applySkill(f.planPath);
  const fd = openSync(f.target, "r+");
  t.after(() => closeSync(fd));
  const result = await rollbackSkill(applied.receipt, ({ phase, index }) => {
    if (phase === "after_rollback_displace" && index === 0) writeFileSync(fd, "late edit");
  });
  assert.equal(result.status, "conflict");
  assert.equal(readFileSync(f.target, "utf8"), "late edit");
  const retained = readdirSync(dirname(applied.receipt)).find(name => name.startsWith("rollback-0-"));
  assert.equal(readFileSync(join(dirname(applied.receipt), retained), "utf8"), "late edit");
});

test("rollback refuses detected metadata edits even when installed bytes still match", async t => {
  for (const change of ["mode", "mtime"]) {
    const f = await fixture(t);
    const applied = await applySkill(f.planPath);
    if (change === "mode") chmodSync(f.target, 0o640);
    else utimesSync(f.target, 1, 1);
    const before = statSync(f.target);
    const result = await rollbackSkill(applied.receipt);
    assert.equal(result.status, "conflict", change);
    assert.equal(readFileSync(f.target, "utf8"), "installed");
    assert.equal(statSync(f.target).mode, before.mode);
    assert.equal(statSync(f.target).mtimeMs, before.mtimeMs);
  }
});
