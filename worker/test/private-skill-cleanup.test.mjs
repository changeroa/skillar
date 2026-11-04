// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { fixture, packet, skillId, key, now } from "./helpers/private-skills.mjs";

const day = 86400000;
const identity = { accountId: "account-a", generation: 1 };
const versions = f => f.rows(f.accounts, "SELECT * FROM private_skill_versions");
const targets = f => f.rows(f.accounts, "SELECT * FROM private_skill_purges");
const head = result => result.body.skill.head;
async function pin(f, base, value, pinned = true) {
  return f.send(`/${skillId}/pins`, "POST", { base, targetDigest: value.manifestDigest, pinned });
}

test("retirement grants thirty days and keeps current and pinned objects indefinitely", async t => {
  const f = await fixture(t), old = await packet("old"), current = await packet("current");
  const first = await f.publish(old);
  const second = await f.publish(current, head(first));
  await f.sweep({ now: now + 30 * day - 1 });
  assert.equal((await versions(f)).length, 2);
  assert.notEqual(await f.bucket.head(key(old)), null);
  const result = await f.sweep({ now: now + 30 * day });
  assert.equal(result.claimed, 1);
  assert.equal(await f.bucket.head(key(old)), null);
  assert.notEqual(await f.bucket.head(key(current)), null);
  assert.equal((await versions(f)).length, 1);
  assert.equal((await f.publish(old, head(second))).status, 503);
  assert.equal((await f.send(`/${skillId}`)).body.skill.head.digest, current.manifestDigest);
});

test("pin and unpin restart recovery rather than inheriting original publication age", async t => {
  const f = await fixture(t), old = await packet("old"), current = await packet("current");
  let base = head(await f.publish(old));
  base = head(await f.publish(current, base));
  const pinned = await pin(f, base, old);
  assert.equal(pinned.status, 200);
  await f.sweep({ now: now + 100 * day });
  assert.notEqual(await f.bucket.head(key(old)), null);
  await f.config({ now: now + 100 * day });
  await f.accounts.prepare("UPDATE sessions SET expires_at=?").bind((now + 200 * day) / 1000).run();
  const unpinned = await pin(f, head(pinned), old, false);
  assert.equal(unpinned.status, 200);
  await f.sweep({ now: now + 130 * day - 1 });
  assert.notEqual(await f.bucket.head(key(old)), null);
  await f.sweep({ now: now + 130 * day });
  assert.equal(await f.bucket.head(key(old)), null);
  assert.notEqual(await f.bucket.head(key(current)), null);
});

test("migration gives legacy retired versions a fresh recovery window", async t => {
  const f = await fixture(t, { migrate: false }), old = await packet("old"), current = await packet("current");
  const first = await f.publish(old);
  await f.publish(current, head(first));
  await f.install();
  const rows = await versions(f), retired = rows.find(v => v.digest === old.manifestDigest);
  const live = rows.find(v => v.digest === current.manifestDigest);
  assert.ok(retired.retired_at > retired.created_at);
  assert.equal(live.retired_at, null);
  await f.sweep({ now: retired.retired_at + 30 * day - 1 });
  assert.notEqual(await f.bucket.head(key(old)), null);
  await f.sweep({ now: retired.retired_at + 30 * day });
  assert.equal(await f.bucket.head(key(old)), null);
  assert.notEqual(await f.bucket.head(key(current)), null);
});

test("failed upload grace and permanent opaque targets sweep late PUTs again", async t => {
  const f = await fixture(t), value = await packet("orphan");
  await f.hook({ point: "put", fail: true });
  assert.equal((await f.publish(value)).status, 503);
  await f.accounts.prepare("UPDATE private_skill_uploads SET created_at=?").bind(now).run();
  await f.sweep({ now: now + day - 1 });
  assert.notEqual(await f.bucket.head(key(value)), null);
  await f.sweep({ now: now + day });
  assert.equal(await f.bucket.head(key(value)), null);
  assert.deepEqual(await f.rows(f.accounts, "SELECT * FROM private_skill_uploads"), []);
  const saved = await targets(f);
  assert.equal(saved.length, 1);
  assert.ok(!JSON.stringify(saved).includes("SKILL.md"));
  await f.bucket.put(key(value), "late PUT");
  await f.sweep({ now: now + day });
  assert.equal(await f.bucket.head(key(value)), null);
  assert.equal((await targets(f)).length, 1);
});

