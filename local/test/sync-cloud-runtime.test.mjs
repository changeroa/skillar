import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import test from "node:test";
import {
  fixture as remoteFixture, context, grant, principal,
} from "../../worker/test/helpers/activity-runtime.mjs";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";

const { requestRuntimeCapture, runCloudRuntimeStep, runtimeStream } = await distImport("sync/cloud-runtime.js");
const { runCloudStep } = await distImport("sync/cloud.js");
const { startCloudSync } = await distImport("sync/cloud-runner.js");
const { atomicCloudJson } = await distImport("sync/cloud-connection.js");
const { openDb } = await distImport("store/db.js");
const { journalHead } = await distImport("sync/journal.js");
const { CloudBlobs } = await distImport("sync/cloud-blobs.js");
const { liveStream } = await distImport("sync/cloud-jobs.js");
const { bindSource } = await distImport("sync/cloud-prepare.js");

async function fixture(t) {
  const home = makeTempDir();
  t.after(() => removeDir(home));
  const remote = await remoteFixture(t), source = join(home, "source.sqlite");
  const db = openDb(source);
  t.after(() => db.close());
  db.prepare("INSERT INTO sessions(id,runtime,started_at) VALUES('s','codex',100)").run();
  const connection = {
    version: 1, instanceId: randomUUID(), origin: "https://skillar.sh",
    accountId: "account-a", deviceId: "device-a", generation: 1,
    token: "T".repeat(43), expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
  atomicCloudJson(home, "connection.json", connection);
  bindSource(source, connection);
  const head = journalHead(db);
  await remote.head(head.cut, 0, head.sourceDomain);
  const spoolPath = join(home, "cloud", "spool.sqlite");
  const spool = new CloudBlobs(spoolPath);
  spool.acquire();
  spool.initialize({ streamId: liveStream(connection.instanceId, head.sourceDomain),
    deviceId: connection.deviceId, sourceDomain: head.sourceDomain, sequence: 0, cut: head.cut });
  spool.close();
  const calls = [];
  let selected = grant(), loseReceipt = false, wrongReceipt = false, captureCount = 0;
  let current = context();
  const setConsent = async value => { selected = value; await remote.consent(value); };
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init.body });
    if (path === "/v1/devices/self") return Response.json({
      ...principal(), ingestEnabled: true, version: selected.version ?? 1, consent: selected,
      issuer: undefined, sessionId: undefined, kind: undefined,
    });
    const result = await remote.api(path, JSON.parse(init.body), principal());
    if (path === "/v1/activity/context" && loseReceipt) {
      loseReceipt = false;
      assert.equal(result.status, 200, await result.clone().text());
      throw new TypeError("fixture lost committed runtime receipt");
    }
    if (path === "/v1/activity/context" && wrongReceipt) {
      wrongReceipt = false;
      const receipt = await result.json();
      return Response.json({ ...receipt, sourceCut: receipt.sourceCut + 1 });
    }
    return result;
  };
  const progress = {
    version: 1, instanceId: connection.instanceId, updatedAtMs: 100,
    phase: "caught-up", sourceDomain: head.sourceDomain, acknowledgedCut: head.cut,
    excluded: 0, attempts: 0, liveTurns: 0,
  };
  const capture = async request => {
    captureCount++;
    assert.equal(request.kind, "capture-runtime");
    assert.match(request.id, /^[a-f0-9-]{36}$/);
    assert.equal(request.sourceDomain, head.sourceDomain);
    assert.equal(request.sourceCut, head.cut);
    const latest = journalHead(db);
    return { sourceDomain: latest.sourceDomain, sourceCut: latest.cut, context: current };
  };
  return {
    home, db, source, remote, calls, progress, connection, head, spoolPath, capture,
    fetcher, setConsent, setContext(value) { current = value; },
    loseReceipt() { loseReceipt = true; }, wrongReceipt() { wrongReceipt = true; },
    captures() { return captureCount; },
    step(overrides = {}) {
      return runCloudRuntimeStep(home, source, progress, capture, { fetcher, ...overrides });
    },
  };
}

