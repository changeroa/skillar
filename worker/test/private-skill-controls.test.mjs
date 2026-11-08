// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { fixture, packet, browser, device, skillId, now } from "./helpers/private-skill-backend.mjs";

test("skills relay lost ACK retries its real receipt without duplicating changes", async t => {
  // Given a mutation that reaches ACTIVITY but loses its primary relay ACK.
  const f = await fixture(t), value = await packet();
  await f.hook({ point: "ack", fail: true });
  // When the catalog commits and a later dispatcher retries.
  const lost = await f.publish(value);
  assert.equal(lost.status, 503);
  assert.equal((await f.rows(f.accounts, "SELECT * FROM account_control_outbox")).length, 1);
  assert.equal((await f.rows(f.activity, "SELECT * FROM account_changes")).length, 1);
  const retry = await f.relay();
  // Then one durable skills event accompanies one committed directory mutation.
  assert.equal(retry.status, 200);
  assert.deepEqual(await f.rows(f.accounts, "SELECT * FROM account_control_outbox"), []);
  assert.equal((await f.rows(f.activity, "SELECT * FROM account_control_receipts")).length, 1);
  assert.deepEqual(await f.rows(f.activity, "SELECT invalidation_kind FROM account_changes"), [{ invalidation_kind: "skills" }]);
  assert.equal((await f.send(`/${skillId}`)).status, 200);
});

for (const state of ["closed", "stale"]) test(`skills notifications never reopen a ${state} tenant fence`, async t => {
  // Given an existing fence that private browser provisioning must not replace.
  const f = await fixture(t);
  await f.activity.prepare("INSERT INTO tenant_fences VALUES ('account-a',?,?)")
    .bind(state === "stale" ? 2 : 1, state === "closed" ? "closed" : "active").run();
  // When a primary skill commit attempts to relay.
  const published = await f.publish(await packet());
  // Then directory authority commits, but an existing fence is never reopened or regressed.
  assert.equal(published.status, 200);
  assert.deepEqual(await f.rows(f.activity, "SELECT generation,state FROM tenant_fences"),
    [{ generation: state === "stale" ? 2 : 1, state: state === "closed" ? "closed" : "active" }]);
  assert.deepEqual(await f.rows(f.activity, "SELECT * FROM account_changes"), []);
});

test("consent relay still has no-fence behavior on fully migrated schemas", async t => {
  // Given a new browser-only account and a default-consent primary control row.
  const f = await fixture(t);
  await f.accounts.prepare("INSERT INTO account_control_outbox(account_id,generation) VALUES ('account-a',1)").run();
  // When consent is dispatched without a content fence.
  assert.equal((await f.relay()).status, 200);
  // Then no skills provisioning semantics are applied to a P9 consent event.
  assert.deepEqual(await f.rows(f.activity, "SELECT * FROM tenant_fences"), []);
  assert.deepEqual(await f.rows(f.activity, "SELECT * FROM account_changes"), []);
});

for (const [category, limit] of [["search", 120], ["read", 600], ["write", 30]]) {
  test(`${category} fixed-minute admission enforces account and credential boundaries without alarms`, async t => {
    // Given real durable SQLite and two different credentials sharing an account.
    const f = await fixture(t), principals = [browser(), device()];
    // When admission alternates credentials through the account limit and minute changes.
    const first = await f.limits({ category, count: limit + 1, principals, now });
    const other = await f.limits({ category, count: 1, principals: [device("account-a", { tokenHash: "z".repeat(43) })], now });
    const next = await f.limits({ category, count: 1, principals, now: Math.floor(now / 60000) * 60000 + 60000 });
    // Then another credential cannot bypass the account cap, and the exact minute resets admission.
    assert.deepEqual(first.body, { admitted: limit, status: 429, alarm: null });
    assert.deepEqual(other.body, { admitted: 0, status: 429, alarm: null });
    assert.deepEqual(next.body, { admitted: 1, status: 200, alarm: null });
  });
}

test("HTTP search account limit persists through actual catalog object eviction", async t => {
  // Given one actor's admitted native searches with two valid credentials.
  const f = await fixture(t), query = { query: "quartz", mode: "discovery", limit: 5 };
  for (let i = 0; i < 120; i++) {
    assert.equal((await f.send("/search", "POST", query, i % 2 ? browser() : device())).status, 200);
  }
  await f.evict();
  // When a new instance receives another authenticated search.
  const denied = await f.send("/search", "POST", query);
  // Then hibernation/eviction does not erase the account's durable rate state.
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get("retry-after")) > 0);
});
