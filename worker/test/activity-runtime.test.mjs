import assert from "node:assert/strict";
import test from "node:test";
import { context, fixture, grant, packet, principal } from "./helpers/activity-runtime.mjs";

test("runtime revisions pin exact source and immutable active state independently of CDC", async t => {
  // Given identical source rows with two different live states.
  const f = await fixture(t), p = await packet();
  await f.head(); await f.stage(p);
  assert.deepEqual((await f.send("commit", p.commit)).body,
    { sequence: 1, sourceCut: 7, contentHash: p.commit.contentHash });
  const next = await packet(context({ activeRequests: [], ingest: { accepted: 3, rejected: 1, dropped: 0 } }),
    { sequence: 2 });
  await f.stage(next);
  // When the new runtime state commits without any source movement.
  assert.equal((await f.send("commit", next.commit)).status, 200);
  // Then reports can pin either context; latest metadata never touches raw R2.
  const receipts = await f.rows("SELECT sequence,received_at_ms FROM runtime_contexts ORDER BY sequence");
  const first = await f.send("read", { sourceDomain: "source", sequence: 1 });
  assert.deepEqual(first.body, {
    context: context(), sequence: 1, sourceSequence: 3, sourceCut: 7, capturedAtMs: 100,
    receivedAtMs: receipts[0].received_at_ms,
  });
  assert.deepEqual((await f.send("read", { sourceDomain: "source" })).body.context, context({
    activeRequests: [], ingest: { accepted: 3, rejected: 1, dropped: 0 },
  }));
  assert.deepEqual((await f.send("latest", { sourceDomain: "source" })).body,
    { sequence: 2, sourceSequence: 3, sourceCut: 7, capturedAtMs: 100,
      receivedAtMs: receipts[1].received_at_ms });
  const stored = JSON.stringify(await f.rows("SELECT * FROM runtime_contexts"));
  assert.equal(stored.includes("ACTIVE_SECRET"), false);
  assert.equal(stored.includes("ERROR_SECRET"), false);
  assert.equal(JSON.stringify(await f.rows("SELECT * FROM content_uploads")).includes("ACTIVE_SECRET"), false);
});

test("stop and wait accepts exact retries but rejects conflicting sequence, batch and gap", async t => {
  // Given a committed independent sequence.
  const f = await fixture(t), p = await packet();
  await f.head(); await f.stage(p);
  const receipt = await f.send("commit", p.commit);
  // When retrying identical bytes or attempting incompatible revisions.
  assert.deepEqual(await f.send("commit", p.commit), receipt);
  assert.equal((await f.send("commit", { ...p.commit, capturedAtMs: 101 })).body.error, "batch_conflict");
  for (const changes of [{ sequence: 3 }, { sequence: 2, batchId: p.commit.batchId }]) {
    const q = await packet(context(), changes);
    if (q.commit.batchId !== p.commit.batchId) await f.stage(q);
    const result = await f.send("commit", q.commit);
    // Then no gap or batch alias can be accepted.
    assert.equal(result.status, 409, JSON.stringify(result));
  }
  assert.equal((await f.rows("SELECT count(*) n FROM runtime_contexts"))[0].n, 1);
});

for (const [name, consent] of [
  ["partial", grant({ contentKinds: ["prompt"] })],
  ["none", { mode: "local-only" }],
  ["metadata", { ...grant(), mode: "metadata", serverProcessingAcknowledged: undefined, contentKinds: undefined }],
  ["root restricted", grant({ scope: { deviceId: "device-a", projectIds: ["device:device-a"], rootIds: ["root"] } })],
]) {
  test(`runtime commit and read deny ${name} current consent`, async t => {
    // Given retained encrypted inputs from a full grant.
    const f = await fixture(t), p = await packet();
    await f.head(); await f.stage(p); await f.send("commit", p.commit);
    await f.consent(consent);
    // When the current grant no longer covers whole-device runtime.
    const results = await Promise.all([
      f.send("commit", p.commit), f.send("read", { sourceDomain: "source" }),
      f.send("latest", { sourceDomain: "source" }),
    ]);
    // Then neither replay nor raw reads bypass current permission.
    for (const result of results) assert.equal(result.status, 403, JSON.stringify(result));
  });
}

test("foreign identities, missing scopes and revoked device cannot expose runtime", async t => {
  // Given a valid runtime revision.
  const f = await fixture(t), p = await packet();
  await f.head(); await f.stage(p); await f.send("commit", p.commit);
  // When identities or token scopes differ.
  for (const who of [
    principal({ accountId: "account-b" }), principal({ deviceId: "device-b" }),
    principal({ generation: 2 }), principal({ scopes: ["activity:ingest"] }),
    principal({ scopes: ["activity:read"] }),
  ]) {
    assert.equal((await f.send("commit", p.commit, who)).status, 403);
    if (!who.scopes.includes("activity:ingest") && who.scopes.includes("activity:read")) continue;
    assert.notEqual((await f.send("read", { sourceDomain: "source" }, who)).status, 200);
  }
  await f.accounts.prepare("UPDATE devices SET revoked_at=1").run();
  // Then revoked reads are denied even while the shard fence remains active.
  assert.equal((await f.send("read", { sourceDomain: "source" })).status, 403);
});

