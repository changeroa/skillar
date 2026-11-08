// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { fixture, now, packet } from "./helpers/activity-deletion.mjs";

test("remote erasure revokes access before clearing tenant data and preserves Google status access", async t => {
  // Given private content and a different tenant with an identical source identifier.
  const f = await fixture(t), value = await packet("PRIVATE_BODY");
  assert.equal((await f.publish(value)).status, 200);
  await f.seed("account-b");
  for (const account of ["account-a", "account-b"]) {
    await f.activity.prepare(`INSERT INTO session_facts
      VALUES(?,1,'device','source','same-id',1,?,'claude',0,NULL)`)
      .bind(account, JSON.stringify({ sentinel: `${account}-PRIVATE` })).run();
  }
  await f.bucket.put("activity/account-a/1/unreferenced", "PRIVATE_ORPHAN");
  await f.bucket.put("activity/account-b/1/unreferenced", "OTHER_ACCOUNT");
  // When the owning Google session explicitly erases its remote data.
  const response = await f.erase();
  assert.equal(response.status, 202, await response.clone().text());
  // Then only that account is fenced; its status remains accessible and honest.
  const { deletion } = await response.json();
  assert.equal(deletion.state, "live_purge_complete");
  assert.equal(deletion.physicalPending, true);
  assert.equal(deletion.localCopies, "not_deleted");
  assert.equal(deletion.externalCopies, "not_controlled");
  assert.equal((await f.status()).status, 200);
  assert.equal((await f.accounts.prepare("SELECT state FROM accounts WHERE account_id='account-a'").first()).state, "revoked");
  assert.equal((await f.activity.prepare("SELECT state FROM tenant_fences WHERE account_id='account-a'").first()).state, "closed");
  assert.equal(await f.activity.prepare("SELECT 1 FROM session_facts WHERE account_id='account-a'").first(), null);
  assert.notEqual(await f.activity.prepare("SELECT 1 FROM session_facts WHERE account_id='account-b'").first(), null);
  assert.equal((await f.bucket.list({ prefix: "private-skills/account-a/" })).objects.length, 0);
  assert.equal(await f.bucket.head("activity/account-a/1/unreferenced"), null);
  assert.notEqual(await f.bucket.head("activity/account-b/1/unreferenced"), null);
  const stale = await f.send("/v1/private-skills", undefined, {
    "x-skillar-principal": JSON.stringify(f.owner.principal),
  }, "GET");
  assert.equal(stale.status, 401);
});

test("anonymous, foreign-origin and stale-generation requests cannot create a deletion intent", async t => {
  // Given a live Google account without a deletion request.
  const f = await fixture(t);
  // When untrusted callers attempt the destructive endpoint.
  const anonymous = await f.send("/api/activity/deletion", { generation: 1, confirmation: "DELETE" },
    { origin: "https://skillar.sh" });
  const foreign = await f.send("/api/activity/deletion", { generation: 1, confirmation: "DELETE" },
    { cookie: f.owner.cookie, origin: "https://attacker.invalid" });
  const stale = await f.erase(2);
  const forged = await f.send("/v1/activity/deletions/reconcile", { accountId: "account-a", generation: 1 });
  // Then no intent or content fence changes.
  assert.deepEqual([anonymous.status, foreign.status, stale.status, forged.status], [401, 403, 409, 403]);
  assert.equal(await f.accounts.prepare("SELECT 1 FROM activity_deletions").first(), null);
  assert.equal((await f.accounts.prepare("SELECT state FROM accounts").first()).state, "active");
});

test("late PUT and restored shard data cannot survive ledger replay", async t => {
  // Given a completed live purge and a retained independent ledger.
  const f = await fixture(t);
  assert.equal((await f.send("/test/key", {})).status, 200);
  assert.equal((await f.send("/test/read-key", {})).status, 200);
  const oldKey = await f.activity.prepare("SELECT wrapped_key_json FROM account_content_keys")
    .first("wrapped_key_json");
  assert.equal((await f.erase()).status, 202);
  const first = (await (await f.status()).json()).deletion;
  const later = now + 86400000;
  await f.send("/test/clock", { now: later });
  await f.activity.prepare("UPDATE tenant_fences SET state='active' WHERE account_id='account-a'").run();
  await f.activity.prepare(`INSERT INTO session_facts
    VALUES('account-a',1,'device','source','restored',1,'{"secret":"RESTORED"}','claude',0,NULL)`).run();
  await f.activity.prepare(`INSERT INTO account_content_keys
    (account_id,generation,key_version,wrapped_key_json) VALUES('account-a',1,'1',?)`)
    .bind(oldKey).run();
  await f.bucket.put("activity/account-a/1/late", "LATE_PRIVATE_BYTES");
  // When the current ledger is reapplied before restoring traffic.
  await f.reconcile({ now: later });
  // Then neither restored projections/keys nor late bytes are usable or retained.
  assert.equal(await f.activity.prepare("SELECT 1 FROM session_facts").first(), null);
  assert.equal(await f.activity.prepare("SELECT 1 FROM account_content_keys").first(), null);
  assert.equal(await f.bucket.head("activity/account-a/1/late"), null);
  assert.equal((await f.activity.prepare("SELECT state FROM tenant_fences").first()).state, "closed");
  assert.equal((await f.send("/test/read-key", {})).status, 403);
  const final = (await (await f.status()).json()).deletion;
  assert.equal(final.state, "live_purge_complete");
  assert.ok(final.backupExpiresAtMs > first.backupExpiresAtMs);
});