for (const mode of ["tombstone", "closed", "generation", "absent"]) {
  test(`${mode} cleanup removes private plaintext despite R2 failures and reports live status`, async t => {
    const f = await fixture(t), value = await packet("private body");
    const published = await f.publish(value);
    if (mode === "tombstone") {
      await f.hook({ point: "delete", fail: true });
      assert.equal((await f.send(`/${skillId}`, "DELETE", { base: head(published) })).status, 503);
    } else if (mode === "closed") {
      await f.accounts.prepare("UPDATE accounts SET state='revoked'").run();
    } else if (mode === "generation") {
      await f.accounts.prepare("UPDATE accounts SET auth_generation=2").run();
    } else {
      // Remove only the authority record: no owner data or remote systems.
      await f.accounts.prepare("DELETE FROM api_tokens").run();
      await f.accounts.prepare("DELETE FROM devices").run();
      await f.accounts.prepare("DELETE FROM accounts").run();
    }
    const failing = { ...f.env, ACTIVITY_RAW: {
      delete: async () => { throw new Error("fixture storage unavailable"); },
      head: (...args) => f.bucket.head(...args),
    } };
    const failed = await f.sweep({ now, identity }, failing);
    assert.equal(failed.pending, 1);
    assert.deepEqual(await versions(f), []);
    assert.deepEqual(await f.rows(f.accounts, "SELECT * FROM private_skill_uploads"), []);
    assert.deepEqual(await f.rows(f.accounts, "SELECT name,description,tombstoned FROM private_skills"),
      [{ name: "", description: "", tombstoned: 1 }]);
    assert.equal((await f.status()).physical_pending, true);
    await f.sweep({ now, identity });
    assert.deepEqual(await f.status(), {
      metadata_pending: false, blobs_pending: false, durable_targets: true,
      physical_pending: false, verified_live_purge: true,
    });
    await f.bucket.put(key(value), "PUT completing after verified purge");
    assert.equal((await f.status()).verified_live_purge, false);
    await f.sweep({ now, identity });
    assert.equal((await f.status()).verified_live_purge, true);
  });
}

test("explicit version deletion records a durable target before its successful delete", async t => {
  const f = await fixture(t), old = await packet("old"), current = await packet("current");
  const first = await f.publish(old), second = await f.publish(current, head(first));
  const removed = await f.send(`/${skillId}/versions/${old.manifestDigest}`, "DELETE", { base: head(second) });
  assert.equal(removed.status, 200);
  assert.equal((await targets(f)).length, 1);
  await f.bucket.put(key(old), "late PUT");
  await f.sweep({ now });
  assert.equal(await f.bucket.head(key(old)), null);
  assert.notEqual(await f.bucket.head(key(current)), null);
});

test("claimed versions cannot become head or pinned while byte deletion is in progress", async t => {
  const f = await fixture(t), old = await packet("old"), current = await packet("current");
  const first = await f.publish(old), second = await f.publish(current, head(first));
  let attempted = false;
  const bindings = { ...f.env, ACTIVITY_RAW: {
    async delete(k) {
      if (!attempted) {
        attempted = true;
        const moved = await f.send(`/${skillId}/head`, "POST", {
          base: head(second), targetDigest: old.manifestDigest,
        });
        assert.notEqual(moved.status, 200);
        assert.notEqual((await pin(f, head(second), old)).status, 200);
        assert.equal((await f.publish(old, head(second))).status, 503);
      }
      return f.bucket.delete(k);
    },
    head: (...args) => f.bucket.head(...args),
  } };
  await f.sweep({ now: now + 30 * day }, bindings);
  assert.equal(attempted, true);
  assert.equal(await f.bucket.head(key(old)), null);
  assert.notEqual(await f.bucket.head(key(current)), null);
});

for (const change of ["head", "pin"]) {
  test(`${change} winning before the claim protects its current object`, async t => {
    const f = await fixture(t), old = await packet("old"), current = await packet("current");
    const first = await f.publish(old), second = await f.publish(current, head(first));
    let moved;
    if (change === "head") {
      moved = await f.send(`/${skillId}/head`, "POST", {
        base: head(second), targetDigest: old.manifestDigest,
      });
    } else moved = await pin(f, head(second), old);
    assert.equal(moved.status, 200);
    await f.sweep({ now: now + 30 * day });
    assert.notEqual(await f.bucket.head(key(old)), null);
    assert.equal((await targets(f)).some(row => row.digest === old.manifestDigest), false);
  });
}

