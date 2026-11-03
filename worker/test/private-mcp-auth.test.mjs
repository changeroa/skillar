// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createPrivateMcpAuthFixture as fixture, origin, resource, hash, browser,
} from "./helpers/private-mcp-auth.mjs";

const redirect = "http://127.0.0.1:49152/callback";
const verifier = "native-workerd-pkce-verifier-".repeat(3);
const challenge = createHash("sha256").update(verifier).digest("base64url");

async function register(f) {
  const response = await f.call("public", "/oauth/register", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({
      client_name: "Native workerd client", redirect_uris: [redirect],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none",
    }) });
  assert.equal(response.status, 201);
  assert.equal(response.body.token_endpoint_auth_method, "none");
  return response.body.client_id;
}
function authPath(clientId, changes = {}) {
  const params = { response_type: "code", client_id: clientId, redirect_uri: redirect,
    scope: "skills:read offline_access activity:record", state: "native-state",
    resource, code_challenge: challenge, code_challenge_method: "S256", ...changes };
  for (const key of Object.keys(params)) if (params[key] === null) delete params[key];
  return `/oauth/authorize?${new URLSearchParams(params)}`;
}
async function consent(f, clientId, principal = browser()) {
  const page = await f.call("authorize", authPath(clientId), { principal });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(page.headers.get("content-type"), /^text\/html\b/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  const policy = page.headers.get("content-security-policy");
  assert.ok(policy);
  assert.equal(/[\r\n]/.test(policy), false);
  assert.ok(policy.split(";").some(value => value.trim() === "frame-ancestors 'none'"));
  assert.ok(policy.split(";").some(value => value.trim() === "base-uri 'none'"));
  assert.ok(policy.split(";").some(value => value.trim() ===
    `form-action 'self' ${new URL(redirect).origin}`));
  assert.match(page.text, /<form method="post" action="\/oauth\/authorize">/);
  const recordingInput = /<input\b[^>]*name="recordActivity"[^>]*>/.exec(page.text)?.[0];
  assert.ok(recordingInput);
  assert.doesNotMatch(recordingInput, /\bchecked\b/);
  const handle = /name="handle" value="([^"]+)"/.exec(page.text)?.[1];
  assert.ok(handle, "native consent form supplies a transaction handle");
  const cookies = page.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
  assert.ok(cookies, "native consent sets its browser binding cookie");
  return { handle, cookies };
}
function decide(f, pending, changes = {}, principal = browser(), headers = {}) {
  return f.call("authorize", "/oauth/authorize", { method: "POST", principal,
    headers: { origin, cookie: pending.cookies, "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ handle: pending.handle, decision: "approve", ...changes }).toString() });
}
async function issue(f, recordActivity = false) {
  const clientId = await register(f);
  const pending = await consent(f, clientId);
  const approved = await decide(f, pending, recordActivity ? { recordActivity: "yes" } : {});
  assert.equal(approved.status, 302);
  const location = new URL(approved.headers.get("location"));
  assert.equal(location.origin + location.pathname, redirect);
  assert.equal(location.searchParams.get("state"), "native-state");
  const code = location.searchParams.get("code");
  assert.ok(code);
  const response = await f.token({ grant_type: "authorization_code", client_id: clientId,
    code, redirect_uri: redirect, code_verifier: verifier, resource });
  assert.equal(response.status, 200);
  assert.equal(response.body.token_type.toLowerCase(), "bearer");
  assert.equal(typeof response.body.access_token, "string");
  assert.equal(typeof response.body.refresh_token, "string");
  return { ...response.body, clientId, code };
}

test("native PAT stores only a hash, isolates accounts and defaults to nonrecording", async t => {
  // Given a live independently supplied Google browser principal.
  const f = await fixture(t);
  // When issuing the read-only PAT.
  const issued = await f.pat();
  // Then neither listing nor primary rows disclose the bearer and no recording is enabled.
  assert.match(issued.token, /^skm_[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.connection.recordActivity, false);
  assert.deepEqual(issued.connection.scopes, ["skills:read"]);
  assert.equal(issued.connection.expiresAt - issued.connection.createdAt, 7 * 86400);
  const rows = await f.rows("SELECT * FROM mcp_connections");
  assert.equal(rows[0].token_hash, hash(issued.token));
  assert.equal(JSON.stringify(rows).includes(issued.token), false);
  const listed = await f.manage("GET");
  assert.equal(listed.status, 200);
  assert.equal(JSON.stringify(listed.body).includes(issued.token), false);
  assert.deepEqual((await f.manage("GET", undefined, browser("b"))).body.connections, []);
  assert.equal((await f.manage("DELETE", undefined, browser("b"),
    `/api/mcp/connections/${issued.connection.connectionId}`)).status, 404);
  const validated = await f.authValidate(issued.token);
  assert.equal(validated.userId, "account-a");
  assert.equal(validated.props.recordActivity, false);
  assert.equal(validated.props.principal.tokenHash, hash(issued.token));
  assert.deepEqual(JSON.parse((await f.rows("SELECT consent_json FROM device_consents"))[0].consent_json),
    { mode: "local-only" });
  assert.equal(await f.validate(issued.token, "validate", `${origin}/other`), null);
  assert.equal(await f.validate(`${issued.token}x`), null);
});

for (const [name, sql] of Object.entries({
  expiry: "UPDATE mcp_connections SET expires_at=1",
  account: "UPDATE accounts SET state='revoked' WHERE account_id='account-a'",
  generation: "UPDATE accounts SET auth_generation=2 WHERE account_id='account-a'",
  device: "UPDATE devices SET revoked_at=1",
})) test(`native PAT ${name} fence rejects a previously valid token and cached principal`, async t => {
  // Given a validated native PAT and its cached downstream principal.
  const f = await fixture(t), issued = await f.pat(), cached = await f.validate(issued.token);
  assert.ok(cached);
  // When the primary authority changes without touching a cache.
  await f.db.prepare(sql).run();
  // Then both authorization layers reject immediately.
  assert.equal(await f.validate(issued.token), null);
  assert.equal((await f.call("authority", "/", { principal: cached.props.principal })).status, 401);
});

test("native PAT management revokes the connection and explicit recording alone opts in", async t => {
  // Given explicit managed-content consent on an issued PAT.
  const f = await fixture(t), issued = await f.pat(true);
  assert.equal((await f.validate(issued.token)).props.recordActivity, true);
  assert.ok(issued.connection.scopes.includes("activity:record"));
  assert.equal(JSON.parse((await f.rows("SELECT consent_json FROM device_consents"))[0].consent_json).mode,
    "managed-content");
  // When the owning browser revokes it.
  assert.equal((await f.manage("DELETE", undefined, browser(),
    `/api/mcp/connections/${issued.connection.connectionId}`)).status, 200);
  // Then primary connection/device fences are committed before the response.
  assert.equal(await f.validate(issued.token), null);
  assert.ok((await f.rows("SELECT revoked_at FROM mcp_connections"))[0].revoked_at);
  assert.ok((await f.rows("SELECT revoked_at FROM devices"))[0].revoked_at);
});

test("native PAT validation accepts the freshly issued production credential", async t => {
  // Given a real 201 PAT response from the production authorization service.
  const f = await fixture(t), issued = await f.pat();
  // When the same native service validates its own issued bearer.
  const validated = await f.validate(issued.token);
  // Then it produces a usable primary-backed resource principal.
  assert.ok(validated);
  assert.equal(validated.props.principal.tokenHash, hash(issued.token));
});

test("public HTTP identity forgery never becomes a private browser RPC principal", async t => {
  // Given forged but otherwise live identity values in untrusted public headers/body.
  const f = await fixture(t), clientId = await register(f);
  const headers = { origin, "x-skillar-principal": JSON.stringify(browser()),
    "content-type": "application/json", cookie: `session=${browser().sessionId}` };
  // When using the public fetch surface or calling RPC without independent identity.
  for (const path of [authPath(clientId), "/api/mcp/connections"]) {
    assert.equal((await f.call("public", path, { headers })).status, 404);
  }
  assert.equal((await f.call("manage", "/api/mcp/connections", {
    method: "POST", headers, body: JSON.stringify({ ...browser(), name: "forged" }),
  })).status, 401);
  assert.equal((await f.call("authorize", authPath(clientId), { headers })).status, 401);
  // Then primary storage has no authorized connection or consent.
  assert.deepEqual(await f.rows("SELECT * FROM mcp_connections"), []);
  assert.deepEqual(await f.rows("SELECT * FROM mcp_consents"), []);
});

test("native browser RPC checks live sessions, canonical host, Origin and explicit PAT options", async t => {
  // Given a real primary session and an independent browser principal.
  const f = await fixture(t), body = { name: "PAT", expiresInDays: 1, recordActivity: false };
  // When any required boundary property is invalid.
  assert.equal((await f.manage("POST", body, browser(), undefined, { origin: "https://evil.invalid" })).status, 403);
  assert.equal((await f.call("manage", "/api/mcp/connections", {
    url: "https://evil.invalid/api/mcp/connections", principal: browser(),
  })).status, 421);
  assert.equal((await f.manage("POST", { name: "PAT", expiresInDays: 1 })).status, 400);
  await f.db.prepare("UPDATE sessions SET expires_at=1 WHERE id=?").bind(browser().sessionId).run();
  assert.equal((await f.manage("POST", body)).status, 401);
  // Then no invalid request creates a connection.
  assert.deepEqual(await f.rows("SELECT * FROM mcp_connections"), []);
});

test("native DCR metadata and authorization require S256", async t => {
  // Given native client registration and canonical issuer metadata.
  const f = await fixture(t), clientId = await register(f);
  assert.equal(f.primaryD1, f.db);
  assert.ok(f.runtime);
  const metadata = await f.frontendSend("/.well-known/oauth-authorization-server");
  assert.equal(metadata.status, 200);
  assert.equal(metadata.body.issuer, origin);
  assert.equal(metadata.body.token_endpoint, `${origin}/oauth/token`);
  // When PKCE is missing or downgraded.
  for (const changes of [{ code_challenge: null, code_challenge_method: null },
    { code_challenge_method: "plain" }]) {
    const response = await f.call("authorize", authPath(clientId, changes), { principal: browser() });
    const error = response.status === 302
      ? new URL(response.headers.get("location")).searchParams.get("error") : response.body?.error;
    assert.equal(error, "invalid_request");
  }
  // Then no consent or grant is created.
  assert.deepEqual(await f.rows("SELECT * FROM mcp_consents"), []);
  assert.deepEqual(await f.rows("SELECT * FROM mcp_connections"), []);
});

test("native consent binds handle to Google account and exact session and permits cancellation", async t => {
  // Given a native consent transaction with its provider browser cookie.
  const f = await fixture(t), clientId = await register(f), pending = await consent(f, clientId);
  const saved = (await f.rows("SELECT * FROM mcp_consents"))[0];
  assert.equal(saved.handle_hash, hash(pending.handle));
  assert.equal(saved.session_id, browser().sessionId);
  // When another account or another live session attempts approval.
  for (const principal of [browser("b"), browser("a", "c")]) {
    const rejected = await decide(f, pending, {}, principal);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "invalid_consent");
  }
  // Then only the original browser can cancel, without creating a connection.
  const cancelled = await decide(f, pending, { decision: "deny" });
  assert.equal(cancelled.status, 302);
  assert.equal(new URL(cancelled.headers.get("location")).searchParams.get("error"), "access_denied");
  assert.deepEqual(await f.rows("SELECT * FROM mcp_connections"), []);
  assert.deepEqual(await f.rows("SELECT * FROM mcp_consents"), []);
  assert.equal((await decide(f, pending)).status, 400);
});

test("expired native consent cannot issue a code", async t => {
  // Given a real provider transaction, expired deterministically in the primary DB.
  const f = await fixture(t), pending = await consent(f, await register(f));
  await f.db.prepare("UPDATE mcp_consents SET expires_at=1").run();
  // When approval is submitted.
  const response = await decide(f, pending);
  // Then expiry fences approval independently of the provider cookie.
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "invalid_consent");
  assert.deepEqual(await f.rows("SELECT * FROM mcp_connections"), []);
});

for (const recording of [false, true]) test(`native code exchange validates real tokens; recording=${recording}`, async t => {
  // Given a native DCR/S256/Google-bound consent and code exchange.
  const f = await fixture(t), issued = await issue(f, recording);
  // When validating the actual provider access token through private Service Binding RPC.
  const validated = await f.validate(issued.access_token);
  // Then the primary only stores credential hashes and respects the explicit recording choice.
  assert.ok(validated);
  assert.equal(validated.audience, resource);
  assert.equal(validated.userId, "account-a");
  assert.equal(validated.clientId, issued.clientId);
  assert.equal(validated.props.recordActivity, recording);
  assert.equal(validated.scope.includes("activity:record"), recording);
  const rows = await f.rows("SELECT * FROM mcp_credentials");
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map(row => row.token_hash)),
    new Set([hash(issued.access_token), hash(issued.refresh_token)]));
  for (const secret of [issued.access_token, issued.refresh_token, issued.code]) {
    assert.equal(JSON.stringify(rows).includes(secret), false);
  }
  assert.equal((await f.rows("SELECT oauth_grant_id FROM mcp_connections"))[0].oauth_grant_id !== null, true);
  assert.equal((await f.call("authority", "/", { principal: validated.props.principal })).status, 200);
  assert.equal(await f.validate(issued.access_token, "validate", `${origin}/other`), null);
  assert.equal((await f.token({ grant_type: "authorization_code", client_id: issued.clientId,
    code: issued.code, redirect_uri: redirect, code_verifier: verifier, resource })).status, 400);
});

