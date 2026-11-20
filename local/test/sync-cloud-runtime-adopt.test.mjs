import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";
import { addSession, openDb, journalHead } from "./helpers/sync.mjs";

const { CloudBlobs } = await distImport("sync/cloud-blobs.js");
const { runCloudRuntimeStep, runtimeStream } = await distImport("sync/cloud-runtime.js");
const { bindSource } = await distImport("sync/cloud-prepare.js");
const { atomicCloudJson } = await distImport("sync/cloud-connection.js");
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
const runtimeContext = () => ({
  schemaVersion: 1, capturedAtMs: 100, activeRequests: [],
  ingest: { accepted: 0, rejected: 0, dropped: 0 }, tz: "Asia/Seoul",
});

// A synthetic server encoding the verified rule (worker/src/activity/
// runtime-api.ts:92-94): runtime commits are deduplicated by
// device+source+sequence; the same sequence with a different payload is
// rejected with batch_conflict, an identical payload returns the receipt.
function serverStub(self) {
  const runtimes = new Map(); // sequence -> exact request body
  const calls = [];
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === "/v1/devices/self") return Response.json(self);
    const body = JSON.parse(init.body);
    if (path === "/v1/activity/chunks") return Response.json({
      stored: true,
      chunk: { index: body.index, revision: body.revision,
        plaintextHash: body.plaintextHash, bytes: body.bytes },
    });
    if (path === "/v1/activity/context") {
      const prior = runtimes.get(body.sequence);
      if (prior !== undefined && prior !== init.body) {
        return Response.json({ error: "batch_conflict" }, { status: 409 });
      }
      runtimes.set(body.sequence, init.body);
      return Response.json({
        sequence: body.sequence, sourceCut: body.sourceCut, contentHash: body.contentHash,
      });
    }
    throw new Error(`unexpected path ${path}`);
  };
  return { runtimes, calls, fetcher };
}

async function fixture(t, conn) {
  const home = makeTempDir();
  t.after(() => removeDir(home));
  const source = join(home, "activity.sqlite");
  const db = openDb(source);
  addSession(db);
  bindSource(source, conn);
  const head = journalHead(db);
  db.close();
  atomicCloudJson(home, "connection.json", conn);
  const self = {
    accountId: "account-a", deviceId: DEVICE, generation: 1, shardId: "activity-00",
    scopes: ["activity:read", "activity:ingest"], ingestEnabled: true, version: 1,
    consent: managed,
  };
  const server = serverStub(self);
  const progress = {
    version: 1, instanceId: conn.instanceId, updatedAtMs: 100,
    phase: "caught-up", sourceDomain: head.sourceDomain, acknowledgedCut: head.cut,
    excluded: 0, attempts: 0, liveTurns: 0,
  };
  const capture = async () => ({
    sourceDomain: head.sourceDomain, sourceCut: head.cut, context: runtimeContext(),
  });
  return {
    home, source, head, server, progress,
    spoolPath: join(home, "cloud", "spool.sqlite"),
    step: () => runCloudRuntimeStep(home, source, progress, capture, { fetcher: server.fetcher }),
  };
}

