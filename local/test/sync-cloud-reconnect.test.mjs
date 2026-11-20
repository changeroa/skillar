import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";
import { addSession, openDb, journalHead } from "./helpers/sync.mjs";

const { CloudBlobs } = await distImport("sync/cloud-blobs.js");
const { stageBaseline } = await distImport("sync/cloud-stage.js");
const { runCloudStep } = await distImport("sync/cloud.js");
const { bindSource } = await distImport("sync/cloud-prepare.js");
const { atomicCloudJson } = await distImport("sync/cloud-connection.js");
const { liveStream } = await distImport("sync/cloud-jobs.js");
const { contentKinds } = await distImport("sync/consent.js");

const DEVICE = "device-a";
const managed = {
  mode: "managed-content", version: 1, grantedAtMs: 0, serverProcessingAcknowledged: true,
  scope: { deviceId: DEVICE, projectIds: [`device:${DEVICE}`], rootIds: [] }, contentKinds,
};
const connection = instanceId => ({
  version: 1, instanceId, origin: "https://skillar.sh", accountId: "account-a",
  deviceId: DEVICE, generation: 1, token: "T".repeat(43),
  expiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ["activity:read", "activity:ingest"],
});

test("re-approval with a new instance resumes the existing epoch and drops the stale staged baseline", async t => {
  const home = makeTempDir();
  t.after(() => removeDir(home));
  const source = join(home, "activity.sqlite");
  const oldConn = connection(randomUUID()), newConn = connection(randomUUID());
  // Given a store bound by the previous connection (the original install).
  let db = openDb(source);
  addSession(db);
  bindSource(source, oldConn);
  const head = journalHead(db);

  // And a live epoch already acked under the previous instance.
  const spool = join(home, "cloud", "spool.sqlite");
  const blobs = new CloudBlobs(spool);
  assert.equal(blobs.acquire(), true);
  blobs.initialize({
    streamId: liveStream(oldConn.instanceId, head.sourceDomain), deviceId: DEVICE,
    sourceDomain: head.sourceDomain, sequence: 7, cut: head.cut,
  });
  // And the re-approval staged a fresh initial baseline the server must reject
  // with migration_epoch_required (the device+source already has a live epoch).
  await stageBaseline(home, db, blobs, oldConn, managed, "initial");
  assert.notEqual(blobs.pendingMigration(DEVICE, head.sourceDomain), null);
  blobs.close();
  db.close();

  // When the next sync runs under the re-approved connection (new instanceId).
  atomicCloudJson(home, "connection.json", newConn);
  const self = {
    accountId: "account-a", deviceId: DEVICE, generation: 1, shardId: "activity-00",
    scopes: ["activity:read", "activity:ingest"], ingestEnabled: true, version: 1,
    consent: managed,
  };
  const fetcher = async () => new Response(JSON.stringify(self), {
    status: 200, headers: { "content-type": "application/json" },
  });
  const status = await runCloudStep(home, source, { fetcher, resume: true });

  // Then the existing epoch resumes instead of re-delivering the stale baseline.
  assert.equal(status.phase, "caught-up");
  assert.equal(status.sourceDomain, head.sourceDomain);
  assert.equal(status.acknowledgedCut, head.cut);
  const check = new CloudBlobs(spool);
  assert.equal(check.acquire(), true);
  t.after(() => check.close());
  assert.equal(check.pendingMigration(DEVICE, head.sourceDomain), null);
  assert.equal(check.liveStreamFor(DEVICE, head.sourceDomain),
    liveStream(oldConn.instanceId, head.sourceDomain));
  assert.equal(check.cursor(liveStream(oldConn.instanceId, head.sourceDomain)).ack_sequence, 7);
});