test("native refresh rotates primary hashes and rejects replay without sleeps", async t => {
  // Given a real offline grant and refresh credential.
  const f = await fixture(t), issued = await issue(f);
  // When refreshing via the native provider.
  const refreshed = await f.token({ grant_type: "refresh_token", client_id: issued.clientId,
    refresh_token: issued.refresh_token, resource });
  assert.equal(refreshed.status, 200);
  // Then new tokens validate and the old refresh credential is fenced in primary storage.
  assert.equal(refreshed.body.refresh_token !== issued.refresh_token, true);
  assert.ok(await f.validate(refreshed.body.access_token));
  const old = (await f.rows("SELECT revoked_at FROM mcp_credentials WHERE token_hash=?", hash(issued.refresh_token)))[0];
  assert.ok(old.revoked_at);
  const replay = await f.token({ grant_type: "refresh_token", client_id: issued.clientId,
    refresh_token: issued.refresh_token, resource });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, "invalid_grant");
});

for (const [name, sql] of Object.entries({
  "access expiry": "UPDATE mcp_credentials SET expires_at=1 WHERE kind='access'",
  "access revocation": "UPDATE mcp_credentials SET revoked_at=1 WHERE kind='access'",
  "connection expiry": "UPDATE mcp_connections SET expires_at=1",
  "grant revocation": "UPDATE mcp_connections SET revoked_at=1",
  "account revocation": "UPDATE accounts SET state='revoked' WHERE account_id='account-a'",
  generation: "UPDATE accounts SET auth_generation=2 WHERE account_id='account-a'",
  device: "UPDATE devices SET revoked_at=1",
})) test(`native OAuth primary ${name} fence rejects stale KV and cached authority`, async t => {
  // Given an actual provider token and cached resource-server principal.
  const f = await fixture(t), issued = await issue(f), cached = await f.validate(issued.access_token);
  assert.ok(cached);
  // When the primary fence changes, leaving the real native KV token untouched.
  await f.db.prepare(sql).run();
  // Then native KV still accepts it, but both primary-backed authorization layers reject it.
  assert.ok(await f.validate(issued.access_token, "nativeValidate"));
  assert.equal(await f.validate(issued.access_token), null);
  assert.equal((await f.call("authority", "/", { principal: cached.props.principal })).status, 401);
  if (!name.startsWith("access")) {
    const refresh = await f.token({ grant_type: "refresh_token", client_id: issued.clientId,
      refresh_token: issued.refresh_token, resource });
    assert.equal(refresh.status, 400);
    assert.equal(refresh.body.error, "invalid_grant");
  }
});

