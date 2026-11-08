import assert from "node:assert/strict";
import test from "node:test";
import { signCookie, SESSION_COOKIE } from "../lib/auth.ts";
import { browserPrincipal } from "../lib/activity-auth.ts";
import { issueDeviceGrant, exchangeDeviceGrant } from "../lib/device-auth.ts";
import { onRequest } from "../functions/api/[[path]].ts";
import { activityDb } from "./helpers/activity-db.mjs";

const origin = "https://skillar.sh", now = 1_800_000_000;
const definition = {
  schema_version: 1, kind: "skill-pack", name: "synthetic-pack", display_name: "Synthetic pack",
  description: "Synthetic pack", scope: "Synthetic test",
  members: ["scope", "investigate", "verify"].map((phase, index) => ({
    uri: `skillar://private/${index + 1}381f285-e3d8-49c2-9c51-228f1d852998/${"a".repeat(64)}/SKILL.md`,
    phase, selection: "required", when: `Synthetic ${phase}`,
  })),
};

async function fixture(t) {
  t.mock.method(Date, "now", () => now * 1000);
  const { db, accounts } = await activityDb(t), sid = "s".repeat(43), calls = [];
  db.prepare("INSERT INTO users VALUES ('pack-person','fixture@example.invalid','','',?,?)").run(now, now);
  db.prepare("INSERT INTO sessions VALUES (?,'pack-person',?)").run(sid, now + 3600);
  const env = {
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    SESSION_KEY: "fixture-session-key-at-least-32-characters", PUBLIC_ORIGIN: origin,
    ACCOUNTS: accounts, PRIVATE_SKILLS_ENABLED: "true", ACTIVITY_ENABLED: "false",
    ACTIVITY_SERVICE: { async fetch(request) {
      calls.push(request);
      return Response.json({ packs: [], totalMatches: 0, offset: 0, limit: 5 });
    } },
  };
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: "pack-person", sid }, "session", env, now)}`;
  const request = (action, body = { mode: "explicit", query: "" }, headers = {}, device = false) =>
    onRequest({ env, request: new Request(`${origin}${device ? "/v1" : "/api"}/packs/${action}`, {
      method: "POST", headers: { cookie, origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }) });
  const credential = async scopes => {
    const principal = await browserPrincipal(new Request(`${origin}/api/packs/search`, { headers: { cookie } }), env);
    const grant = await issueDeviceGrant(principal, scopes, env);
    return exchangeDeviceGrant(grant.grant, env, origin);
  };
  return { db, env, sid, calls, request, credential };
}

test("private pack search uses Google authority independently of activity capture", async t => {
  // Given a signed-in account without activity capture.
  const f = await fixture(t);
  // When a forged identity accompanies its private pack read.
  const response = await f.request("search", undefined, { "x-skillar-principal": '{"accountId":"foreign"}' });
  // Then only the real session identity crosses the binding.
  assert.equal(response.status, 200);
  const call = f.calls[0], principal = JSON.parse(call.headers.get("x-skillar-principal"));
  assert.equal(call.url, "https://activity.internal/v1/private-packs/search");
  assert.equal(principal.sessionId, f.sid);
  assert.notEqual(principal.accountId, "foreign");
  assert.equal(call.headers.has("cookie"), false);
  assert.equal(call.headers.has("authorization"), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a read-only device cannot create a private pack", async t => {
  // Given a device credential with no write grant.
  const f = await fixture(t), credential = await f.credential(["skills:read"]);
  // When it attempts pack creation.
  const response = await f.request("create", {
    request_id: crypto.randomUUID(), acknowledge_private_upload: true, definition,
  }, { authorization: `Bearer ${credential.token}` }, true);
  // Then scope enforcement stops it before forwarding.
  assert.equal(response.status, 403);
  assert.equal(f.calls.length, 0);
});

test("private pack mutations reject a foreign browser origin", async t => {
  // Given a current Google session.
  const f = await fixture(t);
  // When an unrelated origin attempts to use it.
  const response = await f.request("create", {
    request_id: crypto.randomUUID(), acknowledge_private_upload: true, definition,
  }, { origin: "https://foreign.example" });
  // Then the binding receives nothing.
  assert.equal(response.status, 403);
  assert.equal(f.calls.length, 0);
});

test("logout during a private pack read prevents protected response release", async t => {
  // Given a valid request whose session disappears during the binding read.
  const f = await fixture(t);
  f.env.ACTIVITY_SERVICE.fetch = async () => {
    f.db.prepare("DELETE FROM sessions WHERE id=?").run(f.sid);
    return Response.json({ packs: [], totalMatches: 0, offset: 0, limit: 5 });
  };
  // When the buffered response would be released.
  const response = await f.request("search");
  // Then the expired session cannot receive it.
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});

test("a durable pack CAS failure preserves its queryable failed receipt", async t => {
  // Given a failed server-side pack job.
  const f = await fixture(t), request_id = crypto.randomUUID();
  const receipt = {
    request_id, uri: "pack://private/synthetic-pack", digest: "a".repeat(64), current_digest: "b".repeat(64),
    status: "failed", revision: null, unchanged: false, content_durable: false, searchable: false,
    error: "pack_conflict",
  };
  f.env.ACTIVITY_SERVICE.fetch = async () => Response.json(receipt, { status: 409 });
  // When the write response crosses Pages.
  const response = await f.request("create", { request_id, acknowledge_private_upload: true, definition });
  // Then the caller retains both the conflict and the durable request identity.
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), receipt);
});
