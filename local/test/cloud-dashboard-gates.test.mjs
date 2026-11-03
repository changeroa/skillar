import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../../site/functions/api/[[path]].ts";
import { signCookie, SESSION_COOKIE } from "../../site/lib/auth.ts";
import { fixture } from "../../worker/test/helpers/activity-content.mjs";

for (const disabled of ["Pages", "Worker"]) test(`${disabled} independently blocks browser eval writes before raw storage`, async t => {
  const remote = await fixture(t), now = Math.floor(Date.now() / 1000);
  const sid = "dashboard-kill-switch-session".padEnd(43, "s");
  await remote.accounts.prepare("INSERT INTO sessions VALUES (?,'account-a',?)").bind(sid, now + 3600).run();
  await remote.accounts.prepare(`UPDATE device_consents SET consent_json=json_set(
    consent_json,'$.scope.projectIds',json('["device:device-a"]'))`).run();
  if (disabled === "Worker") assert.equal((await remote.send("/test/off")).status, 200);
  let dispatched = 0;
  const env = {
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    SESSION_KEY: "fixture-session-key-at-least-32-characters", PUBLIC_ORIGIN: "https://skillar.sh",
    ACCOUNTS: remote.accounts, ACTIVITY_ENABLED: "true",
    ACTIVITY_INGEST_ENABLED: disabled === "Pages" ? "false" : "true",
    ACTIVITY_SERVICE: { async fetch(request) {
      dispatched++;
      const response = await remote.send(new URL(request.url).pathname, await request.json(),
        JSON.parse(request.headers.get("x-skillar-principal")));
      return Response.json(response.body, { status: response.status });
    } },
  };
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: "account-a", sid }, "session", env, now)}`;
  const response = await onRequest({ env, request: new Request("https://skillar.sh/api/dashboard/eval-cases", {
    method: "POST", headers: { cookie, origin: "https://skillar.sh", "content-type": "application/json" },
    body: JSON.stringify({ profile: { deviceId: "device-a", sourceDomain: "source" },
      requestId: crypto.randomUUID(), input: { query: "synthetic fixture query" } }),
  }) });
  assert.equal(dispatched, disabled === "Pages" ? 0 : 1);
  assert.equal(response.status, 404);
  assert.equal((await remote.bucket.list()).objects.length, 0);
  assert.equal((await remote.rows("SELECT count(*) n FROM content_uploads"))[0].n, 0);
});