test("unchanged rows with changing active state and counters commit new pinned revisions", async t => {
  // Given a caught-up source and a full seven-kind grant.
  const f = await fixture(t);
  assert.equal((await f.step()).phase, "caught-up");
  const first = (await f.remote.send("read", { sourceDomain: f.head.sourceDomain })).body;
  f.setContext(context({ capturedAtMs: 101 })); // Timestamp alone is not a new state.
  await f.step();
  assert.equal(f.calls.filter(call => call.path === "/v1/activity/context").length, 1);
  f.setContext(context({
    capturedAtMs: 102, activeRequests: [], ingest: { accepted: 4, rejected: 2, dropped: 1 },
  }));
  // When live state changes without a journal mutation.
  assert.equal((await f.step()).phase, "caught-up");
  // Then a new exact revision, not invented row-derived state, is available.
  assert.deepEqual(journalHead(f.db), f.head);
  const second = (await f.remote.send("read", { sourceDomain: f.head.sourceDomain })).body;
  assert.equal(first.sequence, 1); assert.equal(second.sequence, 2);
  assert.equal(second.sourceCut, first.sourceCut);
  assert.deepEqual(second.context.activeRequests, []);
  assert.deepEqual(second.context.ingest, { accepted: 4, rejected: 2, dropped: 1 });
  const pinned = await f.remote.send("read", { sourceDomain: f.head.sourceDomain, sequence: 1 });
  assert.deepEqual(pinned.body.context, context());
});

test("lost runtime receipt preserves exact pending request and blobs across reopen", async t => {
  // Given a remote commit whose response is lost before the local ACK.
  const f = await fixture(t);
  f.loseReceipt();
  assert.equal((await f.step()).phase, "retry");
  const stream = runtimeStream(f.connection.instanceId, f.head.sourceDomain);
  let blobs = new CloudBlobs(f.spoolPath);
  const pending = blobs.pending(stream), job = JSON.parse(pending.payload);
  const chunkBytes = job.refs.map(ref => Buffer.from(blobs.get(ref.hash)).toString());
  assert.equal(blobs.cursor(stream).ack_sequence, 0);
  blobs.close();
  f.setContext(context({ activeRequests: ["NEWER_NOT_YET_SENT"] }));
  // When CDC reconciliation runs and the runtime sender retries after a restart.
  const reconciled = await runCloudStep(f.home, f.source, { resume: true, fetcher: f.fetcher });
  assert.equal(reconciled.phase, "caught-up"); // Runtime prefix is never mistaken for CDC.
  assert.equal((await f.step()).phase, "caught-up");
  // Then no new capture replaced the pending request, and only verified bytes were ACKed.
  assert.equal(f.captures(), 1);
  const commits = f.calls.filter(call => call.path === "/v1/activity/context");
  assert.equal(commits.length, 2); assert.equal(commits[0].body, commits[1].body);
  const uploads = f.calls.filter(call => call.path === "/v1/activity/chunks");
  assert.deepEqual(uploads.map(call => call.body), [...chunkBytes, ...chunkBytes]);
  blobs = new CloudBlobs(f.spoolPath);
  assert.equal(blobs.pending(stream), null);
  assert.equal(blobs.cursor(stream).ack_sequence, 1);
  blobs.close();
  assert.equal((await f.remote.rows("SELECT count(*) n FROM runtime_contexts"))[0].n, 1);
});

test("idle runtime renews at half the current retention window across reopen", async t => {
  // Given an unchanged runtime acknowledged under a one-day projection policy.
  const f = await fixture(t), start = 1_000_000, halfDay = 43_200_000;
  await f.setConsent(grant({ retention: { contentDays: 30, projectionDays: 1, backupDays: 0 } }));
  assert.equal((await f.step({ now: () => start })).phase, "caught-up");
  await f.step({ now: () => start + halfDay - 1 });
  assert.equal(f.calls.filter(call => call.path === "/v1/activity/context").length, 1);
  // When the unchanged state reaches the renewal boundary in a reopened sender.
  assert.equal((await f.step({ now: () => start + halfDay })).phase, "caught-up");
  // Then a fresh revision renews storage without changing the source cut.
  const commits = f.calls.filter(call => call.path === "/v1/activity/context").map(call => JSON.parse(call.body));
  assert.deepEqual(commits.map(commit => commit.sequence), [1, 2]);
  assert.equal(commits[0].sourceCut, commits[1].sourceCut);
  assert.notEqual(commits[0].batchId, commits[1].batchId);
  assert.equal(commits[0].contentHash, commits[1].contentHash);
});