test("stale-baseline cleanup preserves every other stream and picks the furthest acked epoch", async t => {
  const home = makeTempDir();
  t.after(() => removeDir(home));
  const source = join(home, "activity.sqlite");
  const oldConn = connection(randomUUID()), newConn = connection(randomUUID());
  let db = openDb(source);
  addSession(db);
  bindSource(source, oldConn);
  const head = journalHead(db);
  const spool = join(home, "cloud", "spool.sqlite");
  const blobs = new CloudBlobs(spool);
  assert.equal(blobs.acquire(), true);
  // Two live epochs on the same device+source: the furthest acked wins.
  const live1 = liveStream(oldConn.instanceId, head.sourceDomain);
  const live2 = liveStream(randomUUID(), head.sourceDomain);
  blobs.initialize({ streamId: live1, deviceId: DEVICE, sourceDomain: head.sourceDomain, sequence: 3, cut: head.cut });
  blobs.initialize({ streamId: live2, deviceId: DEVICE, sourceDomain: head.sourceDomain, sequence: 9, cut: head.cut });
  // Foreign spool that must survive: another device's live stream, another
  // source's staged migration, and an already-acked in-progress backfill.
  const foreignLive = liveStream(randomUUID(), head.sourceDomain);
  blobs.initialize({ streamId: foreignLive, deviceId: "device-b", sourceDomain: head.sourceDomain, sequence: 5, cut: head.cut });
  const foreignDomain = randomUUID();
  const foreignMigration = `cloud-migration:${randomUUID()}:${foreignDomain}:${randomUUID()}`;
  blobs.initialize({ streamId: foreignMigration, deviceId: DEVICE, sourceDomain: foreignDomain, sequence: 0, cut: 0 });
  assert.equal(blobs.liveStreamFor(DEVICE, head.sourceDomain), live2);
  const backfillId = randomUUID();
  blobs.initialize({ streamId: `cloud-migration:${randomUUID()}:${head.sourceDomain}:${backfillId}`,
    deviceId: DEVICE, sourceDomain: head.sourceDomain, sequence: 1, cut: 0 });
  // The stale unacked initial staged by the re-approval.
  await stageBaseline(home, db, blobs, oldConn, managed, "initial");
  blobs.close();
  db.close();

  atomicCloudJson(home, "connection.json", newConn);
  const self = {
    accountId: "account-a", deviceId: DEVICE, generation: 1, shardId: "activity-00",
    scopes: ["activity:read", "activity:ingest"], ingestEnabled: true, version: 1,
    consent: managed,
  };
  const fetcher = async () => new Response(JSON.stringify(self), {
    status: 200, headers: { "content-type": "application/json" },
  });
  const status = await runCloudStep(home, source, { fetcher, resume: true });
  assert.equal(status.phase, "caught-up");
  const check = new CloudBlobs(spool);
  assert.equal(check.acquire(), true);
  t.after(() => check.close());
  // The stale initial is gone; everything else survives untouched.
  assert.equal(check.pendingMigration(DEVICE, head.sourceDomain), null);
  assert.notEqual(check.cursor(live1), null);
  assert.notEqual(check.cursor(live2), null);
  assert.equal(check.cursor(live1).ack_sequence, 3);
  assert.equal(check.liveStreamFor("device-b", head.sourceDomain), foreignLive);
  assert.equal(check.cursor(foreignLive).ack_sequence, 5);
  assert.notEqual(check.cursor(foreignMigration), null);
  assert.equal(check.backfillAcked(head.sourceDomain, backfillId), true);
});

test("backfillAcked follows the source across connection instances", t => {
  const home = makeTempDir();
  t.after(() => removeDir(home));
  const spool = join(home, "cloud", "spool.sqlite");
  const blobs = new CloudBlobs(spool);
  assert.equal(blobs.acquire(), true);
  t.after(() => blobs.close());
  const domain = randomUUID(), snapshotId = randomUUID();
  assert.equal(blobs.backfillAcked(domain, snapshotId), false);
  blobs.initialize({
    streamId: `cloud-migration:${randomUUID()}:${domain}:${snapshotId}`,
    deviceId: DEVICE, sourceDomain: domain, sequence: 0, cut: 0,
  });
  // Staged but never acked: not done, whatever instance staged it.
  assert.equal(blobs.backfillAcked(domain, snapshotId), false);
  const other = randomUUID();
  assert.equal(blobs.backfillAcked(domain, other), false);
  blobs.initialize({
    streamId: `cloud-migration:${randomUUID()}:${domain}:${other}`,
    deviceId: DEVICE, sourceDomain: domain, sequence: 2, cut: 0,
  });
  // An acked backfill under any instance id counts for this source.
  assert.equal(blobs.backfillAcked(domain, other), true);
  assert.equal(blobs.backfillAcked(randomUUID(), other), false);
});
