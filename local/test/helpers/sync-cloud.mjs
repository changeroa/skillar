import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fixture as remoteFixture } from "../../../worker/test/helpers/activity-migrations.mjs";
import { distImport, makeTempDir, removeDir } from "../_helpers.mjs";

const { atomicCloudJson } = await distImport("sync/cloud-connection.js");
const { openDb } = await distImport("store/db.js");
const { consentSchema } = await distImport("sync/cloud-wire.js");

export async function fixture(t) {
  const home = makeTempDir();
  t.after(() => removeDir(home));
  const remote = await remoteFixture(t), source = join(home, "source.sqlite");
  const db = openDb(source);
  t.after(() => db.close());
  const connection = {
    version: 1, instanceId: randomUUID(), origin: "https://skillar.sh",
    accountId: "account-a", deviceId: "device-a", generation: 1,
    token: "T".repeat(43), expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
  atomicCloudJson(home, "connection.json", connection);
  let consent = { mode: "local-only" }, consentVersion = 0, enabled = true, fail = null;
  const calls = [];
  const setConsent = async input => {
    consent = consentSchema.parse(input);
    consentVersion = consent.mode === "local-only" ? consentVersion + 1 : consent.version;
    await remote.accounts.prepare(`INSERT INTO device_consents VALUES ('account-a','device-a',1,?,?,0)
      ON CONFLICT(account_id,device_id,version) DO UPDATE SET consent_json=excluded.consent_json`)
      .bind(consentVersion, JSON.stringify(consent)).run();
  };
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    assert.equal(init.headers.authorization, `Bearer ${connection.token}`);
    calls.push({ path, body: init.body });
    if (path === "/v1/devices/self") return Response.json({
      accountId: connection.accountId, deviceId: connection.deviceId,
      generation: 1, shardId: "activity-00", scopes: ["activity:read", "activity:ingest"],
      ingestEnabled: enabled, version: consentVersion, consent,
    });
    assert.ok(path.startsWith("/v1/activity/"), path);
    const response = await remote.api(path, JSON.parse(init.body));
    if (fail === path) {
      fail = null;
      throw new TypeError("fixture connection closed after remote commit");
    }
    return response;
  };
  return {
    home, source, db, connection, remote, calls, fetcher, setConsent,
    loseNextReceipt(path) { fail = path; },
    setEnabled(value) { enabled = value; },
  };
}

export function grant(prepared, changes = {}) {
  return {
    mode: "managed-content", version: 1, grantedAtMs: 1000,
    scope: { deviceId: "device-a", projectIds: ["device:device-a"], rootIds: [] },
    serverProcessingAcknowledged: true,
    contentKinds: ["prompt", "query", "args", "error", "path", "span-attributes", "private-skills"],
    ...(prepared === null ? {} : { backfill: {
      version: 1, snapshotId: prepared.snapshotId, journalCut: prepared.cut,
      range: { fromMs: -8_640_000_000_000_000, toMs: 8_640_000_000_000_000 },
    } }),
    ...changes,
  };
}