test("lost ACK does not restart the idle renewal clock", async t => {
  // Given a runtime whose exact remote receipt was lost.
  const f = await fixture(t), start = 1_000_000, halfDay = 43_200_000;
  await f.setConsent(grant({ retention: { contentDays: 1, projectionDays: 30, backupDays: 0 } }));
  f.loseReceipt();
  assert.equal((await f.step({ now: () => start })).phase, "retry");
  // When the exact pending request is acknowledged at its renewal boundary.
  await f.step({ now: () => start + halfDay });
  await f.step({ now: () => start + halfDay });
  // Then the retry remains byte-identical and the next idle step renews immediately.
  const commits = f.calls.filter(call => call.path === "/v1/activity/context");
  assert.equal(commits.length, 3);
  assert.equal(commits[0].body, commits[1].body);
  assert.equal(JSON.parse(commits[2].body).sequence, 2);
});

test("a lost receipt remains recoverable after remote runtime bytes expire", async t => {
  // Given accepted runtime whose ACK was lost, then reclaimed by native cleanup.
  const f = await fixture(t), start = 1_000_000, day = 86_400_000;
  await f.setConsent(grant({ retention: { contentDays: 1, projectionDays: 1, backupDays: 0 } }));
  f.loseReceipt();
  assert.equal((await f.step({ now: () => start })).phase, "retry");
  const [{ received_at_ms }] = await f.remote.rows("SELECT received_at_ms FROM runtime_contexts");
  await f.remote.send("clock", { nowMs: received_at_ms + day });
  assert.equal((await f.remote.send("runtimeSweep")).body.deleted, 1);
  // When the exact pending request retries after its upload intents became terminal.
  assert.equal((await f.step({ now: () => start + day })).phase, "caught-up");
  await f.step({ now: () => start + day });
  // Then the tombstoned receipt ACKs without resurrecting bytes, and renewal advances.
  const commits = f.calls.filter(call => call.path === "/v1/activity/context");
  assert.equal(commits[0].body, commits[1].body);
  assert.equal(JSON.parse(commits[2].body).sequence, 2);
  assert.equal((await f.remote.bucket.list()).objects.length, 1);
  const [{ received_at_ms: renewedAt }] = await f.remote.rows(
    "SELECT received_at_ms FROM runtime_contexts WHERE sequence=2");
  await f.remote.send("clock", { nowMs: renewedAt });
  assert.equal((await f.remote.send("read", { sourceDomain: f.head.sourceDomain })).body.sequence, 2);
});

test("wrong runtime receipt never acknowledges durable pending bytes", async t => {
  // Given a server response with a mismatched source cut.
  const f = await fixture(t); f.wrongReceipt();
  // When the client checks the runtime receipt.
  const result = await f.step();
  // Then the immutable pending request remains retryable instead of claiming exact state.
  assert.equal(result.phase, "quarantine");
  assert.equal(result.code, "invalid_remote_receipt");
  const blobs = new CloudBlobs(f.spoolPath);
  assert.ok(blobs.pending(runtimeStream(f.connection.instanceId, f.head.sourceDomain)));
  assert.equal(blobs.cursor(runtimeStream(f.connection.instanceId, f.head.sourceDomain)).ack_sequence, 0);
  blobs.close();
});

