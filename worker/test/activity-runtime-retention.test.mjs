import assert from "node:assert/strict";
import test from "node:test";
import { context, fixture, grant, packet } from "./helpers/activity-runtime.mjs";

const day = 86_400_000, received = 1_000_000;
const retention = (contentDays, projectionDays) => ({ contentDays, projectionDays, backupDays: 0 });

for (const policy of [retention(1, 30), retention(30, 1)]) {
  test(`runtime expires at receipt age under current ${JSON.stringify(policy)}`, async t => {
    // Given a historical capture accepted under a longer policy.
    const f = await fixture(t), p = await packet();
    await f.send("clock", { nowMs: received });
    await f.head(); await f.stage(p);
    const receipt = await f.send("commit", p.commit);
    assert.equal(receipt.status, 200);
    await f.consent(grant({ retention: policy }));
    await f.send("clock", { nowMs: received + day - 1 });
    assert.equal((await f.send("read", { sourceDomain: "source", sequence: 1 })).status, 200);
    assert.equal((await f.send("latest", { sourceDomain: "source" })).body.sequence, 1);
    // When the shorter current content/projection policy reaches its exact boundary.
    await f.send("clock", { nowMs: received + day });
    // Then both surfaces stop serving, but exact commit ACKs remain stable.
    assert.equal((await f.send("latest", { sourceDomain: "source" })).body, null);
    assert.equal((await f.send("read", { sourceDomain: "source", sequence: 1 })).body.error, "runtime_missing");
    assert.deepEqual(await f.send("commit", p.commit), receipt);
  });
}

test("a fresh backfill grant reads retained historical runtime without resetting receipt age", async t => {
  // Given runtime captured before the current grant and explicitly reauthorized as history.
  const f = await fixture(t), p = await packet();
  await f.send("clock", { nowMs: received });
  await f.head(); await f.stage(p); await f.send("commit", p.commit);
  await f.consent(grant({ grantedAtMs: 200, retention: retention(1, 1), backfill: {
    version: 1, snapshotId: "historical", journalCut: 7, range: p.commit.range,
  } }));
  // When reading it within the receipt retention window.
  const result = await f.send("read", { sourceDomain: "source", sequence: 1 });
  // Then the historical capture is legal and its receipt age is unchanged.
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.capturedAtMs, 100);
  assert.equal(result.body.receivedAtMs, received);
});

test("runtime reaching expiry during R2 assembly never returns decrypted context", async t => {
  // Given runtime just before the exact expiry boundary.
  const f = await fixture(t), p = await packet();
  await f.consent(grant({ retention: retention(1, 1) }));
  await f.send("clock", { nowMs: received });
  await f.head(); await f.stage(p); await f.send("commit", p.commit);
  // When the fixture advances the clock at the real R2 GET barrier.
  const result = await f.send("readThenExpire", {
    sourceDomain: "source", expireAtMs: received + day,
  });
  // Then final authorization suppresses all raw bytes.
  assert.equal(result.body.error, "runtime_missing");
  assert.equal(JSON.stringify(result).includes("ACTIVE_SECRET"), false);
});

