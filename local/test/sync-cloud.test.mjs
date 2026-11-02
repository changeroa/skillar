import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { distImport } from "./_helpers.mjs";
import { fixture, grant } from "./helpers/sync-cloud.mjs";

const { runCloudStep, pauseCloud } = await distImport("sync/cloud.js");
const { prepareCloudSnapshot } = await distImport("sync/cloud-prepare.js");
const { journalHead } = await distImport("sync/journal.js");
const { CloudBlobs } = await distImport("sync/cloud-blobs.js");
const { liveStream } = await distImport("sync/cloud-jobs.js");
const { restoreCloud } = await distImport("sync/cloud-restore.js");
const { rollbackCloud } = await distImport("sync/cloud-rollback.js");
const { openDb } = await distImport("store/db.js");
const { readRows } = await distImport("sync/restore-rows.js");

test("lost receipt body persists retry and automatically resumes identical pending bytes", async t => {
  const f = await fixture(t);
  let now = Date.now(), interrupted = false;
  t.mock.method(Date, "now", () => now);
  t.mock.method(Math, "random", () => 0);
  await f.setConsent(grant(null));
  const fetcher = async (url, init) => {
    const response = await f.fetcher(url, init);
    if (!interrupted && new URL(url).pathname === "/v1/activity/batches") {
      interrupted = true;
      assert.equal(response.status, 200);
      await response.body.cancel();
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"batchId":')); },
        pull(controller) { controller.error(new TypeError("terminated")); },
      }));
    }
    return response;
  };
  const step = () => runCloudStep(f.home, f.source, { fetcher });
  assert.equal((await step()).phase, "queued");
  assert.equal((await step()).phase, "queued");
  const baseline = journalHead(f.db);
  f.db.prepare("INSERT INTO sessions(id,runtime,started_at,first_prompt) VALUES('new','codex',2000,'body loss')").run();
  const progress = await step();
  assert.equal(progress.phase, "retry");
  assert.equal(progress.code, "network_unavailable");
  let spool = new CloudBlobs(join(f.home, "cloud", "spool.sqlite"));
  const stream = liveStream(f.connection.instanceId, baseline.sourceDomain);
  const pending = spool.pending(stream);
  assert.ok(pending);
  assert.equal(spool.cursor(stream).ack_cut, baseline.cut);
  spool.close();
  const calls = f.calls.length;
  assert.equal((await step()).phase, "retry");
  assert.equal(f.calls.length, calls);
  now = progress.retryAtMs; // Advance the clock to the scheduler's exact signal, without a delay.
  assert.equal((await step()).acknowledgedCut, journalHead(f.db).cut);
  const sent = f.calls.filter(call => call.path === "/v1/activity/batches");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].body, sent[1].body);
  assert.equal((await f.remote.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 1);
  spool = new CloudBlobs(join(f.home, "cloud", "spool.sqlite"));
  assert.equal(spool.pending(stream), null);
  assert.equal(spool.cursor(stream).ack_sequence, pending.sequence);
  spool.close();
});

test("connection alone, metadata mode, and disabled ingestion never serialize source rows", async t => {
  const f = await fixture(t);
  f.db.prepare("INSERT INTO sessions(id,runtime,started_at,first_prompt) VALUES('s','codex',1,'LOCAL ONLY')").run();
  const before = journalHead(f.db);
  const step = () => runCloudStep(f.home, f.source, { fetcher: f.fetcher });
  assert.equal((await step()).phase, "local-only");
  const { contentKinds, serverProcessingAcknowledged, ...metadata } = grant(null);
  await f.setConsent({ ...metadata, mode: "metadata" });
  assert.equal((await step()).phase, "metadata-only");
  await f.setConsent(grant(null));
  f.setEnabled(false);
  assert.equal((await step()).phase, "disabled");
  assert.deepEqual(journalHead(f.db), before);
  assert.equal(f.calls.every(call => call.path === "/v1/devices/self"), true);
  assert.deepEqual(await f.remote.rows("SELECT * FROM content_uploads"), []);
});