test("a moved main source cut reconciles CDC before serializing or uploading runtime", async t => {
  // Given an acknowledged cut that the main process has already passed.
  const f = await fixture(t);
  f.db.prepare("UPDATE sessions SET first_prompt='new' WHERE id='s'").run();
  // When capture returns the actual main-process head.
  const result = await f.step();
  // Then neither context chunks nor a false exact-state claim are sent.
  assert.equal(result.phase, "queued");
  assert.equal(f.calls.every(call => call.path === "/v1/devices/self"), true);
  assert.equal((await f.remote.rows("SELECT count(*) n FROM runtime_contexts"))[0].n, 0);
});

test("source advancement during RPC invalidates even a matching capture reply", async t => {
  // Given an exact capture followed by a source mutation before delivery resumes.
  const f = await fixture(t);
  const capture = async request => {
    const value = await f.capture(request);
    f.db.prepare("UPDATE sessions SET first_prompt='during RPC' WHERE id='s'").run();
    return value;
  };
  // When the worker checks the source head after the correlated reply.
  const result = await runCloudRuntimeStep(f.home, f.source, f.progress, capture, { fetcher: f.fetcher });
  // Then it reconciles source first without sending runtime bytes.
  assert.equal(result.phase, "queued");
  assert.equal(f.calls.every(call => call.path === "/v1/devices/self"), true);
});

test("local-only, metadata and partial grants never request or serialize main state", async t => {
  // Given a caught-up source without full runtime permission.
  const f = await fixture(t);
  for (const consent of [
    { mode: "local-only" },
    { mode: "metadata", version: 1, grantedAtMs: 0,
      scope: { deviceId: "device-a", projectIds: ["device:device-a"], rootIds: [] } },
    grant({ contentKinds: ["prompt"] }),
  ]) {
    await f.setConsent(consent);
    // When reconciliation runs.
    await f.step();
  }
  // Then no main state was requested and only permission reads occurred.
  assert.equal(f.captures(), 0);
  assert.equal(f.calls.every(call => call.path === "/v1/devices/self"), true);
  assert.equal((await f.remote.rows("SELECT count(*) n FROM content_uploads"))[0].n, 0);
});

test("disconnected daemon creates neither worker nor network nor capture request", async t => {
  // Given a default disconnected daemon home.
  const home = makeTempDir(); t.after(() => removeDir(home));
  t.mock.method(globalThis, "fetch", () => { assert.fail("disconnected daemon used network"); });
  const capture = () => { assert.fail("disconnected daemon captured runtime"); };
  // When its runner starts without a connection.
  const runner = startCloudSync(home, join(home, "absent.sqlite"), () => {}, capture);
  // Then no worker/spool/source was created; close removes its only filesystem watcher.
  runner.close();
  assert.equal(existsSync(join(home, "cloud")), false);
  assert.equal(existsSync(join(home, "absent.sqlite")), false);
});

test("main capture RPC correlates independent out-of-order replies by request ID", { timeout: 5000 }, async t => {
  // Given two simultaneous requests over a real worker MessageChannel.
  const { port1, port2 } = new MessageChannel();
  t.after(() => { port1.close(); port2.close(); });
  const first = { kind: "capture-runtime", id: randomUUID(), sourceDomain: "source", sourceCut: 1 };
  const second = { ...first, id: randomUUID(), sourceCut: 2 };
  const captured = cut => ({ sourceDomain: "source", sourceCut: cut, context: context() });
  const requests = [];
  port2.on("message", request => {
    requests.push(request);
    if (requests.length !== 2) return;
    port2.postMessage({ kind: "runtime-captured", id: randomUUID(), capture: captured(999) });
    port2.postMessage({ kind: "runtime-captured", id: second.id, capture: captured(2) });
    port2.postMessage({ kind: "runtime-captured", id: first.id, capture: captured(1) });
  });
  // When replies arrive out of order, preceded by an unrelated reply.
  const values = await Promise.all([
    requestRuntimeCapture(port1, first), requestRuntimeCapture(port1, second),
  ]);
  // Then each request resolves to its own value and removes its own listener.
  assert.deepEqual(values, [captured(1), captured(2)]);
  assert.equal(port1.listenerCount("message"), 0);
});
