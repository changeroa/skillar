import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { signCookie, SESSION_COOKIE } from "../lib/auth.ts";
import { browserPrincipal, sourceNamespace } from "../lib/activity-auth.ts";
import { onRequest as api } from "../functions/api/[[path]].ts";
import { onRequest as v1 } from "../functions/v1/[[path]].ts";
import { activityDb } from "./helpers/activity-db.mjs";

const now = 1_800_000_000;
const origin = "https://skillar.sh";
const config = {
  GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret",
  SESSION_KEY: "fixture-session-key-at-least-32-characters", PUBLIC_ORIGIN: origin,
};

async function fixture(t) {
  t.mock.method(Date, "now", () => now * 1000);
  const { db, accounts } = await activityDb(t);
  const env = { ...config, ACCOUNTS: accounts, ACTIVITY_ENABLED: "true" };
  const login = async sub => {
    const sid = `${sub}-${"s".repeat(40)}`;
    db.prepare("INSERT INTO users VALUES (?,?,'','',?,?)").run(sub, `${sub}@example.com`, now, now);
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(sid, sub, now + 3600);
    return { sid, cookie: `${SESSION_COOKIE}=${await signCookie({ sub, sid }, "session", config, now)}` };
  };
  const request = (path, { cookie, body, method = "GET", requestOrigin = origin, ...headers } = {}) => {
    const req = new Request(`${requestOrigin}${path}`, {
      method, headers: {
        ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers,
      }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return (path.startsWith("/v1/") ? v1 : api)({ request: req, env });
  };
  return { db, env, login, request };
}

test("Pages API and v1 routes are routed but remain disabled by default", async t => {
  // Given
  const f = await fixture(t);
  delete f.env.ACTIVITY_ENABLED;
  // When
  const responses = await Promise.all([f.request("/api/activity/status"), f.request("/v1/activity/status")]);
  const routes = JSON.parse(await readFile(new URL("../public/_routes.json", import.meta.url), "utf8"));
  // Then
  assert.deepEqual(responses.map(response => response.status), [404, 404]);
  assert.ok(routes.include.includes("/api/*") && routes.include.includes("/v1/*"));
  assert.ok(routes.include.includes("/auth/*"));
});

test("browser principal reuses the Google account and checks D1 sid revocation per request", async t => {
  // Given
  const f = await fixture(t);
  const user = await f.login("person");
  const first = await f.request("/api/activity/status", user);
  const account = await first.json();
  f.db.prepare("DELETE FROM sessions WHERE id=?").run(user.sid);
  // When
  const revoked = await f.request("/api/activity/status", user);
  // Then
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(account.dashboardConnected, false);
  assert.equal(revoked.status, 401);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 1);
});

test("approved-host cookies cannot cross issuer or accept hostile mutation origins", async t => {
  // Given
  const f = await fixture(t);
  const user = await f.login("person");
  // When
  const wrongIssuer = await f.request("/api/activity/status", { ...user, requestOrigin: "https://site.example.test" });
  const hostile = await f.request("/api/devices/grants", {
    ...user, method: "POST", origin: "https://evil.example", body: { scopes: ["activity:read"] },
  });
  const absent = await f.request("/api/devices/grants", {
    ...user, method: "POST", authorization: "Bearer irrelevant", body: { scopes: ["activity:read"] },
  });
  // Then
  assert.equal(wrongIssuer.status, 401);
  assert.equal(hostile.status, 403);
  assert.equal(absent.status, 401);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM devices").get().n, 0);
});

test("device grant exchange reaches v1 and enforces bearer scope without permitting browser administration", async t => {
  // Given
  const f = await fixture(t);
  const user = await f.login("person");
  const issued = await f.request("/api/devices/grants", {
    ...user, method: "POST", origin, body: { scopes: ["activity:ingest"] },
  });
  const grant = await issued.json();
  // When
  const exchanged = await f.request("/v1/devices/exchange", { method: "POST", body: { grant: grant.grant } });
  const credential = await exchanged.json();
  const denied = await f.request("/v1/activity/status", { authorization: `Bearer ${credential.token}` });
  const admin = await f.request("/api/devices", { authorization: `Bearer ${credential.token}` });
  // Then
  assert.equal(issued.status, 201);
  assert.equal(exchanged.status, 200);
  assert.equal(denied.status, 403);
  assert.equal(admin.status, 401);
});

test("two Google accounts and two devices with identical source IDs have separate tenant namespaces", async t => {
  // Given
  const f = await fixture(t);
  const a = await f.login("a"), b = await f.login("b");
  const principal = async user => browserPrincipal(new Request(`${origin}/api/activity/status`, {
    headers: { cookie: user.cookie },
  }), f.env);
  const pa = await principal(a), pb = await principal(b);
  for (const p of [pa, pb]) {
    for (const device of ["same-device", "second-device"]) {
      f.db.prepare("INSERT INTO devices VALUES (?,?,?,NULL)").run(p.accountId, device, now);
    }
  }
  const source = { deviceId: "same-device", sourceDomain: "same-domain", sourceId: "same-session" };
  // When
  const keys = await Promise.all([
    sourceNamespace(pa, source, f.env.ACCOUNTS),
    sourceNamespace(pb, source, f.env.ACCOUNTS),
    sourceNamespace(pa, { ...source, deviceId: "second-device" }, f.env.ACCOUNTS),
  ]);
  // Then
  assert.equal(new Set(keys).size, 3);
  f.db.prepare("UPDATE devices SET revoked_at=? WHERE account_id=? AND device_id=?")
    .run(now, pa.accountId, source.deviceId);
  assert.equal(await sourceNamespace(pa, source, f.env.ACCOUNTS), null);
  assert.notEqual(await sourceNamespace(pb, source, f.env.ACCOUNTS), null);
});

test("foreign device revoke cannot modify another account and live revoked accounts fail closed", async t => {
  // Given
  const f = await fixture(t);
  const a = await f.login("a"), b = await f.login("b");
  const issued = await f.request("/api/devices/grants", {
    ...b, method: "POST", origin, body: { scopes: ["activity:read"] },
  });
  const device = await issued.json();
  // When
  const denied = await f.request(`/api/devices/${device.deviceId}/revoke`, { ...a, method: "POST", origin });
  f.db.prepare("UPDATE accounts SET state='revoked' WHERE user_sub='b'").run();
  const revoked = await f.request("/api/activity/status", b);
  // Then
  assert.equal(denied.status, 404);
  assert.equal(f.db.prepare("SELECT revoked_at FROM devices WHERE device_id=?").get(device.deviceId).revoked_at, null);
  assert.equal(revoked.status, 401);
});

test("strict routing bodies reject forged tenant identity and oversized JSON before credential mutation", async t => {
  // Given
  const f = await fixture(t);
  const user = await f.login("person");
  // When
  const forged = await f.request("/api/devices/grants", {
    ...user, method: "POST", origin, body: { accountId: "victim", scopes: ["activity:read"] },
  });
  const oversized = await f.request("/api/devices/grants", {
    ...user, method: "POST", origin, body: { scopes: ["x".repeat(5000)] },
  });
  // Then
  assert.equal(forged.status, 400);
  assert.equal(oversized.status, 400);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM devices").get().n, 0);
});

test("logout between browser authentication and grant commit rejects the credential write", async t => {
  // Given
  const f = await fixture(t);
  const user = await f.login("person");
  const accounts = f.env.ACCOUNTS;
  f.env.ACCOUNTS = { ...accounts, batch: queries => {
    f.db.prepare("DELETE FROM sessions WHERE id=?").run(user.sid);
    return accounts.batch(queries);
  } };
  // When
  const response = await f.request("/api/devices/grants", {
    ...user, method: "POST", origin, body: { scopes: ["activity:read"] },
  });
  // Then
  assert.equal(response.status, 401);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM devices").get().n, 0);
});