test("snapshot checkpoint, concurrent CDC, lost final ACK and restart preserve exact accepted bytes", async t => {
  const f = await fixture(t);
  const prompt = `Unicode 한글 🧪\n${"raw prompt\n".repeat(30000)}`;
  f.db.prepare("INSERT INTO sessions(id,runtime,started_at,first_prompt) VALUES('s','codex',100,?)").run(prompt);
  const prepared = await prepareCloudSnapshot(f.home, f.source);
  await f.setConsent(grant(prepared));
  const step = options => runCloudStep(f.home, f.source, { fetcher: f.fetcher, ...options });
  assert.equal((await step()).phase, "queued"); // One staged page, not a snapshot ACK.
  let spool = new CloudBlobs(join(f.home, "cloud", "spool.sqlite"));
  const streamId = liveStream(f.connection.instanceId, prepared.sourceDomain);
  assert.equal(spool.cursor(streamId), null);
  spool.close();
  f.db.prepare("UPDATE sessions SET first_prompt='changed after cut' WHERE id='s'").run();
  f.loseNextReceipt("/v1/activity/migrations/complete");
  let progress;
  for (let units = 0; units < 129; units++) {
    progress = await step();
    if (progress.phase !== "queued") break;
  }
  assert.equal(progress.phase, "retry");
  assert.equal((await f.remote.rows("SELECT state FROM migration_runs"))[0].state, "complete");
  assert.equal((await step({ resume: true })).acknowledgedCut, prepared.cut);
  f.loseNextReceipt("/v1/activity/batches");
  assert.equal((await step()).phase, "retry");
  const finalRequests = f.calls.filter(call => call.path === "/v1/activity/batches");
  assert.equal(finalRequests.length, 1);
  spool = new CloudBlobs(join(f.home, "cloud", "spool.sqlite"));
  const pending = spool.pending(streamId);
  assert.ok(pending);
  assert.equal(spool.cursor(streamId).ack_cut, prepared.cut);
  spool.close();
  assert.equal((await step({ resume: true })).acknowledgedCut, journalHead(f.db).cut);
  const replay = f.calls.filter(call => call.path === "/v1/activity/batches");
  assert.equal(replay[0].body, replay[1].body);
  assert.equal((await f.remote.rows("SELECT * FROM ingest_receipts")).length, 1);
  const batch = JSON.parse(replay[0].body);
  const restored = await f.remote.send("readCdc", {
    sourceDomain: prepared.sourceDomain, batchId: batch.batchId,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.rows.find(row => row.table === "sessions").values.first_prompt, "changed after cut");
  const baseline = await f.remote.send("export", {
    deviceId: "device-a", generation: 1, sourceDomain: prepared.sourceDomain,
    snapshotId: prepared.snapshotId, page: 0,
  });
  assert.equal(baseline.body.document.rows.find(row => row.table === "sessions").values.first_prompt, prompt);
  assert.equal((await step()).phase, "caught-up");
  assert.ok(existsSync(join(f.home, "cloud", "spool.sqlite")));
  assert.equal((await rollbackCloud(f.home, f.fetcher)).rollbackRequested, true);
  assert.equal((await step()).phase, "paused");
  f.setEnabled(false);
  const destination = join(f.home, "restored.sqlite");
  const reference = {
    deviceId: "device-a", generation: 1,
    sourceDomain: prepared.sourceDomain, snapshotId: prepared.snapshotId,
  };
  const result = await restoreCloud(f.home, destination, reference, f.fetcher);
  assert.equal(result.cut, journalHead(f.db).cut);
  assert.equal(result.throughSequence, 1);
  const restoredDb = openDb(destination);
  try {
    const clock = JSON.parse(restoredDb.prepare("SELECT clock_json FROM sync_restore_state").get().clock_json);
    assert.deepEqual(readRows(restoredDb, result.cut, clock), readRows(f.db, result.cut));
    assert.notEqual(restoredDb.prepare("SELECT domain FROM recording_clock").get().domain,
      f.db.prepare("SELECT domain FROM recording_clock").get().domain);
    assert.notEqual(journalHead(restoredDb).sourceDomain, prepared.sourceDomain);
    assert.equal(journalHead(restoredDb).cut, 0);
    assert.equal(restoredDb.prepare("SELECT count(*) n FROM sync_outbox").get().n, 0);
  } finally {
    restoredDb.close();
  }
  await assert.rejects(() => restoreCloud(f.home, destination, reference, f.fetcher), /destination_exists/);
});

test("future-only baseline skips history and revoked pending consent cannot send durable raw bytes", async t => {
  const f = await fixture(t);
  f.db.prepare("INSERT INTO sessions(id,runtime,started_at,first_prompt) VALUES('old','codex',100,'old raw')").run();
  await f.setConsent(grant(null, { contentKinds: ["prompt"] }));
  const step = options => runCloudStep(f.home, f.source, { fetcher: f.fetcher, ...options });
  assert.equal((await step()).phase, "queued");
  assert.equal((await step()).phase, "queued");
  assert.equal((await step()).phase, "caught-up");
  f.db.prepare("INSERT INTO sessions(id,runtime,started_at,first_prompt) VALUES('new','codex',2000,'new allowed')").run();
  f.loseNextReceipt("/v1/activity/batches");
  assert.equal((await step()).phase, "retry");
  const before = f.calls.length;
  await f.setConsent({ mode: "local-only" });
  assert.equal((await step({ resume: true })).phase, "local-only");
  assert.equal(f.calls.slice(before).every(call => call.path === "/v1/devices/self"), true);
  pauseCloud(f.home);
  const pausedAt = f.calls.length;
  assert.equal((await step()).phase, "paused");
  assert.equal(f.calls.length, pausedAt);
});
