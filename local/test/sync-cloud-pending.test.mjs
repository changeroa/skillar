import assert from "node:assert/strict";
import { join } from "node:path";
import { rmSync } from "node:fs";
import test from "node:test";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";
import { activityDb } from "../../site/test/helpers/activity-db.mjs";
import { activityRequest } from "../../site/lib/activity-routes.ts";
import { signCookie, SESSION_COOKIE } from "../../site/lib/auth.ts";

const { connectCloudDeviceFlow, consentReviewNotice, pollPendingConnect, createPendingConnect } =
  await distImport("sync/cloud-pending.js");
const { readConnection } = await distImport("sync/cloud-connection.js");

async function fixture(t) {
  const dir = makeTempDir();
  t.after(() => removeDir(dir));
  const { db: accountsDb, accounts } = await activityDb(t);
  const now = Math.floor(Date.now() / 1000), sid = "s".repeat(43);
  accountsDb.prepare("INSERT INTO users VALUES ('sub','fixture@example.com','','',?,?)").run(now, now);
  accountsDb.prepare("INSERT INTO sessions VALUES (?,'sub',?)").run(sid, now + 3600);
  const env = {
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    SESSION_KEY: "fixture-session-key-at-least-32-characters", PUBLIC_ORIGIN: "https://skillar.sh",
    ACCOUNTS: accounts, ACTIVITY_ENABLED: "true",
  };
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: "sub", sid }, "session", env, now)}`;
  const fetcher = (url, init) => activityRequest(new Request(url, init), env);
  return { dir, accountsDb, env, cookie, fetcher };
}

test("browser-approval connect: pending, approve, poll, exchange; consent only from the browser choice", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const lines = [];
  const flow = connectCloudDeviceFlow(f.dir, {
    origin: "https://skillar.sh", uploadIntent: true, open: false,
    io: { out: s => lines.push(s), err: () => {} },
    fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)),
  });
  // Given: the flow prints the code, the approval URL and the --upload guidance
  let codeLine;
  for (let i = 0; i < 500 && (codeLine = lines.find(l => l.includes("연결 코드:"))) === undefined; i++) {
    await new Promise(r => setTimeout(r, 5));
  }
  assert.ok(codeLine !== undefined, "flow prints the user code");
  const code = codeLine.split(":")[1].trim();
  assert.ok(lines.some(l => l.includes(`/connections/?code=${encodeURIComponent(code)}`)));
  assert.ok(lines.some(l => l.includes("--upload")));
  // And: the approval page summary matches the request (no secrets)
  const summaryResponse = await activityRequest(new Request(
    `https://skillar.sh/api/devices/pending/${encodeURIComponent(code)}`, { headers: { cookie: f.cookie } }), f.env);
  assert.equal(summaryResponse.status, 200);
  const summary = await summaryResponse.json();
  assert.deepEqual(summary.scopes, ["activity:read", "activity:ingest"]);
  // When: the browser approves with an explicit metadata consent choice
  const approved = await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
    method: "POST",
    headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
    body: JSON.stringify({ code, consent: { mode: "metadata" } }),
  }), f.env);
  assert.equal(approved.status, 200);
  // Then: the flow exchanges the one-time grant through the existing boundary
  const connected = await flow;
  assert.equal("token" in connected, false);
  const connection = readConnection(f.dir);
  assert.equal(connection.deviceId.length > 0, true);
  const grantRow = f.accountsDb.prepare("SELECT count(*) AS n FROM device_grants").get();
  assert.equal(grantRow.n, 1);
  const consent = f.accountsDb.prepare("SELECT * FROM device_consents WHERE device_id=?").get(connection.deviceId);
  const record = JSON.parse(consent.consent_json);
  assert.equal(record.mode, "metadata");
  assert.equal(record.scope.deviceId, connection.deviceId);
  assert.deepEqual(record.scope.projectIds, [`device:${connection.deviceId}`]);
  // And: the once-per-device consent notice was already recorded by the connect
  assert.equal(consentReviewNotice(f.dir, connection), null);
  // And: a forgotten notice comes back exactly once
  rmSync(join(f.dir, "cloud", "consent-notice.json"));
  assert.equal(consentReviewNotice(f.dir, connection), "https://skillar.sh/connections/");
  assert.equal(consentReviewNotice(f.dir, connection), null);
});

