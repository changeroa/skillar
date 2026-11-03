// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { browser, fixture } from "./helpers/activity-account-hub.mjs";

const compiled = await build({
  stdin: {
    contents: `export {activityRequest} from "../site/lib/activity-routes.ts";
      export {signCookie,SESSION_COOKIE} from "../site/lib/auth.ts";`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts",
  },
  bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
});
const { activityRequest, signCookie, SESSION_COOKIE } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const origin = "https://skillar.sh";

async function connected(t) {
  const f = await fixture(t), who = browser();
  const env = {
    ACCOUNTS: f.accounts, ACTIVITY_ENABLED: "true", PUBLIC_ORIGIN: origin,
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    SESSION_KEY: "native-control-session-key-at-least-32-characters",
  };
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: who.accountId, sid: who.sessionId }, "session", env, Math.floor(Date.now() / 1000))}`;
  const request = (path, body) => activityRequest(new Request(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  const issued = await request("/api/devices/grants", { scopes: ["activity:read", "activity:ingest"] });
  assert.equal(issued.status, 201);
  const grant = await issued.json();
  const exchanged = await request("/v1/devices/exchange", { grant: grant.grant });
  assert.equal(exchanged.status, 200);
  const { deviceId } = await exchanged.json();
  const outbox = () => f.accounts.prepare("SELECT count(*) AS n FROM account_control_outbox").first("n");
  return { ...f, request, deviceId, outbox };
}

test("native D1 changes includes the account-notification trigger write", async t => {
  // Given
  const f = await connected(t);
  // When
  const result = await f.accounts.prepare(`INSERT INTO device_consents
    (account_id,device_id,generation,version,consent_json,granted_at_ms)
    VALUES ('account-a',?,1,1,'{"mode":"local-only"}',1)`).bind(f.deviceId).run();
  // Then
  assert.equal(result.meta.changes, 2);
  assert.equal(await f.outbox(), 1);
});

test("browser consent succeeds when native D1 also enqueues its account event", async t => {
  // Given
  const f = await connected(t), path = `/api/devices/${f.deviceId}/consent`;
  // When
  const response = await f.request(path, { baseVersion: 0, consent: { mode: "local-only" } });
  // Then
  assert.equal((await (await f.request(path)).json()).version, 1, "the consent actually committed");
  assert.equal(await f.outbox(), 1);
  assert.equal(response.status, 200, "a committed consent must not be reported as a conflict");
});

test("browser revocation succeeds when native D1 also enqueues its account event", async t => {
  // Given
  const f = await connected(t);
  // When
  const response = await f.request(`/api/devices/${f.deviceId}/revoke`, {});
  // Then
  assert.notEqual(await f.accounts.prepare("SELECT revoked_at FROM devices WHERE device_id=?").bind(f.deviceId).first("revoked_at"), null);
  assert.notEqual(await f.accounts.prepare("SELECT revoked_at FROM api_tokens WHERE device_id=?").bind(f.deviceId).first("revoked_at"), null);
  assert.equal(await f.outbox(), 1);
  assert.equal(response.status, 200, "a committed revocation must not be reported as not found");
});

test("two browser consent writers retain one winner with native notification triggers", async t => {
  // Given
  const f = await connected(t), path = `/api/devices/${f.deviceId}/consent`;
  const input = { baseVersion: 0, consent: { mode: "local-only" } };
  // When
  const responses = await Promise.all([f.request(path, input), f.request(path, input)]);
  // Then
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  assert.equal(await f.outbox(), 1);
});