for (const change of ["head", "pins", "publish"]) {
  test(`a purge claim between verification and final ${change} CAS cannot resurrect a digest`, async t => {
    const f = await fixture(t), old = await packet("old"), current = await packet("current");
    const first = await f.publish(old), second = await f.publish(current, head(first));
    // The fixture hook executes real SQLite at the exact final batch boundary,
    // after export/PUT verification but before the authoritative mutation.
    await f.hook({
      point: "batch",
      sql: `INSERT INTO private_skill_purges
        (account_id,generation,skill_id,digest,resource_digests_json)
        SELECT account_id,generation,skill_id,digest,
          (SELECT json_group_array(json_extract(value,'$.digest'))
            FROM json_each(manifest_json,'$.resources'))
        FROM private_skill_versions WHERE digest=?`,
      args: [old.manifestDigest],
    });
    const attempted = change === "publish" ? await f.publish(old, head(second)) :
      await f.send(`/${skillId}/${change}`, "POST", {
        base: head(second), targetDigest: old.manifestDigest,
        ...(change === "pins" ? { pinned: true } : {}),
      });
    assert.equal(attempted.status, 503);
    assert.equal((await f.send(`/${skillId}`)).body.skill.head.digest, current.manifestDigest);
    assert.equal((await versions(f)).find(v => v.digest === old.manifestDigest).pinned, 0);
    await f.sweep({ now });
    assert.equal(await f.bucket.head(key(old)), null);
    assert.notEqual(await f.bucket.head(key(current)), null);
  });
}

test("a live late PUT during deletion is pending and retried on the next fair visit", async t => {
  const f = await fixture(t), value = await packet("late upload");
  await f.hook({ point: "put", fail: true });
  await f.publish(value);
  await f.accounts.prepare("UPDATE private_skill_uploads SET created_at=?").bind(now).run();
  let late = true;
  const bindings = { ...f.env, ACTIVITY_RAW: {
    async delete(k) {
      await f.bucket.delete(k);
      if (late) { late = false; await f.bucket.put(k, "PUT completed after DELETE"); }
    },
    head: (...args) => f.bucket.head(...args),
  } };
  assert.equal((await f.sweep({ now: now + day }, bindings)).pending, 1);
  assert.equal((await f.status()).verified_live_purge, false);
  await f.sweep({ now: now + day });
  assert.equal((await f.status()).verified_live_purge, true);
});

test("bounded fair visits recheck late objects without starving later targets", async t => {
  const f = await fixture(t), packets = await Promise.all(["a", "b", "c"].map(marker => packet(marker)));
  let base = null;
  for (const value of packets) base = head(await f.publish(value, base));
  await f.accounts.prepare("UPDATE accounts SET state='revoked'").run();
  for (let i = 0; i < 6; i++) {
    const result = await f.sweep({ now, limit: 1 });
    assert.ok(result.claimed <= 1 && result.visited <= 1 && result.deleted <= 128);
  }
  assert.equal((await targets(f)).length, 3);
  assert.equal((await f.status()).verified_live_purge, true);
  for (const value of packets) await f.bucket.put(key(value), "late");
  for (let i = 0; i < 3; i++) await f.sweep({ now, limit: 1 });
  assert.equal((await f.status()).verified_live_purge, true);
});

test("failed list checks and unexpected prefix objects cannot report verified purge", async t => {
  const f = await fixture(t);
  const failing = { ...f.env, ACTIVITY_RAW: { list: async () => { throw new Error("offline"); } } };
  assert.deepEqual(await f.status(identity, failing), {
    metadata_pending: false, blobs_pending: null, durable_targets: false,
    physical_pending: true, verified_live_purge: false,
  });
  await f.bucket.put("private-skills/account-a/1/unexpected", "unknown bytes");
  assert.equal((await f.status()).physical_pending, true);
});

test("a 512-resource purge persists bounded progress across runs", async t => {
  // Given one legal-sized opaque claim and real R2 objects.
  const f = await fixture(t), digest = "a".repeat(64);
  const resources = Array.from({ length: 512 }, (_, i) => i.toString(16).padStart(64, "0"));
  const prefix = `private-skills/account-a/1/${skillId}/${digest}/`;
  await f.accounts.prepare(`INSERT INTO private_skill_purges
    (account_id,generation,skill_id,digest,resource_digests_json) VALUES(?,?,?,?,?)`)
    .bind("account-a", 1, skillId, digest, JSON.stringify(resources)).run();
  for (const resource of resources) await f.bucket.put(prefix + resource, "fixture");
  // When the cleanup resumes through a resource budget smaller than a version.
  for (let run = 0; run < Math.ceil(resources.length / 40); run++) {
    const result = await f.sweep({ now, objectLimit: 40, identity });
    assert.ok(result.inspectedObjects <= 40);
  }
  // Then the entire version is absent and the cursor is ready for late-PUT scans.
  assert.equal((await f.bucket.list({ prefix, limit: 1 })).objects.length, 0);
  assert.equal((await targets(f))[0].resource_offset, 0);
});
