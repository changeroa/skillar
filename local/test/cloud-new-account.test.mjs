import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { onRequest as api } from "../../site/functions/api/[[path]].ts";
import { onRequest as v1 } from "../../site/functions/v1/[[path]].ts";
import { signCookie, SESSION_COOKIE } from "../../site/lib/auth.ts";
import { fixture } from "../../worker/test/helpers/activity-reports.mjs";
import { seedRich } from "./helpers/sync-restore.mjs";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";

const { openDb } = await distImport("store/db.js");
const { connectCloud } = await distImport("sync/cloud-connection.js");
const { prepareCloudSnapshot } = await distImport("sync/cloud-prepare.js");
const { runCloudStep } = await distImport("sync/cloud.js");
const { captureDaemonRuntime, runCloudRuntimeStep } = await distImport("sync/cloud-runtime.js");

test("a newly signed-in account can explicitly sync without a manually seeded activity fence", {
  timeout: 30000,
}, async t => {
  const remote = await fixture(t), home = makeTempDir("skillar-new-cloud-account-");
  t.after(() => removeDir(home));
  const source = join(home, "source.sqlite"), db = openDb(source);
  t.after(() => db.close());
  seedRich(db);
  const now = Math.floor(Date.now() / 1000), sid = "fresh-account-session".padEnd(43, "s");
  await remote.accounts.prepare("INSERT INTO users VALUES ('new-user','new@example.com','','',?,?)")
    .bind(now, now).run();
  await remote.accounts.prepare("INSERT INTO sessions VALUES (?,'new-user',?)").bind(sid, now + 3600).run();
  const env = {
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    SESSION_KEY: "fixture-session-key-at-least-32-characters", PUBLIC_ORIGIN: "https://skillar.sh",
    ACCOUNTS: remote.accounts, ACTIVITY_ENABLED: "true", ACTIVITY_INGEST_ENABLED: "true",
    ACTIVITY_SERVICE: { async fetch(request) {
      const result = await remote.api(new URL(request.url).pathname, await request.json(),
        JSON.parse(request.headers.get("x-skillar-principal")));
      return Response.json(result.body, { status: result.status });
    } },
  };
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: "new-user", sid }, "session", env, now)}`;
  const route = request => (new URL(request.url).pathname.startsWith("/v1/") ? v1 : api)({ request, env });
  const browser = async (path, body) => {
    const response = await route(new Request(`https://skillar.sh${path}`, {
      method: body === undefined ? "GET" : "POST", headers: {
        cookie, origin: "https://skillar.sh", "content-type": "application/json",
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const value = await response.json();
    assert.ok(response.ok, `${path}: ${JSON.stringify(value)}`);
    return value;
  };
  const fetcher = (url, init) => route(new Request(url, init));
  const issued = await browser("/api/devices/grants", { scopes: ["activity:read", "activity:ingest"] });
  const connected = await connectCloud(home, { origin: "https://skillar.sh", grant: issued.grant }, fetcher);
  assert.notEqual(connected.accountId, "account-a");
  assert.equal((await remote.rows("SELECT * FROM tenant_fences WHERE account_id=?", connected.accountId)).length, 0);
  assert.equal((await runCloudStep(home, source, { fetcher })).phase, "local-only");
  const prepared = await prepareCloudSnapshot(home, source);
  await browser(`/api/devices/${connected.deviceId}/consent`, { baseVersion: 0, consent: {
    mode: "managed-content", version: 1, grantedAtMs: 0, serverProcessingAcknowledged: true,
    scope: { deviceId: connected.deviceId, projectIds: [`device:${connected.deviceId}`], rootIds: [] },
    contentKinds: ["prompt", "query", "args", "error", "path", "span-attributes", "private-skills"],
    backfill: { version: 1, snapshotId: prepared.snapshotId, journalCut: prepared.cut,
      range: { fromMs: -8_640_000_000_000_000, toMs: 8_640_000_000_000_000 } },
  } });
  let progress;
  for (let unit = 0; unit < 16; unit++) {
    progress = await runCloudStep(home, source, { fetcher });
    if (progress.phase !== "queued") break;
  }
  assert.equal(progress.phase, "caught-up", JSON.stringify(progress));
  const captured = captureDaemonRuntime(db);
  assert.equal((await runCloudRuntimeStep(home, source, progress, () => captured, { fetcher })).phase, "caught-up");
  const [fence] = await remote.rows("SELECT * FROM tenant_fences WHERE account_id=?", connected.accountId);
  assert.equal(fence.generation, connected.generation);
  assert.equal(fence.state, "active");
  const profiles = await browser("/api/dashboard/profiles");
  assert.equal(profiles.profiles.find(p => p.deviceId === connected.deviceId).availability, "ready");
  const requestId = crypto.randomUUID(), finished = remote.finished(requestId);
  await browser("/api/dashboard/query", {
    profile: { deviceId: connected.deviceId, sourceDomain: prepared.sourceDomain },
    requestId, query: { kind: "stats" },
  });
  assert.equal((await finished).state, "complete");
});