test("source cut gap is refused and accepted earlier CDC cuts retain their source sequence", async t => {
  // Given a source with a committed head, plus an older accepted receipt.
  const f = await fixture(t), p = await packet(context(), { sourceCut: 6 });
  await f.stage(p);
  assert.equal((await f.send("commit", p.commit)).body.error, "runtime_source_cut");
  await f.db.prepare(`INSERT INTO ingest_receipts VALUES
    ('account-a',1,'device-a','source','prior','hash','{}',1,1,6,'commit',0,'projected',6,1)`).run();
  await f.head();
  // When runtime commits against that prior projected cut.
  assert.equal((await f.send("commit", p.commit)).status, 200);
  // Then sourceSequence identifies the actual receipt rather than the newer head.
  assert.equal((await f.send("read", { sourceDomain: "source" })).body.sourceSequence, 1);
});

test("published initial snapshot cut remains bindable after CDC advances", async t => {
  // Given a published initial cut no longer equal to the CDC head.
  const f = await fixture(t), p = await packet(context(), { sourceCut: 0 });
  await f.db.prepare(`INSERT INTO migration_runs
    (account_id,generation,device_id,source_domain,snapshot_id,begin_json,begin_hash,
      cut,page_count,snapshot_hash,purpose,state)
    VALUES ('account-a',1,'device-a','source','snapshot','{}','hash',0,0,'hash','initial','complete')`).run();
  await f.head(); await f.stage(p);
  // When a revision binds that published cut.
  const result = await f.send("commit", p.commit);
  // Then the independent runtime revision carries sourceSequence zero.
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal((await f.send("read", { sourceDomain: "source" })).body.sourceSequence, 0);
});

test("a context pinned after orphan selection survives the actual P5 claim", async t => {
  // Given uncommitted uploads selected by the orphan sweeper.
  const f = await fixture(t), p = await packet();
  await f.head(); await f.stage(p);
  // When runtime commit occurs at the exact select/claim boundary.
  const result = await f.send("sweepLatePin", { commit: p.commit });
  // Then the real SQL pin suppresses the stale claim, and ordinary sweeps skip the revision.
  assert.equal(result.body.deleted, 0, JSON.stringify(result));
  assert.equal((await f.send("sweep", { orphanBeforeMs: Number.MAX_SAFE_INTEGER })).body.deleted, 0);
  assert.equal((await f.send("read", { sourceDomain: "source" })).status, 200);
  await assert.rejects(f.db.prepare(`INSERT INTO ingest_receipts VALUES
      ('account-a',1,'device-a','source',?,'hash','{}',4,8,8,'reuse',0,'projected',8,1)`)
      .bind(p.commit.batchId).run(), /batch_conflict/);
});

test("closed fence deletes runtime objects and rediscovers a late P5 put", async t => {
  // Given a timed-out encrypted runtime PUT with a surviving P5 intent.
  const f = await fixture(t), p = await packet();
  await f.head(); await f.send("arm");
  assert.notEqual((await f.send("chunk", p.uploads[0])).status, 200);
  await f.db.prepare("UPDATE tenant_fences SET state='closed'").run();
  await f.send("sweep");
  // When that exact PUT completes after the first sweep.
  await f.send("release");
  assert.equal((await f.bucket.list()).objects.length, 1);
  // Then the next sweep discovers it and no runtime receipt can resurrect.
  await f.send("sweep");
  assert.equal((await f.bucket.list()).objects.length, 0);
  assert.equal((await f.send("commit", p.commit)).status, 403);
});

test("read grant revocation during R2 assembly denies raw runtime return", async t => {
  // Given retained runtime and a grant revoked at the exact R2 GET boundary.
  const f = await fixture(t), p = await packet();
  await f.head(); await f.stage(p); await f.send("commit", p.commit);
  // When read assembles context while that revocation completes.
  const result = await f.send("readThenRevoke", { sourceDomain: "source" });
  // Then the final grant check returns no raw context.
  assert.equal(result.status, 403);
  assert.equal(JSON.stringify(result.body).includes("ACTIVE_SECRET"), false);
});

test("final generation fence rolls runtime receipt and chunk pins back together", async t => {
  // Given a fence closure injected between runtime insertion and finalization.
  const f = await fixture(t), p = await packet();
  await f.head(); await f.stage(p);
  await f.db.prepare(`CREATE TRIGGER close_runtime_fence AFTER INSERT ON runtime_contexts
    BEGIN UPDATE tenant_fences SET state='closed' WHERE account_id=NEW.account_id; END`).run();
  // When runtime commits under that racing fence.
  const result = await f.send("commit", p.commit);
  // Then all durable acceptance effects roll back, preserving discoverable P5 intents.
  assert.equal(result.status, 403, JSON.stringify(result));
  assert.equal((await f.rows("SELECT count(*) n FROM runtime_contexts"))[0].n, 0);
  assert.equal((await f.rows("SELECT state FROM content_uploads"))[0].state, "stored");
});

test("runtime metadata preserves signed timestamps accepted by the shared schema", async t => {
  // Given a valid signed capture timestamp and covering grant.
  const f = await fixture(t), p = await packet(context({ capturedAtMs: -10 }),
    { range: { fromMs: -100, toMs: 0 } });
  await f.consent(grant({ grantedAtMs: -100 }));
  await f.head(); await f.stage(p);
  // When the context commits and its metadata is read.
  assert.equal((await f.send("commit", p.commit)).status, 200);
  const result = await f.send("read", { sourceDomain: "source", sequence: 1 });
  // Then storage does not narrow the shared timestamp contract.
  assert.equal(result.status, 200);
  assert.equal(result.body.capturedAtMs, -10);
});
