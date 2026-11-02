import assert from "node:assert/strict";
import { join } from "node:path";
import { statSync } from "node:fs";
import { backup, DatabaseSync } from "node:sqlite";
import test from "node:test";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";
import { activityDb } from "../../site/test/helpers/activity-db.mjs";
import { activityRequest } from "../../site/lib/activity-routes.ts";
import { signCookie, SESSION_COOKIE } from "../../site/lib/auth.ts";

const { connectCloud, readConnection, disconnectCloud } = await distImport("sync/cloud-connection.js");
const { prepareCloudSnapshot, preparedPath } = await distImport("sync/cloud-prepare.js");
const { openDb } = await distImport("store/db.js");
const { journalHead } = await distImport("sync/journal.js");

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
  const response = await activityRequest(new Request("https://skillar.sh/api/devices/grants", {
    method: "POST", headers: {
      cookie, origin: "https://skillar.sh", "content-type": "application/json",
    }, body: JSON.stringify({ scopes: ["activity:read", "activity:ingest"] }),
  }), env);
  const issued = await response.json(), calls = [];
  const fetcher = async (url, init) => {
    calls.push(String(url));
    return activityRequest(new Request(url, init), env);
  };
  const source = join(dir, "activity.sqlite");
  const db = openDb(source);
  db.prepare(`INSERT INTO sessions(id,runtime,started_at,first_prompt)
    VALUES('session','codex',100,'PRIVATE_LOCAL_FIXTURE')`).run();
  db.close();
  return { dir, source, issued, calls, fetcher, accountsDb };
}

test("real device exchange connects without granting upload and local preparation sends no bytes", async t => {
  const f = await fixture(t);
  const connected = await connectCloud(f.dir, {
    origin: "https://skillar.sh", grant: f.issued.grant,
  }, f.fetcher);
  assert.equal("token" in connected, false);
  assert.equal(typeof readConnection(f.dir).token, "string");
  assert.equal(statSync(join(f.dir, "cloud", "connection.json")).mode & 0o777, 0o600);
  const prepared = await prepareCloudSnapshot(f.dir, f.source);
  assert.equal(f.calls.length, 2);
  assert.equal(f.accountsDb.prepare("SELECT count(*) n FROM device_consents").get().n, 0);
  const frozen = openDb(preparedPath(f.dir, prepared.snapshotId));
  assert.deepEqual(journalHead(frozen), { sourceDomain: prepared.sourceDomain, cut: prepared.cut });
  assert.equal(frozen.prepare("SELECT first_prompt FROM sessions").get().first_prompt, "PRIVATE_LOCAL_FIXTURE");
  assert.equal(frozen.prepare("SELECT count(*) n FROM sync_outbox").get().n, 0);
  frozen.close();
  disconnectCloud(f.dir);
  assert.equal(readConnection(f.dir), null);
  const preserved = openDb(f.source);
  assert.equal(preserved.prepare("SELECT count(*) n FROM sessions").get().n, 1);
  preserved.close();
});

test("backup concurrent writer restarts yield one internally consistent value and journal cut", { timeout: 15000 }, async t => {
  const f = await fixture(t);
  await connectCloud(f.dir, { origin: "https://skillar.sh", grant: f.issued.grant }, f.fetcher);
  let wrote = false;
  const prepared = await prepareCloudSnapshot(f.dir, f.source, (source, target) =>
    backup(source, target, { rate: 1, progress: ({ remainingPages }) => {
      if (!wrote && remainingPages > 0) {
        wrote = true;
        const writer = openDb(f.source);
        writer.prepare("UPDATE sessions SET first_prompt='AFTER_BACKUP_START'").run();
        writer.close();
      }
    } }));
  assert.equal(wrote, true);
  const frozen = new DatabaseSync(preparedPath(f.dir, prepared.snapshotId), { readOnly: true });
  assert.equal(frozen.prepare("SELECT first_prompt FROM sessions").get().first_prompt, "AFTER_BACKUP_START");
  assert.equal(journalHead(frozen).cut, prepared.cut);
  const last = frozen.prepare(`SELECT row_json FROM sync_journal
    WHERE table_name='sessions' ORDER BY seq DESC LIMIT 1`).get();
  assert.equal(JSON.parse(last.row_json).first_prompt, "AFTER_BACKUP_START");
  frozen.close();
});
