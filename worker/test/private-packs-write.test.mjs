import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fixture, browser } from "./private-packs-fixture.test.mjs";

test("create publishes verified encrypted bytes and exact replay is idempotent", async t => {
  // Given a pack of private, retained skill versions.
  const f = await fixture(t), input = f.create();
  // When the same create is delivered twice.
  const first = await f.send("create", input), replay = await f.send("create", input);
  // Then the published receipt and immutable storage are identical.
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.status, "published");
  assert.equal(first.body.searchable, true);
  assert.deepEqual(replay.body, first.body);
  assert.equal((await f.rows("SELECT * FROM private_pack_versions")).length, 1);
  const [job] = await f.rows("SELECT * FROM private_pack_jobs");
  assert.equal(JSON.stringify(job).includes("PRIVATE_PACK_SCOPE"), false);
  const envelope = await (await f.bucket.get(job.object_key)).json();
  assert.equal(envelope.algorithm, "A256GCM");
  assert.equal(JSON.stringify(envelope).includes("PRIVATE_PACK_SCOPE"), false);
});

test("request IDs reject conflicting definition and operation replays", async t => {
  // Given one completed request.
  const f = await fixture(t), input = f.create();
  const first = await f.send("create", input);
  // When its request ID is reused for different bytes or a different operation.
  const conflict = await f.send("create", { ...input, definition: { ...input.definition, description: "Changed" } });
  const update = await f.send("update", { ...input, uri: first.body.uri, expected_digest: first.body.digest });
  // Then neither replay can reserve a second job.
  assert.equal(conflict.body.error, "request_conflict");
  assert.equal(update.body.error, "request_conflict");
  assert.equal((await f.rows("SELECT * FROM private_pack_jobs")).length, 1);
});

test("updates preserve unchanged revisions and reject stale expected digests durably", async t => {
  // Given the current published digest.
  const f = await fixture(t), input = f.create(), first = await f.send("create", input);
  const update = { ...input, request_id: randomUUID(), uri: first.body.uri, expected_digest: first.body.digest };
  // When unchanged, changed and stale writes target that digest.
  const same = await f.send("update", update);
  const changed = await f.send("update", { ...update, request_id: randomUUID(),
    definition: { ...input.definition, description: "Changed quartz" } });
  const staleInput = { ...update, request_id: randomUUID() };
  const stale = await f.send("update", staleInput);
  // Then unchanged consumes no revision, and stale failure is queryable and stable.
  assert.equal(same.body.unchanged, true);
  assert.equal(same.body.revision, 1);
  assert.equal(changed.body.revision, 2);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "head_conflict");
  assert.equal(stale.body.status, "failed");
  assert.deepEqual((await f.send("update", staleInput)).body, stale.body);
  assert.equal((await f.send("status", { request_id: staleInput.request_id })).body.status, "failed");
  assert.equal((await f.send("status", { request_id: input.request_id })).body.searchable, false);
});

test("transaction abort leaves a real accepted job until exact replay publishes", async t => {
  // Given a native D1 failure after the head mutation.
  const f = await fixture(t), input = f.create();
  await f.db.prepare(`CREATE TRIGGER reject_pack BEFORE INSERT ON private_pack_versions
    BEGIN SELECT RAISE(ABORT,'fixture_failure'); END`).run();
  // When publication reaches that transactional failure.
  const response = await f.send("create", input);
  // Then no searchable fragment exists, while durable bytes can resume on replay.
  assert.equal(response.status, 503);
  const pending = await f.send("status", { request_id: input.request_id });
  assert.equal(pending.body.status, "accepted");
  assert.equal(pending.body.content_durable, true);
  assert.equal(pending.body.searchable, false);
  assert.deepEqual(await f.rows("SELECT * FROM private_pack_heads"), []);
  assert.deepEqual((await f.send("search", { mode: "explicit" })).body.packs, []);
  await f.db.prepare("DROP TRIGGER reject_pack").run();
  assert.equal((await f.send("create", input)).body.status, "published");
});

