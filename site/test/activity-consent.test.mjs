import assert from "node:assert/strict";
import test from "node:test";
import { signCookie, SESSION_COOKIE } from "../lib/auth.ts";
import { activityRequest } from "../lib/activity-routes.ts";
import { activityDb } from "./helpers/activity-db.mjs";

const now = 1_800_000_000;
const origin = "https://skillar.sh";
async function fixture(t) {
  t.mock.method(Date, "now", () => now * 1000);
  const { db, accounts } = await activityDb(t);
  const env = {
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    SESSION_KEY: "fixture-session-key-at-least-32-characters", PUBLIC_ORIGIN: origin,
    ACCOUNTS: accounts, ACTIVITY_ENABLED: "true",
  };
  const user = async sub => {
    const sid = `${sub}-${"s".repeat(40)}`;
    db.prepare("INSERT INTO users VALUES (?,?,'','',?,?)").run(sub, `${sub}@example.com`, now, now);
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(sid, sub, now + 3600);
    const cookie = `${SESSION_COOKIE}=${await signCookie({ sub, sid }, "session", env, now)}`;
    return { sid, cookie };
  };
  const request = (path, { cookie, body, method = "GET", headers = {} } = {}) =>
    activityRequest(new Request(`${origin}${path}`, {
      method, headers: {
        ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}),
        ...(method === "POST" && cookie ? { origin } : {}), ...headers,
      }, ...(body ? { body: JSON.stringify(body) } : {}),
    }), env);
  const connect = async login => {
    const grant = await (await request("/api/devices/grants", {
      ...login, method: "POST", body: { scopes: ["activity:ingest"] },
    })).json();
    const credential = await (await request("/v1/devices/exchange", {
      method: "POST", body: { grant: grant.grant },
    })).json();
    return credential;
  };
  return { db, env, user, request, connect };
}
const grant = deviceId => ({
  mode: "managed-content", version: 1, grantedAtMs: 1,
  scope: { deviceId, projectIds: ["fixture-project"], rootIds: [] },
  serverProcessingAcknowledged: true, contentKinds: ["prompt"],
});

test("consent is local-only until a live browser explicitly grants the owned device", async t => {
  // Given a connected device with no implicit upload consent.
  const f = await fixture(t), user = await f.user("a");
  const device = await f.connect(user);
  const path = `/api/devices/${device.deviceId}/consent`;
  assert.deepEqual(await (await f.request(path, user)).json(), {
    version: 0, consent: { mode: "local-only" },
  });
  // When the browser grants a selected content kind.
  const result = await f.request(path, {
    ...user, method: "POST", body: { baseVersion: 0, consent: grant(device.deviceId) },
  });
  // Then the server stamps live consent time, preserving the independent backfill boundary.
  assert.equal(result.status, 200);
  const saved = await result.json();
  assert.equal(saved.consent.grantedAtMs, now * 1000);
  assert.deepEqual(saved.consent.contentKinds, ["prompt"]);
  assert.deepEqual(await (await f.request(path, user)).json(), saved);
});

test("two consent writers cannot overwrite each other and local-only revokes the latest grant", async t => {
  // Given one base revision and two browser writers.
  const f = await fixture(t), user = await f.user("a"), device = await f.connect(user);
  const path = `/api/devices/${device.deviceId}/consent`;
  const options = { ...user, method: "POST", body: { baseVersion: 0, consent: grant(device.deviceId) } };
  // When both writers submit the same base revision.
  const results = await Promise.all([f.request(path, options), f.request(path, options)]);
  // Then exactly one wins, and a subsequent local-only grant is the authoritative head.
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const revoke = await f.request(path, {
    ...user, method: "POST", body: { baseVersion: 1, consent: { mode: "local-only" } },
  });
  assert.deepEqual(await revoke.json(), { version: 2, consent: { mode: "local-only" } });
  assert.equal(f.db.prepare("SELECT count(*) n FROM device_consents").get().n, 2);
});

test("foreign users and revoked browser sessions cannot read or replace device consent", async t => {
  // Given two independent Google accounts.
  const f = await fixture(t), a = await f.user("a"), b = await f.user("b");
  const device = await f.connect(a), path = `/api/devices/${device.deviceId}/consent`;
  // When another account attempts consent management, then the owner's session is revoked.
  assert.equal((await f.request(path, b)).status, 404);
  assert.equal((await f.request(path, {
    ...b, method: "POST", body: { baseVersion: 0, consent: grant(device.deviceId) },
  })).status, 409);
  f.db.prepare("DELETE FROM sessions WHERE id=?").run(a.sid);
  const revoked = await f.request(path, {
    ...a, method: "POST", body: { baseVersion: 0, consent: grant(device.deviceId) },
  });
  // Then no consent record exists.
  assert.equal(revoked.status, 401);
  assert.equal(f.db.prepare("SELECT count(*) n FROM device_consents").get().n, 0);
});

test("ingest proxy is off by default and replaces every caller-controlled identity header", async t => {
  // Given a real device credential and a service-bound fixture receiver.
  const f = await fixture(t), user = await f.user("a"), device = await f.connect(user);
  const calls = [];
  f.env.ACTIVITY_SERVICE = { fetch: async request => {
    calls.push(request);
    return Response.json({ principal: JSON.parse(request.headers.get("x-skillar-principal")) });
  } };
  const options = { method: "POST", body: { fixture: true }, headers: {
    authorization: `Bearer ${device.token}`, cookie: "do-not-forward",
    "x-skillar-principal": '{"accountId":"attacker"}',
  } };
  assert.equal((await f.request("/v1/activity/chunks", options)).status, 404);
  assert.equal(calls.length, 0);
  f.env.ACTIVITY_INGEST_ENABLED = "true";
  // When the explicitly enabled proxy authenticates and forwards the device request.
  const response = await f.request("/v1/activity/chunks", options);
  const body = await response.json();
  // Then identity is server-created and credentials are not forwarded.
  assert.equal(response.status, 200);
  assert.equal(body.principal.deviceId, device.deviceId);
  assert.notEqual(body.principal.accountId, "attacker");
  assert.equal(calls[0].headers.get("authorization"), null);
  assert.equal(calls[0].headers.get("cookie"), null);
});
