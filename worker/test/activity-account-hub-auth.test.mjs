// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { browser, closed, fixture, paths } from "./helpers/activity-account-hub.mjs";

for (const issuer of ["https://events.example.test", "https://events-alias.example.test"]) {
  test(`event replay and socket honor configured deployment origin ${issuer}`, async t => {
    const f = await fixture(t, { origins: {
      PUBLIC_ORIGIN: "https://events.example.test", PUBLIC_ORIGIN_ALIAS: "https://events-alias.example.test",
    } });
    const who = browser({ issuer });
    assert.equal((await f.send(paths.changes, { who })).status, 200);
    const socket = await f.websocket({ who });
    assert.equal(socket.ready.type, "ready");
    assert.equal((await f.send(paths.changes)).status, 403);
    assert.equal((await f.send(paths.changes, {
      who: browser({ issuer: "https://events.example.test.attacker.invalid" }),
    })).status, 403);
  });
}

for (const [name, options, status] of [
  ["foreign private authority", { origin: "https://attacker.invalid" }, 404],
  ["foreign Origin", { headers: { origin: "https://attacker.invalid" } }, 403],
  ["lookalike public Origin", { headers: { origin: "https://skillar.sh.attacker.invalid" } }, 403],
  ["missing principal", { headers: { "x-skillar-principal": "" } }, 401],
  ["extra authority field", { who: browser({ expiry: Number.MAX_SAFE_INTEGER }) }, 400],
  ["forged account", { who: browser({ accountId: "account-b" }) }, 401],
  ["stale generation", { who: browser({ generation: 2 }) }, 401],
  ["forged sid", { who: browser({ sessionId: "x".repeat(40) }) }, 401],
  ["missing read scope", { who: browser({ scopes: ["device:manage"] }) }, 403],
]) test(`private boundary denies ${name}`, async t => {
  // Given server-created principal validation at the real Worker entrypoint.
  const f = await fixture(t);
  // When invalid authority calls an event route.
  const response = await f.send(paths.changes, options);
  // Then neither data nor an upgraded connection is returned.
  assert.equal(response.status, status, await response.text());
});

test("non-event routes return null and account selectors are rejected", async t => {
  // Given the private event router in a containing worker.
  const f = await fixture(t);
  // When unrelated routing or a client-selected tenant is requested.
  const unrelated = await f.send("/not-events");
  const selected = await f.send(`${paths.ws}?accountId=account-b`, { headers: { upgrade: "websocket" } });
  // Then the caller can continue routing and no tenant override is accepted.
  assert.equal(unrelated.status, 418);
  assert.equal(selected.status, 400);
});

test("HTTP renewal requires the connection's same live sid", async t => {
  // Given a connection and a different valid browser session in the same account.
  const f = await fixture(t);
  const socket = await f.websocket();
  const other = browser({ sessionId: "b".repeat(40) });
  await f.seed(other);
  const before = await f.control("inspect");
  // When the other sid attempts to extend the connection's authority.
  const response = await f.send(paths.lease, { who: other, body: { connectionId: socket.connectionId } });
  // Then its valid login cannot renew this connection.
  assert.equal(response.status, 409);
  assert.equal((await f.control("inspect")).attachments[0].expiresAtMs, before.attachments[0].expiresAtMs);
});

test("authenticated revoke closes only the selected sid across multiple connections", async t => {
  // Given two sockets for one sid and another live sid.
  const f = await fixture(t);
  const other = browser({ sessionId: "b".repeat(40) });
  await f.seed(other);
  const a = await f.websocket(), b = await f.websocket(), survivor = await f.websocket({ who: other });
  const closeA = closed(a.socket), closeB = closed(b.socket);
  // When a server-authenticated revoke targets the first sid.
  const response = await f.send(paths.revoke, { body: { sessionId: browser().sessionId } });
  // Then both affected transports close while the other authenticated session survives.
  assert.equal(response.status, 200);
  assert.equal((await closeA).code, 1008);
  assert.equal((await closeB).code, 1008);
  const marker = survivor.messages.next(); survivor.socket.send("ping");
  assert.equal(await marker, "pong");
});

for (const [name, mutation] of [
  ["revoked D1 session", "DELETE FROM sessions"],
  ["changed account generation", "UPDATE accounts SET auth_generation=2"],
  ["revoked account", "UPDATE accounts SET state='revoked'"],
]) test(`alarm closes a ${name} when the revoke RPC was lost`, async t => {
  // Given a hibernated connection whose authority was revoked without any notification.
  const f = await fixture(t);
  const socket = await f.websocket();
  const state = await f.control("inspect");
  assert.ok(state.alarm <= state.now + 300_000);
  await f.evict();
  await f.accounts.prepare(mutation).run();
  const closure = closed(socket.socket);
  // When the durable expiration alarm executes.
  await f.control("alarm");
  // Then reconstructed session authority fails closed without an HTTP request.
  assert.equal((await closure).code, 1008);
  assert.equal((await f.control("inspect")).alarm, null);
});

