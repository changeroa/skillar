import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/[[path]].ts";
import { signCookie, SESSION_COOKIE } from "../lib/auth.ts";
import { activityDb } from "./helpers/activity-db.mjs";

const origin = "https://skillar.sh", now = 1_800_000_000;
const profile = { deviceId: "dashboard-device", sourceDomain: "dashboard-source" };
const contentKinds = ["prompt", "query", "args", "error", "path", "span-attributes", "private-skills"];

async function fixture(t) {
  t.mock.method(Date, "now", () => now * 1000);
  const { db, accounts } = await activityDb(t);
  const sid = "s".repeat(43), calls = [];
  const env = {
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    SESSION_KEY: "fixture-session-key-at-least-32-characters", PUBLIC_ORIGIN: origin,
    ACCOUNTS: accounts, ACTIVITY_ENABLED: "true",
  };
  db.prepare("INSERT INTO users VALUES ('a','a@example.com','','',?,?)").run(now, now);
  db.prepare("INSERT INTO sessions VALUES (?,'a',?)").run(sid, now + 3600);
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: "a", sid }, "session", env, now)}`;
  const request = (path, body, headers = {}, method = body === undefined ? "GET" : "POST") =>
    onRequest({ env, request: new Request(`${origin}${path}`, {
      method, headers: { cookie, ...(body === undefined ? {} : {
        origin, "content-type": "application/json",
      }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) });
  await request("/api/dashboard/status");
  const accountId = db.prepare("SELECT account_id FROM accounts WHERE user_sub='a'").get().account_id;
  db.prepare("INSERT INTO devices VALUES (?,?,?,NULL)").run(accountId, profile.deviceId, now);
  env.ACTIVITY_SERVICE = { async fetch(request) {
    const input = await request.json(), identity = JSON.parse(request.headers.get("x-skillar-principal"));
    calls.push({ request, input, identity });
    return Response.json({ error: "report_missing" }, { status: 404 });
  } };
  const consent = async (kinds = contentKinds, backfill) => {
    const result = await request(`/api/devices/${profile.deviceId}/consent`, { baseVersion: 0, consent: {
      mode: "managed-content", version: 1, grantedAtMs: 0, serverProcessingAcknowledged: true,
      scope: { deviceId: profile.deviceId, projectIds: [`device:${profile.deviceId}`], rootIds: [] },
      contentKinds: kinds, ...(backfill === undefined ? {} : { backfill }),
    } });
    assert.equal(result.status, 200);
  };
  return { db, env, sid, calls, request, accountId, consent };
}

test("browser dashboard requires Google session, exact origin and strict body identity", async t => {
  const f = await fixture(t);
  const body = { profile, requestId: crypto.randomUUID(), query: { kind: "stats" } };
  assert.equal((await f.request("/api/dashboard/query", body, { cookie: "" })).status, 401);
  assert.equal((await f.request("/api/dashboard/query", body, { origin: "https://evil.example" })).status, 403);
  assert.equal((await f.request("/api/dashboard/query", { ...body, accountId: "victim" })).status, 400);
  assert.equal((await f.request("/api/dashboard/query", body)).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request("/api/dashboard/query", {
    ...body, profile: { ...profile, deviceId: "foreign-device" },
  })).status, 404);
});

test("report queries downscope browser authority and stamp current consent without forwarding credentials", async t => {
  const f = await fixture(t);
  await f.consent();
  const id = crypto.randomUUID();
  const response = await f.request("/api/dashboard/query", {
    profile, requestId: id, query: { kind: "stats" }, tz: "Asia/Seoul",
  }, { "x-skillar-principal": '{"accountId":"victim"}', authorization: "Bearer attacker" });
  assert.equal(response.status, 404);
  const call = f.calls[0];
  assert.equal(call.request.url, "https://activity.internal/v1/activity/query");
  assert.equal(call.request.headers.get("cookie"), null);
  assert.equal(call.request.headers.get("authorization"), null);
  assert.equal(call.identity.accountId, f.accountId);
  assert.equal(call.identity.kind, "device");
  assert.equal(call.identity.sessionId, null);
  assert.deepEqual(call.identity.scopes, ["activity:read"]);
  assert.deepEqual(call.input, {
    schemaVersion: 1, requestId: id, ...profile, generation: 1, consentVersion: 1,
    projectId: `device:${profile.deviceId}`, rootId: null,
    range: { fromMs: now * 1000, toMs: 8_640_000_000_000_000 }, backfill: null,
    tz: "Asia/Seoul", query: { kind: "stats", filter: {} },
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("historical reports use only the exact explicitly granted snapshot range and cut", async t => {
  const f = await fixture(t);
  const backfill = { version: 3, snapshotId: crypto.randomUUID(), journalCut: 41,
    range: { fromMs: 0, toMs: now * 1000 } };
  await f.consent(contentKinds, backfill);
  await f.request("/api/dashboard/query", { profile, requestId: crypto.randomUUID(), query: { kind: "stats" } });
  assert.deepEqual(f.calls[0].input.range, backfill.range);
  assert.deepEqual(f.calls[0].input.backfill, {
    version: 3, snapshotId: backfill.snapshotId, journalCut: 41,
  });
});

test("partial consent is unavailable to full reports but permits an explicitly saved query eval", async t => {
  const f = await fixture(t);
  f.env.ACTIVITY_INGEST_ENABLED = "true";
  await f.consent(["query"]);
  assert.equal((await f.request("/api/dashboard/query", {
    profile, requestId: crypto.randomUUID(), query: { kind: "stats" },
  })).status, 403);
  const body = { profile, requestId: crypto.randomUUID(), input: { query: "fixture query" } };
  await f.request("/api/dashboard/eval-cases", body);
  assert.equal(f.calls[0].request.url, "https://activity.internal/v1/activity/dashboard/eval-cases");
  assert.deepEqual(f.calls[0].input, body);
});

test("profile discovery uses browser authority and intersects independent ingest kill switches", async t => {
  const f = await fixture(t);
  const metadata = { schemaVersion: 1, ingestEnabled: true, devices: [], profiles: [] };
  f.env.ACTIVITY_SERVICE.fetch = async request => {
    assert.equal(request.url, "https://activity.internal/v1/activity/dashboard/profiles");
    assert.deepEqual(await request.json(), {});
    const principal = JSON.parse(request.headers.get("x-skillar-principal"));
    assert.equal(principal.kind, "browser");
    assert.equal(principal.sessionId, f.sid);
    return Response.json(metadata);
  };
  assert.equal((await (await f.request("/api/dashboard/profiles")).json()).ingestEnabled, false);
  f.env.ACTIVITY_INGEST_ENABLED = "true";
  assert.deepEqual(await (await f.request("/api/dashboard/profiles")).json(), metadata);
});

test("logout during a result read discards the complete protected response", async t => {
  const f = await fixture(t);
  await f.consent();
  f.env.ACTIVITY_SERVICE.fetch = async () => {
    f.db.prepare("DELETE FROM sessions WHERE id=?").run(f.sid);
    return Response.json({ index: 0, bytes: 6, hash: "a".repeat(64), body: "c2VjcmV0" });
  };
  const result = await f.request("/api/dashboard/reports/result", { profile, jobId: crypto.randomUUID(), part: 0 });
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { error: "unauthorized" });
});

test("consent withdrawal or device revocation during a result read discards the response", async t => {
  for (const change of ["consent", "device"]) {
    const f = await fixture(t);
    await f.consent();
    f.env.ACTIVITY_SERVICE.fetch = async () => {
      if (change === "device") f.db.prepare("UPDATE devices SET revoked_at=? WHERE account_id=?")
        .run(now, f.accountId);
      else f.db.prepare(`INSERT INTO device_consents VALUES (?,?,1,2,?,?)`)
        .run(f.accountId, profile.deviceId, '{"mode":"local-only"}', now * 1000);
      return Response.json({ index: 0, bytes: 6, hash: "a".repeat(64), body: "c2VjcmV0" });
    };
    const result = await f.request("/api/dashboard/reports/result", {
      profile, jobId: crypto.randomUUID(), part: 0,
    });
    assert.equal(result.status, change === "device" ? 404 : 409);
    assert.equal((await result.text()).includes("c2VjcmV0"), false);
  }
});

test("source commands require the ingest switch and full owned-device consent", async t => {
  // Given a signed-in owner with only query consent.
  const f = await fixture(t);
  await f.consent(["query"]);
  const body = {
    profile, commandId: crypto.randomUUID(), baseRevision: 12,
    operation: { kind: "eval.add", query: "synthetic source-local query" },
  };
  // When command enqueue crosses the browser boundary.
  assert.equal((await f.request("/api/dashboard/commands", body)).status, 404);
  f.env.ACTIVITY_INGEST_ENABLED = "true";
  assert.equal((await f.request("/api/dashboard/commands", body)).status, 403);
  // Then no source command was forwarded without its authority.
  assert.equal(f.calls.length, 0);
});

test("source command enqueue replaces caller identity and preserves its idempotency key", async t => {
  // Given a managed-content device owned by the current Google session.
  const f = await fixture(t);
  f.env.ACTIVITY_INGEST_ENABLED = "true";
  await f.consent();
  const body = {
    profile, commandId: crypto.randomUUID(), baseRevision: 12,
    operation: { kind: "flow.end", flowId: "synthetic-flow" },
  };
  // When caller-supplied bearer and identity headers accompany the command.
  const response = await f.request("/api/dashboard/commands", body, {
    authorization: "Bearer attacker", "x-skillar-principal": '{"accountId":"victim"}',
  });
  // Then only server-created authority and the exact command request cross the binding.
  assert.equal(response.status, 404);
  const call = f.calls[0];
  assert.equal(call.request.url, "https://activity.internal/v1/activity/commands/enqueue");
  assert.equal(call.request.headers.get("authorization"), null);
  assert.equal(call.request.headers.get("cookie"), null);
  assert.equal(call.identity.accountId, f.accountId);
  assert.deepEqual(call.identity.scopes, ["activity:read"]);
  assert.deepEqual(call.input, body);
});

test("command status is readable with ingest disabled but not after logout during release", async t => {
  // Given an existing command and a valid source profile.
  const f = await fixture(t);
  await f.consent();
  f.env.ACTIVITY_SERVICE.fetch = async request => {
    assert.equal(request.url, "https://activity.internal/v1/activity/commands/status");
    f.db.prepare("DELETE FROM sessions WHERE id=?").run(f.sid);
    return Response.json({
      commandId: body.commandId, state: "applied", baseRevision: 12, sourceRevision: 13,
      result: { id: "protected-source-result" }, error: null,
    });
  };
  const body = { profile, commandId: crypto.randomUUID() };
  // When logout invalidates the session during the read.
  const response = await f.request("/api/dashboard/commands/status", body);
  // Then protected command results are discarded.
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});
