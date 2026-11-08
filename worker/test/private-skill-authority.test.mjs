// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { fixture, packet, browser, device, skillId, uri, now, publishInput } from "./helpers/private-skill-backend.mjs";

test("uppercase UUID input publishes one canonical skill readable by its emitted ID", async t => {
  // Given
  const f = await fixture(t), value = await packet(), id = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
  // When
  const published = await f.send(`/${id.toUpperCase()}/versions`, "POST", publishInput(value));
  const detail = await f.send(`/${id}`);
  // Then
  assert.equal(published.status, 200);
  assert.equal(published.body.skill.skillId, id);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.skill.skillId, id);
});

test("private sync reads its live identity without activity capture or credential material", async t => {
  // Given a private device with independent read capability.
  const f = await fixture(t), who = device();
  // When
  const result = await f.send("/identity", "GET", undefined, who);
  // Then
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    accountId: who.accountId, generation: who.generation, deviceId: who.deviceId, scopes: who.scopes,
  });
  assert.equal(JSON.stringify(result.body).includes(who.tokenHash), false);
  assert.equal("sessionId" in result.body, false);
});

for (const [name, sql] of [
  ["generation", "UPDATE accounts SET auth_generation=2"],
  ["session", "DELETE FROM sessions"],
  ["account", "UPDATE accounts SET state='revoked'"],
]) test(`browser ${name} revocation at final primary CAS commits no version or invalidation`, async t => {
  // Given a valid credential that will be revoked at the actual batch boundary.
  const f = await fixture(t), value = await packet();
  await f.hook({ point: "batch", sql });
  // When publication reaches the final authoritative transaction.
  const result = await f.publish(value);
  // Then the SQL credential fence loses without metadata, even though R2 PUT succeeded.
  assert.equal(result.status, 401);
  assert.deepEqual(await f.rows(f.accounts, "SELECT * FROM private_skills"), []);
  assert.deepEqual(await f.rows(f.accounts, "SELECT * FROM account_control_outbox"), []);
});

for (const [name, sql] of [
  ["token", "UPDATE api_tokens SET revoked_at=1"],
  ["expiry", "UPDATE api_tokens SET expires_at=1"],
  ["device", "UPDATE devices SET revoked_at=1"],
  ["scope", `UPDATE api_tokens SET scopes_json='["activity:ingest"]'`],
  ["non-array scope", `UPDATE api_tokens SET scopes_json='{"scope":"skills:write"}'`],
  ["unknown scope", `UPDATE api_tokens SET scopes_json='["skills:write","device:manage"]'`],
  ["issuer", `UPDATE api_tokens SET issuer='https://wrong.example'`],
  ["audience", `UPDATE api_tokens SET audience='wrong'`],
]) test(`device ${name} revocation is rechecked in the mutation transaction`, async t => {
  // Given a server principal whose live token changes after all byte writes.
  const f = await fixture(t), value = await packet();
  await f.hook({ point: "batch", sql });
  // When the device publishes with its former scopes.
  const result = await f.publish(value, null, device());
  // Then cached scopes, token hash and account identity are insufficient authority.
  assert.equal(result.status, 401);
  assert.equal((await f.rows(f.accounts, "SELECT * FROM private_skills")).length, 0);
});

for (const who of [browser(), device()]) test(`${who.kind} read revocation during R2 never returns bytes`, async t => {
  // Given a stored skill and an authority change triggered by a real R2 GET.
  const f = await fixture(t), value = await packet();
  await f.publish(value);
  await f.hook({ point: "get", sql: who.kind === "browser" ? "DELETE FROM sessions" : "UPDATE api_tokens SET revoked_at=1" });
  // When the resource is fetched.
  const result = await f.send("/resources/read", "POST", { uri: uri(value) }, who);
  // Then output revalidation suppresses the body.
  assert.equal(result.status, 401);
  assert.equal(result.body.body, undefined);
});

test("private routing rejects external authority, wrong actors, origins, scopes and disabled flags", async t => {
  // Given a live principal on a private binding.
  const f = await fixture(t);
  // When routing and principal boundaries are violated.
  const results = [
    await f.send("", "GET", undefined, browser(), { "x-test-origin": "https://public.example" }),
    await f.send("", "GET", undefined, browser(), { "x-test-actor": "account-b" }),
    await f.send("", "GET", undefined, browser(), { origin: "https://other.example" }),
    await f.send("", "GET", undefined, browser("account-a", { issuer: "https://other.example" })),
    await f.send("", "GET", undefined, browser("account-a", { scopes: ["skills:write"] })),
    await f.publish(await packet(), null, browser("account-a", { scopes: ["skills:read"] })),
    await f.send("", "GET", undefined, device("account-a", { tokenHash: "z".repeat(43) })),
  ];
  await f.config({ enabled: "false" });
  const disabled = await f.send("");
  // Then neither a public header nor the wrong catalog actor can grant authority.
  assert.deepEqual(results.map(result => result.status), [404, 403, 403, 403, 403, 403, 401]);
  assert.equal(disabled.status, 404);
});

test("expired browser sessions and token scopes cannot borrow activity ingest permission", async t => {
  // Given expired browser auth and a still-live ingest-only token.
  const f = await fixture(t);
  await f.accounts.prepare("UPDATE sessions SET expires_at=?").bind(now / 1000).run();
  await f.accounts.prepare("UPDATE api_tokens SET scopes_json=?").bind('["activity:read","activity:ingest"]').run();
  // When each credential requests the private catalog.
  const results = [await f.send(""), await f.send("", "GET", undefined, device())];
  // Then both require current, independent private-skill authority.
  assert.deepEqual(results.map(result => result.status), [401, 401]);
});

for (const action of ["head", "pins", "delete"]) test(`${action} rechecks live credential inside final mutation CAS`, async t => {
  // Given a valid head and an authority revocation at the D1 batch boundary.
  const f = await fixture(t), value = await packet();
  const base = (await f.publish(value)).body.skill.head;
  await f.hook({ point: "batch", sql: "DELETE FROM sessions" });
  // When the mutation reaches its final conditional primary statement.
  const result = await f.send(action === "delete" ? `/${skillId}` : `/${skillId}/${action}`,
    action === "delete" ? "DELETE" : "POST",
    action === "delete" ? { base } : { base, targetDigest: value.manifestDigest, ...(action === "pins" ? { pinned: true } : {}) });
  // Then neither revision nor tombstone nor notification changes.
  assert.equal(result.status, 401);
  assert.deepEqual(await f.rows(f.accounts, "SELECT revision,tombstoned FROM private_skills"), [{ revision: 1, tombstoned: 0 }]);
  assert.equal((await f.rows(f.activity, "SELECT * FROM account_changes")).length, 1);
});

test("a new live generation cannot hydrate old generation search or resource authority", async t => {
  // Given a populated generation and its persisted projection.
  const f = await fixture(t), value = await packet();
  await f.publish(value);
  const query = { query: "quartz", mode: "discovery", limit: 5 };
  assert.equal((await f.send("/search", "POST", query)).body.candidates.length, 1);
  await f.accounts.prepare("UPDATE accounts SET auth_generation=2").run();
  // When the same actor serves the newly authenticated generation.
  const who = browser("account-a", { generation: 2 });
  const found = await f.send("/search", "POST", query, who);
  const resource = await f.send("/resources/read", "POST", { uri: uri(value) }, who);
  // Then only current primary generation authority can populate the projection.
  assert.deepEqual(found.body.candidates, []);
  assert.equal(resource.status, 404);
});