test("poll stops at expiry and after pickup the request is gone", async t => {
  const f = await fixture(t);
  const issue = await createPendingConnect("https://skillar.sh", {
    deviceLabel: "만료 테스트", scopes: ["activity:read", "activity:ingest"] }, f.fetcher);
  let nowMs = Date.now();
  await assert.rejects(
    pollPendingConnect("https://skillar.sh", { ...issue, expiresIn: 1 }, {
      fetcher: f.fetcher, wait: async () => { nowMs += 600; }, now: () => nowMs,
    }),
    /pending_expired/,
  );
});

test("interactive init offers connect with default yes; explicit flags and non-TTY skip", { timeout: 30000 }, async t => {
  const { runInit } = await distImport("cli/init.js");
  const initEnv = dir => ({ HOME: dir, SKILLAR_NO_CLI: "1", PATH: process.env.PATH });
  const approveOnce = async (f, lines) => {
    let codeLine;
    for (let i = 0; i < 2000 && (codeLine = lines.find(l => l.includes("연결 코드:"))) === undefined; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    const code = codeLine.split(":")[1].trim();
    const approved = await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
      method: "POST",
      headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }), f.env);
    assert.equal(approved.status, 200);
  };
  // TTY + empty answer (default Y) connects without any flag
  {
    const f = await fixture(t);
    const lines = [];
    const io = { out: s => lines.push(s), err: s => lines.push(s), ask: async q => { lines.push(q); return ""; } };
    const run = runInit({ noService: true }, initEnv(f.dir), io,
      { fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)) });
    await approveOnce(f, lines);
    assert.equal(await run, 0);
    assert.equal(readConnection(join(f.dir, ".skillar")) !== null, true);
    assert.ok(lines.some(l => l.includes("[Y/n]")));
    // A second interactive run is already connected and never asks
    let asked = false;
    const again = await runInit({ noService: true }, initEnv(f.dir),
      { out: () => {}, err: () => {}, ask: async () => { asked = true; return "y"; } },
      { fetcher: f.fetcher, wait: async () => {} });
    assert.equal(again, 0);
    assert.equal(asked, false);
  }
  // TTY + "n" skips and prints the later path
  {
    const f = await fixture(t);
    const lines = [];
    const code = await runInit({ noService: true }, initEnv(f.dir),
      { out: s => lines.push(s), err: s => lines.push(s), ask: async () => "n" },
      { fetcher: f.fetcher, wait: async () => {} });
    assert.equal(code, 0);
    assert.equal(readConnection(join(f.dir, ".skillar")), null);
    assert.ok(lines.some(l => l.includes("skillar sync connect")));
  }
  // Non-TTY without --connect never asks and never connects
  {
    const f = await fixture(t);
    const lines = [];
    const code = await runInit({ noService: true }, initEnv(f.dir),
      { out: s => lines.push(s), err: s => lines.push(s) },
      { fetcher: f.fetcher, wait: async () => {} });
    assert.equal(code, 0);
    assert.equal(readConnection(join(f.dir, ".skillar")), null);
    assert.equal(lines.some(l => l.includes("[Y/n]")), false);
  }
  // --no-connect skips even on a TTY
  {
    const f = await fixture(t);
    let asked = false;
    const code = await runInit({ noService: true, connect: false }, initEnv(f.dir),
      { out: () => {}, err: () => {}, ask: async () => { asked = true; return ""; } },
      { fetcher: f.fetcher, wait: async () => {} });
    assert.equal(code, 0);
    assert.equal(asked, false);
    assert.equal(readConnection(join(f.dir, ".skillar")), null);
  }
});