test("primary restore replays the latest ledger rather than reviving an account", async t => {
  // Given a deleted generation and a restore that brought its authority row back.
  const f = await fixture(t);
  await f.erase();
  await f.accounts.prepare("UPDATE accounts SET state='active',auth_generation=1").run();
  await f.accounts.prepare("UPDATE devices SET revoked_at=NULL").run();
  // When the independent current ledger is reconciled.
  await f.reconcile();
  // Then restored credentials cannot reactivate the generation.
  const account = await f.accounts.prepare("SELECT state,auth_generation FROM accounts").first();
  assert.deepEqual(account, { state: "revoked", auth_generation: 2 });
  assert.notEqual((await f.accounts.prepare("SELECT revoked_at FROM devices").first()).revoked_at, null);
  assert.equal((await f.accounts.prepare("SELECT count(*) n FROM activity_deletions").first()).n, 1);
});

test("backup expiry is measured after live purge and repeated requests are idempotent", async t => {
  // Given an erased account whose Google identity still owns its status.
  const f = await fixture(t);
  await f.erase();
  const first = (await (await f.status()).json()).deletion;
  await f.erase();
  // When the maximum documented backup horizon has elapsed without new copies.
  await f.reconcile({ now: first.backupExpiresAtMs });
  // Then only the backup phase advances; the original request and generation stay fixed.
  const last = (await (await f.status()).json()).deletion;
  assert.equal(last.state, "backup_expired");
  assert.equal(last.physicalPending, false);
  assert.equal(last.requestedAtMs, first.requestedAtMs);
  assert.equal((await f.accounts.prepare("SELECT auth_generation FROM accounts").first()).auth_generation, 2);
});

test("storage failure stays pending and resumes without repeating the deletion intent", async t => {
  // Given a live tenant object and storage that fails at its actual DELETE boundary.
  const f = await fixture(t);
  await f.bucket.put("activity/account-a/1/pending", "PRIVATE");
  await f.send("/test/fault", { failDelete: true });
  // When erasure cannot finish and a later reconciliation resumes.
  assert.equal((await f.erase()).status, 503);
  const partial = (await (await f.status()).json()).deletion;
  assert.equal(partial.state, "access_revoked");
  assert.equal(partial.physicalPending, true);
  await f.send("/test/fault", {});
  await f.reconcile();
  // Then the durable request survives, and only a verified live purge advances.
  assert.equal(await f.bucket.head("activity/account-a/1/pending"), null);
  assert.equal((await (await f.status()).json()).deletion.state, "live_purge_complete");
  assert.equal((await f.accounts.prepare("SELECT count(*) n FROM activity_deletions").first()).n, 1);
});

test("bounded child deletion never removes a still-referenced report parent", async t => {
  // Given a valid queued report with more children than one cleanup row budget.
  const f = await fixture(t);
  await f.activity.prepare(`INSERT INTO report_jobs
    (account_id,generation,device_id,source_domain,job_id,request_hash,scope_json,
      request_bytes,request_chunks,input_sequence,input_cut,input_runtime_sequence,
      input_runtime_captured_at,analysis_version,state,created_at,expires_at)
    VALUES('account-a',1,'device','source','job',?,'{}',3,3,1,1,1,0,1,'queued',?,?)`)
    .bind("a".repeat(64), now, now + 86400000).run();
  for (let part = 0; part < 3; part++) {
    const key = `activity/account-a/1/reports/fixture/${part}`;
    await f.activity.prepare(`INSERT INTO report_objects
      (account_id,generation,device_id,source_domain,job_id,role,part,plaintext_hash,
        bytes,object_key,key_version,state,created_at,expires_at)
      VALUES('account-a',1,'device','source','job','request',?,?,1,?,1,'writing',?,?)`)
      .bind(part, "a".repeat(64), key, now, now + 86400000).run();
    await f.bucket.put(key, "x");
  }
  await f.send("/test/fault", { unavailable: true });
  assert.equal((await f.erase()).status, 503);
  await f.send("/test/fault", {});
  // When cleanup runs through explicit bounded resumptions.
  await f.reconcile({ rowLimit: 1, objectLimit: 1 });
  assert.notEqual(await f.activity.prepare("SELECT 1 FROM report_jobs").first(), null);
  await f.reconcile({ rowLimit: 1, objectLimit: 1 });
  await f.reconcile({ rowLimit: 1, objectLimit: 1 });
  // Then the parent disappears only after its last child and all bytes are purged.
  assert.equal(await f.activity.prepare("SELECT 1 FROM report_jobs").first(), null);
  assert.equal(await f.activity.prepare("SELECT 1 FROM report_objects").first(), null);
  assert.equal((await f.bucket.list({ prefix: "activity/account-a/" })).objects.length, 0);
});