test("re-approval resumes the device+source runtime epoch instead of restarting at sequence 1", async t => {
  // Given an old instance whose runtime epoch committed sequence 1 remotely.
  const oldConn = connection(randomUUID());
  const f = await fixture(t, oldConn);
  assert.equal((await f.step()).phase, "caught-up");
  const oldStream = runtimeStream(oldConn.instanceId, f.head.sourceDomain);
  assert.equal(f.server.runtimes.size, 1);
  let spool = new CloudBlobs(f.spoolPath);
  assert.equal(spool.acquire(), true);
  assert.equal(spool.cursor(oldStream).ack_sequence, 1);
  spool.close();

  // When the same device is re-approved (new instanceId) and an unacknowledged
  // stream exists under that new instance (the incident spool: ack 0, seq 1
  // pending), the sender must resume the old epoch, not restart at sequence 1.
  const newConn = connection(randomUUID());
  const orphanStream = runtimeStream(newConn.instanceId, f.head.sourceDomain);
  spool = new CloudBlobs(f.spoolPath);
  assert.equal(spool.acquire(), true);
  spool.initialize({ streamId: orphanStream, deviceId: DEVICE,
    sourceDomain: f.head.sourceDomain, sequence: 0, cut: 0 });
  spool.close();
  atomicCloudJson(f.home, "connection.json", newConn);
  f.progress.instanceId = newConn.instanceId;

  assert.equal((await f.step()).phase, "caught-up");
  assert.equal(f.server.runtimes.size, 2);
  assert.equal(JSON.parse(f.server.runtimes.get(2)).sequence, 2);

  // And the old epoch advanced while the new-instance stream was never used
  // and its spool rows survive untouched (no discard).
  const check = new CloudBlobs(f.spoolPath);
  assert.equal(check.acquire(), true);
  t.after(() => check.close());
  assert.equal(check.cursor(oldStream).ack_sequence, 2);
  assert.equal(check.runtimeStreamFor(DEVICE, f.head.sourceDomain), oldStream);
  assert.notEqual(check.cursor(orphanStream), null);
  assert.equal(check.cursor(orphanStream).ack_sequence, 0);
});

test("without a local epoch the sequence-1 restart is rejected as batch_conflict (incident repro)", async t => {
  // Given a server that already holds a different sequence-1 runtime commit
  // (the old instance's epoch) and a fresh local spool under a new instance.
  const conn = connection(randomUUID());
  const f = await fixture(t, conn);
  f.server.runtimes.set(1, JSON.stringify({ sequence: 1, stale: "old-epoch-payload" }));

  // When the runtime sender stages sequence 1, the server rejects it exactly
  // as in the incident and the step quarantines without acking anything.
  const status = await f.step();
  assert.equal(status.phase, "quarantine");
  assert.equal(status.code, "batch_conflict");
  const spool = new CloudBlobs(f.spoolPath);
  assert.equal(spool.acquire(), true);
  t.after(() => spool.close());
  const stream = runtimeStream(conn.instanceId, f.head.sourceDomain);
  assert.notEqual(spool.pending(stream), null); // exact pending batch preserved
  assert.equal(spool.cursor(stream).ack_sequence, 0);
});

test("runtimeStreamFor picks the furthest acked epoch and never a foreign device or source", async t => {
  const home = makeTempDir();
  t.after(() => removeDir(home));
  const blobs = new CloudBlobs(join(home, "cloud", "spool.sqlite"));
  assert.equal(blobs.acquire(), true);
  t.after(() => blobs.close());
  const domain = randomUUID();
  const rt1 = runtimeStream(randomUUID(), domain);
  const rt2 = runtimeStream(randomUUID(), domain);
  const foreignDevice = runtimeStream(randomUUID(), domain);
  const foreignSource = runtimeStream(randomUUID(), randomUUID());
  blobs.initialize({ streamId: rt1, deviceId: DEVICE, sourceDomain: domain, sequence: 3, cut: 10 });
  blobs.initialize({ streamId: rt2, deviceId: DEVICE, sourceDomain: domain, sequence: 9, cut: 20 });
  blobs.initialize({ streamId: foreignDevice, deviceId: "device-b", sourceDomain: domain, sequence: 12, cut: 30 });
  blobs.initialize({ streamId: foreignSource, deviceId: DEVICE, sourceDomain: randomUUID(), sequence: 12, cut: 30 });
  assert.equal(blobs.runtimeStreamFor(DEVICE, domain), rt2);
  assert.equal(blobs.runtimeStreamFor("device-b", domain), foreignDevice);
  assert.equal(blobs.runtimeStreamFor("device-c", domain), null);
  // A further acked new-instance stream wins over a stale epoch.
  const renewed = runtimeStream(randomUUID(), domain);
  blobs.initialize({ streamId: renewed, deviceId: DEVICE, sourceDomain: domain, sequence: 15, cut: 40 });
  assert.equal(blobs.runtimeStreamFor(DEVICE, domain), renewed);
});
