import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fixture, browser } from "./helpers/activity-dashboard.mjs";
import { principal } from "./helpers/activity-content.mjs";

const path = "/v1/activity/dashboard/eval-cases";
const request = () => ({
  profile: { deviceId: "device-a", sourceDomain: "source" }, requestId: randomUUID(),
  input: { query: "PRIVATE_EVAL 한글\nbytes", expectedUri: "skill://local/private/a/SKILL.md", fromTraceId: "trace-private" },
});
test("explicit eval writes persist idempotent encrypted cloud-owned raw bytes", async t => {
  // Given a current device-wide grant and a stable request id.
  const f = await fixture(t), input = request();
  // When the same explicit write is delivered twice.
  const first = await f.api(path, input), replay = await f.api(path, input);
  // Then the receipt and encrypted object are durable without local snapshot mutations.
  assert.equal(first.status, 201, JSON.stringify(first));
  assert.deepEqual(first, replay);
  const rows = await f.rows("SELECT * FROM dashboard_eval_cases");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "stored");
  assert.equal(JSON.stringify(rows).includes("PRIVATE_EVAL"), false);
  assert.equal(JSON.stringify(rows).includes("trace-private"), false);
  const object = await f.bucket.get(rows[0].object_key);
  const envelope = await object.json();
  assert.equal(envelope.algorithm, "A256GCM");
  assert.equal(JSON.stringify(envelope).includes("PRIVATE_EVAL"), false);
  const decrypted = await f.send("evalDecrypt", rows[0], principal());
  assert.equal(decrypted.body.body, JSON.stringify(input.input));
  assert.equal((await f.rows("SELECT count(*) AS n FROM content_manifests"))[0].n, 0);
  assert.equal((await f.rows("SELECT count(*) AS n FROM migration_pages"))[0].n, 0);
  assert.equal((await f.api(path, { ...input, input: { query: "changed" } })).status, 409);
});

for (const [name, who, sql] of [
  ["foreign tenant", { accountId: "account-b" }],
  ["foreign device", { deviceId: "device-b" }],
  ["old generation", { generation: 2 }],
  ["no read scope", { scopes: ["activity:ingest"] }],
  ["revoked device", {}, "UPDATE devices SET revoked_at=1"],
  ["revoked account", {}, "UPDATE accounts SET state='revoked'"],
  ["changed generation", {}, "UPDATE accounts SET auth_generation=2"],
  ["no consent", {}, "DELETE FROM device_consents"],
  ["local-only consent", {}, "UPDATE device_consents SET consent_json='{\"mode\":\"local-only\"}'"],
  ["metadata consent", {}, "UPDATE device_consents SET consent_json=json_remove(json_set(consent_json,'$.mode','metadata'),'$.contentKinds','$.serverProcessingAcknowledged')"],
  ["wrong project consent", {}, "UPDATE device_consents SET consent_json=json_set(consent_json,'$.scope.projectIds',json('[\"another-project\"]'))"],
  ["missing query consent", {}, "UPDATE device_consents SET consent_json=json_set(consent_json,'$.contentKinds',json('[\"path\"]'))"],
]) test(`eval writes deny ${name} without storing raw objects`, async t => {
  // Given a mismatched principal or revoked current authority.
  const f = await fixture(t);
  if (sql) await f.accounts.prepare(sql).run();
  // When a cloud eval write is requested.
  const response = await f.api(path, request(), principal({ scopes: ["activity:read"], ...who }));
  // Then no durable case or raw object exists.
  assert.equal(response.status, 403, JSON.stringify(response));
  assert.equal((await f.rows("SELECT count(*) AS n FROM dashboard_eval_cases"))[0].n, 0);
  assert.equal((await f.bucket.list()).objects.length, 0);
});

for (const target of ["generation", "device", "consent"]) test(`eval commit is fenced when ${target} changes during PUT`, async t => {
  // Given a current grant with revocation subscribed at the R2 storage boundary.
  const f = await fixture(t), input = request();
  await f.send("evalFencePut", { target });
  // When revocation runs during the awaited encrypted write.
  const response = await f.api(path, input);
  // Then no stored receipt escapes and cleanup can still find every late object.
  assert.equal(response.status, 403, JSON.stringify(response));
  assert.equal((await f.rows("SELECT state FROM dashboard_eval_cases"))[0].state, "writing");
  assert.equal((await f.send("evalSweep", { now: Date.now() })).body.deleted, 1);
  assert.equal((await f.bucket.list()).objects.length, 0);
});

test("query-only consent retains query-only cases without authorizing URI bytes", async t => {
  // Given a device-wide grant restricted to query content.
  const f = await fixture(t);
  await f.accounts.prepare("UPDATE device_consents SET consent_json=json_set(consent_json,'$.contentKinds',json('[\"query\"]'))").run();
  const input = request();
  delete input.input.expectedUri;
  // When a query-only case is stored and the cleanup fence runs.
  const response = await f.api(path, input);
  const sweep = await f.send("evalSweep", { now: Date.now() });
  // Then query-only retention remains valid while an explicit URI write is denied.
  assert.equal(response.status, 201, JSON.stringify(response));
  assert.equal(sweep.body.deleted, 0);
  assert.equal((await f.api(path, request())).status, 403);
});

test("browser principal cannot replace downscoped device authority on eval or report paths", async t => {
  // Given browser authority, not a device principal.
  const f = await fixture(t);
  // When the browser principal is sent to the device-only mutation.
  const response = await f.api(path, request(), browser());
  // Then the strict production parser denies it.
  assert.equal(response.status, 400);
  assert.equal((await f.rows("SELECT count(*) AS n FROM dashboard_eval_cases"))[0].n, 0);
});

test("expired eval replay is denied and cleanup retains late-PUT intents", async t => {
  // Given an upload intent whose R2 PUT times out.
  const f = await fixture(t), input = request();
  await f.send("evalArm", {});
  assert.equal((await f.api(path, input)).status, 503);
  const [row] = await f.rows("SELECT * FROM dashboard_eval_cases");
  assert.equal(row.state, "writing");
  await f.db.prepare("UPDATE dashboard_eval_cases SET expires_at=0").run();
  await f.send("evalSweep", { now: Date.now() });
  await f.send("evalRelease", {});
  assert.notEqual(await f.bucket.get(row.object_key), null);
  // When the recurring sweep revisits the expired durable intent after late arrival.
  const sweep = await f.send("evalSweep", { now: Date.now() });
  // Then R2 is deleted again, the intent survives and replay cannot resurrect the case.
  assert.equal(sweep.body.deleted, 1);
  assert.equal(await f.bucket.get(row.object_key), null);
  assert.equal((await f.rows("SELECT state FROM dashboard_eval_cases"))[0].state, "purged");
  assert.equal((await f.api(path, input)).status, 410);
});

test("consent revocation fences stored replays and cleanup removes ciphertext", async t => {
  // Given a stored case whose consent was subsequently removed.
  const f = await fixture(t), input = request();
  assert.equal((await f.api(path, input)).status, 201);
  await f.accounts.prepare("DELETE FROM device_consents").run();
  // When the stored write is replayed and scheduled cleanup executes.
  const response = await f.api(path, input);
  const sweep = await f.send("evalSweep", { now: Date.now() });
  // Then neither replay nor R2 retention bypasses current consent.
  assert.equal(response.status, 403);
  assert.equal(sweep.body.deleted, 1);
  assert.equal((await f.bucket.list()).objects.length, 0);
});