test("bounded runtime cleanup rotates live objects and preserves sequence and batch tombstones", async t => {
  // Given an expired revision behind a live revision in scan order.
  const f = await fixture(t), first = await packet(), second = await packet(context(), { sequence: 2 });
  await f.consent(grant({ retention: retention(1, 1) }));
  await f.send("clock", { nowMs: received });
  await f.head(); await f.stage(first);
  const receipt = await f.send("commit", first.commit);
  await f.send("clock", { nowMs: received + day / 2 });
  await f.stage(second); await f.send("commit", second.commit);
  await f.db.prepare("UPDATE content_uploads SET purge_order=1 WHERE batch_id=?").bind(first.commit.batchId).run();
  await f.send("clock", { nowMs: received + day });
  assert.deepEqual((await f.send("runtimeSweep", { limit: 1 })).body, { scanned: 1, deleted: 0 });
  // When another bounded sweep visits the expired revision.
  assert.deepEqual((await f.send("runtimeSweep", { limit: 1 })).body, { scanned: 1, deleted: 1 });
  // Then bytes are reclaimed without losing exact ACKs, high-watermarks or batch seals.
  assert.equal((await f.bucket.list()).objects.length, 1);
  assert.equal((await f.rows("SELECT count(*) n FROM runtime_contexts"))[0].n, 2);
  assert.equal((await f.send("read", { sourceDomain: "source", sequence: 1 })).body.error, "runtime_missing");
  assert.equal((await f.send("read", { sourceDomain: "source", sequence: 2 })).status, 200);
  assert.deepEqual(await f.send("commit", first.commit), receipt);
  assert.equal((await f.send("chunk", first.uploads[0])).body.error, "content_expired");
  assert.equal((await f.send("commit", { ...first.commit, capturedAtMs: 101 })).body.error, "batch_conflict");
  const next = await packet(context(), { sequence: 3 });
  await f.stage(next);
  assert.equal((await f.send("commit", next.commit)).status, 200);
  await assert.rejects(f.db.prepare(`INSERT INTO ingest_receipts VALUES
    ('account-a',1,'device-a','source',?,'hash','{}',4,8,8,'reuse',0,'projected',8,1)`)
    .bind(first.commit.batchId).run(), /batch_conflict/);
});

test("failed runtime DELETE leaves a terminal intent that retries after consent restoration", async t => {
  // Given runtime whose expired bytes cannot be deleted during the first sweep.
  const f = await fixture(t), p = await packet();
  await f.send("clock", { nowMs: received });
  await f.consent(grant({ retention: retention(1, 1) }));
  await f.head(); await f.stage(p); await f.send("commit", p.commit);
  await f.send("clock", { nowMs: received + day });
  assert.notEqual((await f.send("runtimeSweepFailDelete")).status, 200);
  assert.equal((await f.bucket.list()).objects.length, 1);
  // When consent extends retention and a subsequent sweep can delete.
  await f.consent(grant());
  assert.equal((await f.send("read", { sourceDomain: "source" })).body.error, "runtime_missing");
  assert.equal((await f.send("runtimeSweep")).body.deleted, 1);
  // Then cleanup did not lose its durable deletion intent.
  assert.equal((await f.bucket.list()).objects.length, 0);
  assert.equal((await f.rows("SELECT state FROM content_uploads"))[0].state, "purged");
});

for (const reason of ["consent", "device", "generation", "fence"]) {
  test(`runtime cleanup reclaims ${reason} revocation and rediscovers late PUTs`, async t => {
    // Given a committed runtime and an exact retry paused before R2 PUT completion.
    const f = await fixture(t), p = await packet();
    await f.head(); await f.stage(p); await f.send("commit", p.commit);
    await f.send("arm");
    assert.notEqual((await f.send("chunk", p.uploads[0])).status, 200);
    if (reason === "consent") await f.consent({ mode: "local-only" });
    if (reason === "device") await f.accounts.prepare("UPDATE devices SET revoked_at=1").run();
    if (reason === "generation") await f.accounts.prepare("UPDATE accounts SET auth_generation=2").run();
    if (reason === "fence") await f.db.prepare("UPDATE tenant_fences SET state='closed'").run();
    assert.equal((await f.send("read", { sourceDomain: "source" })).status, 403);
    // When cleanup runs, and the old in-flight encrypted PUT subsequently lands.
    assert.equal((await f.send("runtimeSweep")).body.deleted, 1);
    assert.equal((await f.bucket.list()).objects.length, 0);
    await f.send("release");
    assert.equal((await f.bucket.list()).objects.length, 1);
    // Then terminal intents rediscover that object even after permissions return.
    await f.consent(grant());
    await f.accounts.prepare("UPDATE devices SET revoked_at=NULL").run();
    await f.accounts.prepare("UPDATE accounts SET auth_generation=1").run();
    await f.db.prepare("UPDATE tenant_fences SET state='active'").run();
    assert.equal((await f.send("read", { sourceDomain: "source" })).body.error, "runtime_missing");
    assert.equal((await f.send("latest", { sourceDomain: "source" })).body, null);
    assert.equal((await f.send("runtimeSweep")).body.deleted, 1);
    assert.equal((await f.bucket.list()).objects.length, 0);
    assert.equal((await f.rows("SELECT state FROM content_uploads"))[0].state, "purged");
  });
}
