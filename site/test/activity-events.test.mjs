import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/[[path]].ts";
import { onRequest as authRequest } from "../functions/auth/[[path]].ts";
import { signCookie, SESSION_COOKIE } from "../lib/auth.ts";
import { activityDb } from "./helpers/activity-db.mjs";
import { eventCursor, eventCursorScope } from "../../shared/dist/activity-events.js";

const origin = "https://skillar.sh", now = 1_800_000_000;
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
  const request = (path, init = {}, handler = onRequest) => handler({
    env, request: new Request(`${origin}${path}`, {
      ...init, headers: { cookie, ...init.headers },
    }),
  });
  await request("/api/dashboard/status");
  const accountId = db.prepare("SELECT account_id FROM accounts WHERE user_sub='a'").get().account_id;
  const cursor = eventCursor(await eventCursorScope(accountId), 1, 4);
  env.ACTIVITY_SERVICE = { async fetch(request) {
    calls.push(request);
    return Response.json({ state: "ok", head: 4, cursor, changes: [], hasMore: false });
  } };
  return { db, env, sid, calls, request, accountId, cursor };
}

test("events require Google authority and strict websocket Origin", async t => {
  const f = await fixture(t), connectionId = crypto.randomUUID();
  const path = `/api/events/ws?connectionId=${connectionId}`;
  assert.equal((await f.request(path, { headers: { cookie: "", origin, upgrade: "websocket" } })).status, 401);
  assert.equal((await f.request(path, { headers: { upgrade: "websocket" } })).status, 403);
  assert.equal((await f.request(path, { headers: { origin: "https://evil.example", upgrade: "websocket" } })).status, 403);
  assert.equal((await f.request(path, { headers: { origin } })).status, 403);
  assert.equal(f.calls.length, 0);
  await f.request(path, { headers: {
    origin, upgrade: "websocket", authorization: "Bearer attacker",
    "x-skillar-principal": '{"accountId":"victim"}',
  } });
  const forwarded = f.calls[0];
  assert.equal(forwarded.url, `https://activity.internal/v1/activity/events/ws?connectionId=${connectionId}`);
  assert.equal(forwarded.headers.get("cookie"), null);
  assert.equal(forwarded.headers.get("authorization"), null);
  const identity = JSON.parse(forwarded.headers.get("x-skillar-principal"));
  assert.equal(identity.accountId, f.accountId);
  assert.equal(identity.sessionId, f.sid);
  assert.equal(identity.kind, "browser");
  assert.equal(forwarded.headers.get("upgrade"), "websocket");
});

test("replay rejects caller identity filters and forwards only a scoped cursor", async t => {
  const f = await fixture(t);
  for (const query of ["accountId=victim", "since=1.2", "filter=all",
    `since=${f.cursor}&since=${f.cursor}`]) {
    assert.equal((await f.request(`/api/changes?${query}`)).status, 400);
  }
  assert.equal(f.calls.length, 0);
  const response = await f.request(`/api/changes?since=${f.cursor}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cursor, f.cursor);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(f.calls[0].url, `https://activity.internal/v1/activity/events/changes?since=${f.cursor}`);
});

test("SSE preserves Last-Event-ID without forwarding private headers or buffering", async t => {
  const f = await fixture(t), connectionId = crypto.randomUUID();
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode("event: ready\ndata: fixture\n\n"));
    controller.close();
  } });
  let forwarded;
  f.env.ACTIVITY_SERVICE.fetch = async request => {
    forwarded = request;
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  };
  const response = await f.request(`/api/events/stream?connectionId=${connectionId}`, {
    headers: { "last-event-id": f.cursor, "x-skillar-principal": "attacker" },
  });
  assert.equal(response.body, stream);
  assert.equal(forwarded.headers.get("last-event-id"), f.cursor);
  assert.equal(forwarded.headers.get("cookie"), null);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
});

test("lease renewal requires same-origin POST and strict connection identity", async t => {
  const f = await fixture(t), connectionId = crypto.randomUUID();
  const init = { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ connectionId }) };
  assert.equal((await f.request("/api/events/lease", { ...init, headers: { "content-type": "application/json" } })).status, 401);
  assert.equal((await f.request("/api/events/lease", { ...init, body: JSON.stringify({ connectionId, sid: "victim" }) })).status, 400);
  f.env.ACTIVITY_SERVICE.fetch = async request => {
    f.calls.push(request);
    assert.deepEqual(await request.json(), { connectionId });
    return Response.json({ connectionId, expiresAtMs: now * 1000 + 300000 });
  };
  assert.equal((await f.request("/api/events/lease", init)).status, 200);
  assert.equal(f.calls.length, 1);
});

test("replay rechecks session and account generation after the service await", async t => {
  const f = await fixture(t);
  f.env.ACTIVITY_SERVICE.fetch = async () => {
    dbDelete();
    return Response.json({ state: "ok", head: 4, cursor: f.cursor, changes: [], hasMore: false });
  };
  const dbDelete = () => f.db.prepare("DELETE FROM sessions WHERE id=?").run(f.sid);
  assert.equal((await f.request("/api/changes")).status, 401);
});

test("logout deletes the D1 session before sending bounded best-effort revocation", async t => {
  const f = await fixture(t);
  f.env.ACTIVITY_SERVICE.fetch = async request => {
    f.calls.push(request);
    assert.equal(f.db.prepare("SELECT id FROM sessions WHERE id=?").get(f.sid), undefined);
    assert.equal(request.url, "https://activity.internal/v1/activity/events/revoke");
    assert.equal(request.headers.get("cookie"), null);
    assert.deepEqual(await request.json(), { sessionId: f.sid });
    assert.equal(JSON.parse(request.headers.get("x-skillar-principal")).sessionId, f.sid);
    throw new Error("fixture lost RPC");
  };
  const response = await f.request("/auth/logout", { method: "POST", headers: { origin } }, authRequest);
  assert.equal(response.status, 303);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.request("/api/changes")).status, 401);
});