test("alarm expires the maximum five-minute lease even while D1 session stays valid", async t => {
  // Given an otherwise valid session and an attached lease.
  const f = await fixture(t);
  const socket = await f.websocket();
  const state = await f.control("inspect");
  assert.equal(socket.ready.expiresAtMs, state.now + 300_000);
  await f.control("time", { now: socket.ready.expiresAtMs });
  const closure = closed(socket.socket);
  // When the clock reaches the lease deadline and the native alarm callback runs.
  await f.control("alarm");
  // Then further renewal cannot revive the expired connection.
  assert.equal((await closure).code, 1008);
  assert.equal((await f.send(paths.lease, { body: { connectionId: socket.connectionId } })).status, 409);
});

test("connection and renewal leases never outlive the authoritative session expiry", async t => {
  // Given a session expiring sooner than five minutes.
  const f = await fixture(t);
  const { now } = await f.control("inspect");
  const expires = Math.floor(now / 1000) + 60;
  await f.accounts.prepare("UPDATE sessions SET expires_at=?").bind(expires).run();
  // When the client connects and renews its lease.
  const socket = await f.websocket();
  const response = await f.send(paths.lease, { body: { connectionId: socket.connectionId } });
  // Then both authorities are bounded by that exact D1 expiry.
  assert.equal(socket.ready.expiresAtMs, expires * 1000);
  assert.equal((await response.json()).expiresAtMs, expires * 1000);
  assert.equal((await f.control("inspect")).alarm, expires * 1000);
});

for (const payload of [JSON.stringify({ type: "reauth", sessionId: "b".repeat(40), expiresAtMs: 9e15 }),
  JSON.stringify({ accountId: "account-b", generation: 1, seq: 7, invalidationKind: "report" }),
  new Uint8Array([255, 0, 17])]) {
  test(`unsafe client ${typeof payload === "string" ? payload.slice(0, 30) : "binary message"} cannot renew or publish`, async t => {
    // Given a live connection with a bounded server-issued lease.
    const f = await fixture(t);
    const socket = await f.websocket();
    const closure = closed(socket.socket);
    // When client data attempts reauthentication, publishing or an unsupported binary operation.
    socket.socket.send(payload);
    // Then the unsupported transport input closes without extending its attachment.
    assert.equal((await closure).code, 1008);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM account_changes").first()).n, 0);
  });
}

test("every normal event request rechecks a revoked D1 sid", async t => {
  // Given a live connection whose browser session is deleted.
  const f = await fixture(t);
  const socket = await f.websocket();
  await f.accounts.prepare("DELETE FROM sessions").run();
  // When old server-created authority is reused on all service operations.
  const responses = await Promise.all([
    f.send(paths.changes),
    f.send(paths.ws, { headers: { upgrade: "websocket" } }),
    f.send(paths.stream),
    f.send(paths.lease, { body: { connectionId: socket.connectionId } }),
  ]);
  // Then every request is denied, not only connection establishment.
  assert.deepEqual(responses.map(value => value.status), [401, 401, 401, 401]);
});

for (const route of [paths.revoke, "/__test/direct-revoke"]) {
  test(`deleted sid can self-revoke at ${route}`, async t => {
    // Given logout has deleted the authoritative sid before the private close RPC arrives.
    const f = await fixture(t);
    const socket = await f.websocket();
    await f.accounts.prepare("DELETE FROM sessions").run();
    const closure = closed(socket.socket);
    // When the server-created principal requests only its own sid be closed.
    const response = await f.send(route, { body: { sessionId: browser().sessionId } });
    // Then both the service router and native DO permit close without permitting renewal.
    assert.equal(response.status, 200);
    assert.equal((await closure).code, 1008);
    assert.equal((await f.control("inspect")).attachments.length, 0);
  });

  test(`foreign sid is rejected by self-revocation at ${route}`, async t => {
    // Given another valid session in the same account and a connected socket.
    const f = await fixture(t);
    const other = browser({ sessionId: "b".repeat(40) });
    await f.seed(other);
    const socket = await f.websocket({ who: other });
    // When a private principal claims authority to revoke a different sid.
    const response = await f.send(route, { body: { sessionId: other.sessionId } });
    // Then that sid survives and the self-only boundary rejects the request.
    assert.equal(response.status, 403);
    const marker = socket.messages.next(); socket.socket.send("ping");
    assert.equal(await marker, "pong");
  });

  test(`deleted sid cannot revoke using stale account generation at ${route}`, async t => {
    // Given logout authority whose account generation has since changed.
    const f = await fixture(t);
    await f.accounts.prepare("DELETE FROM sessions").run();
    await f.accounts.prepare("UPDATE accounts SET auth_generation=2").run();
    // When stale private logout authority reaches either boundary.
    const response = await f.send(route, { body: { sessionId: browser().sessionId } });
    // Then deleted-session allowance does not bypass the live account fence.
    assert.equal(response.status, 401);
  });
}
