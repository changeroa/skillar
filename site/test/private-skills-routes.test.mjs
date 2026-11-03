import assert from "node:assert/strict";
import { test } from "node:test";
import { signCookie, SESSION_COOKIE, pkceChallenge } from "../lib/auth.ts";
import { browserPrincipal } from "../lib/activity-auth.ts";
import { issueDeviceGrant, exchangeDeviceGrant } from "../lib/device-auth.ts";
import { onRequest } from "../functions/api/[[path]].ts";
import { activityDb } from "./helpers/activity-db.mjs";
import { PRIVATE_SKILL_MAX_REQUEST_BYTES } from "../../shared/dist/private-skills.js";

const origin = "https://skillar.sh", now = 1_800_000_000;
async function fixture(t) {
  t.mock.method(Date, "now", () => now * 1000);
  const { db, accounts } = await activityDb(t);
  const sid = "private-skills-session".padEnd(43, "s"), sub = "private-skills-person";
  db.prepare("INSERT INTO users VALUES (?,?,'','',?,?)").run(sub, "fixture@example.invalid", now, now);
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(sid, sub, now + 3600);
  const env = {
    GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret",
    SESSION_KEY: "fixture-session-key-at-least-32-characters",
    PUBLIC_ORIGIN: origin, ACCOUNTS: accounts, PRIVATE_SKILLS_ENABLED: "true",
    ACTIVITY_ENABLED: "false", ACTIVITY_INGEST_ENABLED: "true",
  };
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub, sid }, "session", env, now)}`;
  const calls = [];
  env.ACTIVITY_SERVICE = { async fetch(request) {
    calls.push(request);
    return Response.json({ revision: 0, skills: [] });
  } };
  const request = (path = "/api/skills", options = {}) => onRequest({
    env, request: new Request(`${origin}${path}`, {
      method: options.method ?? "GET",
      headers: { cookie, ...options.headers },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  });
  const credential = async scopes => {
    const principal = await browserPrincipal(new Request(`${origin}/api/skills`, { headers: { cookie } }), env);
    const grant = await issueDeviceGrant(principal, scopes, env);
    const result = await exchangeDeviceGrant(grant.grant, env, origin);
    assert.ok(result);
    return result;
  };
  return { db, env, sid, cookie, calls, request, credential };
}

test("private catalog authentication is independent of activity capture and replaces forged headers", async t => {
  // Given
  const f = await fixture(t);
  // When
  const response = await f.request("/api/skills", { headers: {
    "x-skillar-principal": '{"accountId":"foreign"}', authorization: "Bearer attacker",
  } });
  // Then
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revision: 0, skills: [] });
  const forwarded = f.calls[0], principal = JSON.parse(forwarded.headers.get("x-skillar-principal"));
  assert.equal(forwarded.url, "https://activity.internal/v1/private-skills");
  assert.equal(principal.kind, "browser");
  assert.notEqual(principal.accountId, "foreign");
  assert.equal(principal.sessionId, f.sid);
  assert.deepEqual(principal.scopes, ["skills:read", "skills:write"]);
  assert.equal(forwarded.headers.has("cookie"), false);
  assert.equal(forwarded.headers.has("authorization"), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("the independent private feature flag fails closed without a service call", async t => {
  // Given
  const f = await fixture(t);
  delete f.env.PRIVATE_SKILLS_ENABLED;
  // When
  const response = await f.request();
  // Then
  assert.equal(response.status, 404);
  assert.equal(f.calls.length, 0);
});

test("private mutations reject absent or foreign browser origins", async t => {
  // Given
  const f = await fixture(t);
  // When
  const responses = await Promise.all([undefined, "https://foreign.example"].map(value =>
    f.request("/api/skills/search", { method: "POST", body: {},
      headers: { "content-type": "application/json", ...(value ? { origin: value } : {}) } })));
  // Then
  assert.deepEqual(responses.map(response => response.status), [403, 403]);
  assert.equal(f.calls.length, 0);
});

test("logout while the private service is reading cannot release its response", async t => {
  // Given
  const f = await fixture(t);
  f.env.ACTIVITY_SERVICE.fetch = async () => {
    f.db.prepare("DELETE FROM sessions WHERE id=?").run(f.sid);
    return Response.json({ revision: 0, skills: [] });
  };
  // When
  const response = await f.request();
  // Then
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});

test("private device grants forward only a verified token hash and requested private scopes", async t => {
  // Given
  const f = await fixture(t);
  const credential = await f.credential(["skills:read"]);
  // When
  const response = await f.request("/v1/skills", { headers: {
    authorization: `Bearer ${credential.token}`, "x-skillar-principal": '{"accountId":"foreign"}',
  } });
  // Then
  assert.equal(response.status, 200);
  const principal = JSON.parse(f.calls[0].headers.get("x-skillar-principal"));
  assert.equal(principal.kind, "device");
  assert.deepEqual(principal.scopes, ["skills:read"]);
  assert.equal(principal.tokenHash, await pkceChallenge(credential.token));
  assert.equal(JSON.stringify(principal).includes(credential.token), false);
  assert.equal(f.calls[0].headers.has("authorization"), false);
});

test("an activity credential does not acquire private resource authority", async t => {
  // Given
  const f = await fixture(t);
  const credential = await f.credential(["activity:read", "activity:ingest"]);
  // When
  const response = await f.request("/v1/skills", {
    headers: { authorization: `Bearer ${credential.token}` },
  });
  // Then
  assert.equal(response.status, 403);
  assert.equal(f.calls.length, 0);
});

test("private identity is available independently of activity and omits credential material", async t => {
  // Given a private-capable device while activity capture is disabled.
  const f = await fixture(t), credential = await f.credential(["skills:read", "skills:write"]);
  f.env.ACTIVITY_SERVICE.fetch = async request => {
    const principal = JSON.parse(request.headers.get("x-skillar-principal"));
    return Response.json({ accountId: principal.accountId, generation: principal.generation,
      deviceId: principal.deviceId, scopes: principal.scopes });
  };
  // When
  const response = await f.request("/v1/skills/identity", {
    headers: { authorization: `Bearer ${credential.token}` },
  });
  // Then
  assert.equal(response.status, 200);
  const identity = await response.json();
  assert.equal(identity.deviceId, credential.deviceId);
  assert.deepEqual(identity.scopes, ["skills:read", "skills:write"]);
  assert.equal("sessionId" in identity, false);
  assert.equal("tokenHash" in identity, false);
});

test("token revocation during a private read is checked again before release", async t => {
  // Given
  const f = await fixture(t);
  const credential = await f.credential(["skills:read"]);
  f.env.ACTIVITY_SERVICE.fetch = async () => {
    f.db.prepare("UPDATE api_tokens SET revoked_at=?").run(now);
    return Response.json({ revision: 0, skills: [] });
  };
  // When
  const response = await f.request("/v1/skills", {
    headers: { authorization: `Bearer ${credential.token}` },
  });
  // Then
  assert.equal(response.status, 401);
});

test("mixed connector scopes do not change the legacy activity service principal", async t => {
  // Given
  const f = await fixture(t);
  f.env.ACTIVITY_ENABLED = "true";
  const credential = await f.credential(["activity:read", "activity:ingest", "skills:read", "skills:write"]);
  // When
  await f.request("/v1/activity/batches", { method: "POST", body: {}, headers: {
    authorization: `Bearer ${credential.token}`, "content-type": "application/json",
  } });
  // Then
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].headers.get("x-skillar-principal")).scopes,
    ["activity:read", "activity:ingest"]);
});

test("oversized private JSON is rejected before invoking the service", async t => {
  // Given
  const f = await fixture(t);
  // When
  const response = await f.request("/api/skills/search", { method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: { query: "x".repeat(PRIVATE_SKILL_MAX_REQUEST_BYTES) } });
  // Then
  assert.equal(response.status, 413);
  assert.equal(f.calls.length, 0);
});

test("unexpected private backend fields cannot cross the public response boundary", async t => {
  // Given
  const f = await fixture(t);
  f.env.ACTIVITY_SERVICE.fetch = async () => Response.json({ revision: 0, skills: [], secret: "SENTINEL" });
  // When
  const response = await f.request();
  // Then
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("SENTINEL"), false);
});