for (const kind of ["access", "refresh"]) test(`native RFC7009 ${kind} revocation commits primary fences`, async t => {
  // Given a real grant and independently validated native credentials.
  const f = await fixture(t), issued = await issue(f), cached = await f.validate(issued.access_token);
  // When the registered public client revokes its issued credential.
  const response = await f.token({ client_id: issued.clientId,
    token: kind === "access" ? issued.access_token : issued.refresh_token, token_type_hint: `${kind}_token` });
  // Then primary access fences reject even previously cached downstream authority.
  assert.equal(response.status, 200);
  assert.equal(await f.validate(issued.access_token), null);
  assert.equal((await f.call("authority", "/", { principal: cached.props.principal })).status, 401);
  const credentials = await f.rows("SELECT kind,revoked_at FROM mcp_credentials");
  assert.ok(credentials.find(row => row.kind === "access").revoked_at);
  if (kind === "refresh") {
    assert.ok(credentials.every(row => row.revoked_at !== null));
    assert.ok((await f.rows("SELECT revoked_at FROM mcp_connections"))[0].revoked_at);
  } else {
    assert.equal(credentials.find(row => row.kind === "refresh").revoked_at, null);
    assert.equal((await f.rows("SELECT revoked_at FROM mcp_connections"))[0].revoked_at, null);
  }
});
