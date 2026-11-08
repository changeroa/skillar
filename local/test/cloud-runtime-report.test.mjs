import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { onRequest as api } from "../../site/functions/api/[[path]].ts";
import { onRequest as v1 } from "../../site/functions/v1/[[path]].ts";
import { signCookie, SESSION_COOKIE } from "../../site/lib/auth.ts";
import { fixture as reportFixture } from "../../worker/test/helpers/activity-reports.mjs";
import { seedRich } from "./helpers/sync-restore.mjs";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";

const { openDb } = await distImport("store/db.js");
const { createStore } = await distImport("store/index.js");
const { connectCloud, readConnection } = await distImport("sync/cloud-connection.js");
const { prepareCloudSnapshot } = await distImport("sync/cloud-prepare.js");
const { runCloudStep } = await distImport("sync/cloud.js");
const { captureDaemonRuntime, runCloudRuntimeStep } = await distImport("sync/cloud-runtime.js");

test("daemon runtime reaches a native report through actual authenticated Pages and Worker routes", { timeout: 30000 }, async t => {
  // Given a synthetic Google session and a local source; no runtime is manually committed.
  const remote = await reportFixture(t), home = makeTempDir("skillar-runtime-report-");
  t.after(() => removeDir(home));
  const source = join(home, "source.sqlite"), db = openDb(source);
  t.after(() => db.close());
  seedRich(db);
  const now = Math.floor(Date.now() / 1000), sid = "Q".repeat(43);
  await remote.accounts.prepare("INSERT INTO sessions VALUES (?,'account-a',?)").bind(sid, now + 3600).run();
  const forwarded = [];
  const env = {
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    SESSION_KEY: "fixture-session-key-at-least-32-characters", PUBLIC_ORIGIN: "https://skillar.sh",
    ACCOUNTS: remote.accounts, ACTIVITY_ENABLED: "true", ACTIVITY_INGEST_ENABLED: "true",
    ACTIVITY_SERVICE: { async fetch(request) {
      assert.equal(request.headers.has("authorization"), false);
      assert.equal(request.headers.has("cookie"), false);
      forwarded.push(new URL(request.url).pathname);
      const response = await remote.api(new URL(request.url).pathname, await request.json(),
        JSON.parse(request.headers.get("x-skillar-principal")));
      return Response.json(response.body, { status: response.status });
    } },
  };
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: "account-a", sid }, "session", env, now)}`;
  const route = request => (new URL(request.url).pathname.startsWith("/v1/") ? v1 : api)({ request, env });
  const browserPost = async (path, body, status = 200) => {
    const response = await route(new Request(`https://skillar.sh${path}`, {
      method: "POST", headers: { cookie, origin: "https://skillar.sh", "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    const value = await response.json();
    assert.equal(response.status, status, `${path}: ${JSON.stringify(value)}`);
    return value;
  };
  const fetcher = (url, init) => route(new Request(url, init));
  const issued = await browserPost("/api/devices/grants", { scopes: ["activity:read", "activity:ingest"] }, 201);
  const connected = await connectCloud(home, { origin: "https://skillar.sh", grant: issued.grant }, fetcher);
  assert.equal((await runCloudStep(home, source, { fetcher })).phase, "local-only");
  assert.equal(forwarded.length, 0);
  const prepared = await prepareCloudSnapshot(home, source);
  const backfill = { version: 1, snapshotId: prepared.snapshotId, journalCut: prepared.cut,
    range: { fromMs: -8_640_000_000_000_000, toMs: 8_640_000_000_000_000 } };
  await browserPost(`/api/devices/${connected.deviceId}/consent`, { baseVersion: 0, consent: {
    mode: "managed-content", version: 1, grantedAtMs: 0, serverProcessingAcknowledged: true,
    scope: { deviceId: connected.deviceId, projectIds: [`device:${connected.deviceId}`], rootIds: [] },
    contentKinds: ["prompt", "query", "args", "error", "path", "span-attributes", "private-skills"], backfill,
  } });
  let progress;
  for (let unit = 0; unit < 16; unit++) {
    progress = await runCloudStep(home, source, { fetcher });
    if (progress.phase !== "queued") break;
  }
  assert.equal(progress.phase, "caught-up", JSON.stringify(progress));
  const captured = captureDaemonRuntime(db);
  const before = await remote.rows("SELECT count(*) n FROM runtime_contexts");
  assert.equal(before[0].n, 0);

  // When the shipped runtime sender crosses both production routers with its real bearer.
  const sent = await runCloudRuntimeStep(home, source, progress, async () => captured, { fetcher });
  assert.equal(sent.phase, "caught-up", JSON.stringify(sent));
  assert.equal((await remote.rows("SELECT count(*) n FROM runtime_contexts"))[0].n, 1);
  const connection = readConnection(home);
  const devicePost = (path, body) => fetcher(`https://skillar.sh${path}`, {
    method: "POST", headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const read = await devicePost("/v1/activity/context/read", { sourceDomain: prepared.sourceDomain, sequence: 1 });
  assert.equal(read.status, 200);
  assert.deepEqual((await read.json()).context, captured.context);
  const requestId = crypto.randomUUID(), done = remote.finished(requestId);
  const request = {
    schemaVersion: 1, requestId, deviceId: connected.deviceId, generation: connected.generation,
    sourceDomain: prepared.sourceDomain, consentVersion: 1, projectId: `device:${connected.deviceId}`, rootId: null,
    range: backfill.range, backfill: { version: 1, snapshotId: backfill.snapshotId, journalCut: backfill.journalCut },
    tz: captured.context.tz, query: { kind: "stats" },
  };
  const accepted = await devicePost("/v1/activity/query", request);
  assert.equal(accepted.status, 202, await accepted.clone().text());
  assert.equal((await done).state, "complete");

  // Then the resulting native report reads that sender's committed runtime and matches SQLite.
  const reference = { deviceId: connected.deviceId, generation: connected.generation,
    sourceDomain: prepared.sourceDomain, jobId: requestId };
  const status = await devicePost("/v1/activity/reports/status", reference);
  assert.equal(status.status, 200);
  const metadata = await status.json(), parts = [];
  for (let part = 0; part < metadata.result.parts; part++) {
    const response = await devicePost("/v1/activity/reports/result", { ...reference, part });
    assert.equal(response.status, 200);
    parts.push(Buffer.from((await response.json()).body, "base64"));
  }
  const report = JSON.parse(Buffer.concat(parts));
  assert.deepEqual(report.payload, JSON.parse(JSON.stringify(createStore(db).stats())));
  assert.equal(report.inputRevision.runtimeSequence, 1);
  assert.equal(report.inputRevision.journalThrough, captured.sourceCut);
  assert.ok(forwarded.includes("/v1/activity/context"));
});
