import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";
import { fixture, grant } from "./helpers/sync-cloud.mjs";

const { runCloudStep } = await distImport("sync/cloud.js");
const { scanRoot } = await distImport("catalog/scanner.js");

// lstat().mtimeMs is fractional on filesystems with sub-millisecond precision (APFS).
const FRACTIONAL = 1795136000000.789;

function insertSkill(db, uri, mtimeMs) {
  db.prepare(`INSERT INTO skills (uri, root_id, name, digest, manifest_digest, mtime_ms)
    VALUES (?, 'agents', 'frac', 'sha256:a', 'sha256:m', ?)`).run(uri, mtimeMs);
}

async function runUntilSettled(f, limit = 10) {
  let progress;
  for (let i = 0; i < limit; i++) {
    progress = await runCloudStep(f.home, f.source, { fetcher: f.fetcher });
    if (progress.phase !== "queued" && progress.phase !== "busy") return progress;
  }
  return progress;
}

/** Complete the empty initial baseline so later writes flow through live staging. */
async function beginSync(f) {
  const first = await runCloudStep(f.home, f.source, { fetcher: f.fetcher });
  assert.equal(first.phase, "queued");
}

/** Recursively collect every uploaded value under the given key from request bodies. */
function uploadedValues(calls, key) {
  const found = [];
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") {
      if (key in value) found.push(value[key]);
      Object.values(value).forEach(walk);
    }
  };
  for (const call of calls) {
    if (typeof call.body !== "string" || !call.body.includes("body")) continue;
    if (!call.path.endsWith("/v1/activity/chunks")) continue;
    const chunk = JSON.parse(call.body);
    walk(JSON.parse(Buffer.from(chunk.body, "base64").toString("utf8")));
  }
  return found;
}

test("fractional mtime_ms is rounded at the local boundary instead of quarantining", async t => {
  const f = await fixture(t);
  await f.setConsent(grant(null));
  await beginSync(f);
  insertSkill(f.db, "skill://local/agents/frac/SKILL.md", FRACTIONAL);
  const progress = await runUntilSettled(f);
  assert.equal(progress.phase, "caught-up");
  const uploaded = uploadedValues(f.calls, "mtime_ms");
  assert.ok(uploaded.length > 0, "the skills row must reach the server");
  for (const value of uploaded) {
    assert.ok(Number.isInteger(value), `uploaded mtime_ms must be an integer, got ${value}`);
    assert.ok(Math.abs(value - FRACTIONAL) <= 1, `rounded value must stay within 1ms, got ${value}`);
  }
});

test("a delete before-image with fractional mtime_ms does not quarantine", async t => {
  const f = await fixture(t);
  await f.setConsent(grant(null));
  await beginSync(f);
  const uri = "skill://local/agents/gone/SKILL.md";
  insertSkill(f.db, uri, FRACTIONAL);
  f.db.prepare("DELETE FROM skills WHERE uri = ?").run(uri);
  const progress = await runUntilSettled(f);
  assert.equal(progress.phase, "caught-up");
});

test("an integer timestamp outside the contract range still quarantines", async t => {
  const f = await fixture(t);
  await f.setConsent(grant(null));
  await beginSync(f);
  insertSkill(f.db, "skill://local/agents/far/SKILL.md", 9e15);
  const progress = await runUntilSettled(f);
  assert.equal(progress.phase, "quarantine");
  assert.equal(progress.code, "invalid_contract:values.mtime_ms:custom");
  assert.ok(!progress.code.includes("9000000000000000"));
});

test("scanRoot records integer mtimeMs", async t => {
  const root = makeTempDir();
  t.after(() => removeDir(root));
  mkdirSync(join(root, "fixture"));
  writeFileSync(join(root, "fixture", "SKILL.md"), "---\nname: fixture\ndescription: Synthetic fixture\n---\nSynthetic instructions");
  const { skills } = await scanRoot({ id: "agents", path: root }, () => {});
  assert.equal(skills.length, 1);
  const mtimeMs = skills[0].entry.mtimeMs;
  assert.ok(Number.isInteger(mtimeMs), `scanned mtimeMs must be an integer, got ${mtimeMs}`);
});