test("storage failure retains its intent without claiming durable content", async t => {
  // Given a PUT whose response fails after the native R2 write.
  const f = await fixture(t), input = f.create();
  await f.hook({ point: "put", fail: true });
  // When that request is delivered.
  const failed = await f.send("create", input);
  // Then status remains accepted, not published; replay verifies the existing ciphertext.
  assert.equal(failed.status, 503);
  assert.equal((await f.send("status", { request_id: input.request_id })).body.content_durable, false);
  assert.equal((await f.send("create", input)).body.status, "published");
});

test("concurrent writers compare and swap the same expected digest once", async t => {
  // Given two updates based on the same immutable head.
  const f = await fixture(t), input = f.create(), first = await f.send("create", input);
  const updates = ["One", "Two"].map(description => ({
    ...input, request_id: randomUUID(), uri: first.body.uri, expected_digest: first.body.digest,
    definition: { ...input.definition, description },
  }));
  // When both are submitted concurrently to native D1.
  const results = await Promise.all(updates.map(value => f.send("update", value)));
  // Then exactly one new revision is published.
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal((await f.rows("SELECT revision FROM private_pack_heads"))[0].revision, 2);
});

for (const [label, database, sql] of [
  ["session revocation", "ACCOUNTS", "DELETE FROM sessions"],
  ["account revocation", "ACCOUNTS", "UPDATE accounts SET state='revoked'"],
  ["generation change", "ACCOUNTS", "UPDATE accounts SET auth_generation=2"],
  ["tenant closure", "ACTIVITY", "UPDATE tenant_fences SET state='closed'"],
]) test(`${label} during PUT prevents publication`, async t => {
  // Given authority that changes at the actual R2 boundary.
  const f = await fixture(t), input = f.create();
  await f.hook({ point: "put", database, sql });
  // When a pack write crosses that boundary.
  const response = await f.send("create", input);
  // Then no directory or published job escapes.
  assert.ok([401, 403].includes(response.status), JSON.stringify(response.body));
  assert.deepEqual(await f.rows("SELECT * FROM private_pack_heads"), []);
  assert.deepEqual(await f.rows("SELECT * FROM private_pack_jobs WHERE state='published'"), []);
});

test("final native transaction checks tenant generation even after preflight", async t => {
  // Given closure immediately before the publication batch executes.
  const f = await fixture(t), input = f.create();
  await f.hook({ point: "batch", sql: "UPDATE tenant_fences SET generation=2" });
  // When the D1 trigger receives the stale writer.
  const response = await f.send("create", input);
  // Then the native fence rolls back the entire commit.
  assert.equal(response.status, 403);
  assert.deepEqual(await f.rows("SELECT * FROM private_pack_heads"), []);
  assert.deepEqual(await f.rows("SELECT * FROM private_pack_versions"), []);
});

test("cross-account request IDs and write scope do not confer authority", async t => {
  // Given a job belonging to account A.
  const f = await fixture(t), input = f.create();
  await f.send("create", input);
  // When another account or a read-only principal targets it.
  const other = await f.send("status", { request_id: input.request_id },
    browser({ accountId: "account-b", sessionId: "b".repeat(40) }));
  const reader = await f.send("create", f.create(f.definition("reader-pack")), browser({ scopes: ["skills:read"] }));
  const external = await f.send("search", { mode: "explicit" }, browser(), { "x-test-external": "true" });
  // Then identity is service-created, tenant-bound and scope-checked.
  assert.equal(other.status, 404);
  assert.equal(reader.status, 403);
  assert.equal(external.status, 404);
});

test("closed generation cleanup revisits retained intents after a late ciphertext arrival", async t => {
  // Given published ciphertext followed by a closed tenant fence.
  const f = await fixture(t), input = f.create();
  await f.send("create", input);
  const [job] = await f.rows("SELECT * FROM private_pack_jobs");
  const envelope = await (await f.bucket.get(job.object_key)).text();
  await f.db.prepare("UPDATE tenant_fences SET state='closed'").run();
  await f.send("/test/sweep", {});
  await f.bucket.put(job.object_key, envelope);
  // When another cleanup pass observes the same durable intent.
  const swept = await f.send("/test/sweep", {});
  // Then late content is removed without erasing the evidence needed for future passes.
  assert.equal(swept.body.deleted, 1);
  assert.equal(await f.bucket.get(job.object_key), null);
  assert.equal((await f.rows("SELECT * FROM private_pack_jobs")).length, 1);
});
