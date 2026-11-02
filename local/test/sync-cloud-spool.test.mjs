import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { distImport, makeTempDir, removeDir, PACKAGE_ROOT } from "./_helpers.mjs";
import { addSession, consent, scope, openDb, journalHead } from "./helpers/sync.mjs";

const { CloudBlobs } = await distImport("sync/cloud-blobs.js");
const { initializeQueue, spoolRequest } = await distImport("sync/spool-request.js");
const { pendingBatch, acknowledgeBatch } = await distImport("sync/outbox.js");
const managedConsent = { ...consent, mode: "managed-content",
  serverProcessingAcknowledged: true, contentKinds: ["prompt"] };
const managedScope = { ...scope, contentKinds: ["prompt"] };
const request = (db, changes = {}) => ({
  streamId: "cloud", batchId: "prepared-fixture", consent: managedConsent, scope: managedScope,
  sourceDomain: journalHead(db).sourceDomain,
  journal: { from: 0, through: journalHead(db).cut },
  build: sequence => ({ format: "fixture", sequence }), ...changes,
});

test("local-only never invokes request serialization and metadata cannot enter the raw transport", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  let calls = 0;
  const build = () => { calls++; return { raw: "FORBIDDEN" }; };
  assert.equal(spoolRequest(db, request(db, {
    consent: { mode: "local-only" }, build,
  })), null);
  assert.throws(() => spoolRequest(db, request(db, {
    consent: { mode: "metadata", version: 1, grantedAtMs: 0,
      scope: { deviceId: "device", projectIds: ["project"], rootIds: [] } },
    build,
  })), { code: "content_not_allowed" });
  assert.equal(calls, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM sync_outbox").get().n, 0);
});

test("verified baseline initializes a new cursor without overwriting pending bytes", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  addSession(db);
  const cut = journalHead(db).cut;
  initializeQueue(db, {
    streamId: "cloud", deviceId: "device", sourceDomain: journalHead(db).sourceDomain, sequence: 0, cut,
  });
  addSession(db, "next");
  const batch = spoolRequest(db, request(db, {
    journal: { from: cut, through: journalHead(db).cut },
  }));
  assert.equal(batch.sequence, 1);
  assert.equal(JSON.parse(batch.payload).sequence, 1);
  assert.throws(() => initializeQueue(db, {
    streamId: "cloud", deviceId: "device", sourceDomain: journalHead(db).sourceDomain,
    sequence: 1, cut: journalHead(db).cut,
  }), { code: "invalid_stream" });
  assert.deepEqual(pendingBatch(db, "cloud"), batch);
  assert.throws(() => acknowledgeBatch(db, {
    streamId: "cloud", sequence: 1, payloadHash: "0".repeat(64),
  }));
  acknowledgeBatch(db, { streamId: "cloud", sequence: 1, payloadHash: batch.payload_hash });
  assert.equal(pendingBatch(db, "cloud"), null);
});

test("separate durable blobs enforce quota and fencing without source write locks", t => {
  const dir = makeTempDir();
  t.after(() => removeDir(dir));
  let now = 100;
  t.mock.method(Date, "now", () => now);
  const first = new CloudBlobs(join(dir, "cloud.sqlite"), 4);
  const second = new CloudBlobs(join(dir, "cloud.sqlite"), 4);
  t.after(() => { first.close(); second.close(); });
  assert.equal(first.acquire(now, 10), true);
  assert.equal(second.acquire(now, 10), false);
  const blob = first.put(new Uint8Array([0, 1, 2, 3]));
  assert.throws(() => first.put(new Uint8Array([4])), { code: "outbox_pressure" });
  assert.deepEqual(first.get(blob.hash), new Uint8Array([0, 1, 2, 3]));
  now = 111;
  assert.equal(second.acquire(now, 10), true);
  assert.throws(() => first.prune(new Set()), { code: "spool_lease_lost" });
  assert.equal(second.prune(new Set([blob.hash])), 0);
  assert.equal(second.prune(new Set()), 1);
  assert.throws(() => second.get(blob.hash), { code: "spool_blob_missing" });
});

test("queued blob references are atomic and prevent GC until a verified ACK", t => {
  const dir = makeTempDir();
  t.after(() => removeDir(dir));
  const blobs = new CloudBlobs(join(dir, "spool.sqlite"));
  t.after(() => blobs.close());
  blobs.acquire();
  const ref = blobs.put(new Uint8Array([1, 2, 3]));
  const input = {
    streamId: "cloud", batchId: "atomic", sourceDomain: "lineage",
    consent: managedConsent, scope: managedScope, journal: { from: 0, through: 1 },
    build: sequence => ({ sequence, ref }), blobHashes: [ref.hash],
  };
  const batch = blobs.enqueue(input);
  assert.equal(blobs.prune(), 0);
  assert.deepEqual(blobs.get(ref.hash), new Uint8Array([1, 2, 3]));
  blobs.acknowledge({ streamId: "cloud", sequence: 1, payloadHash: batch.payload_hash });
  assert.equal(blobs.prune(), 1);
  assert.throws(() => blobs.enqueue({
    ...input, batchId: "missing", journal: { from: 1, through: 2 },
    blobHashes: ["0".repeat(64)],
  }), /FOREIGN KEY/);
  assert.equal(blobs.pending("cloud"), null);
  assert.deepEqual(blobs.cursor("cloud"), { ack_sequence: 1, ack_cut: 1 });
});

test("SIGKILL after request commit preserves both payload and referenced blob", { timeout: 15000 }, async t => {
  const dir = makeTempDir();
  t.after(() => removeDir(dir));
  const source = join(dir, "source.sqlite"), blobsPath = join(dir, "blobs.sqlite");
  const helper = new URL("test/helpers/sync.mjs", PACKAGE_ROOT).href;
  const blobsModule = new URL("dist/sync/cloud-blobs.js", PACKAGE_ROOT).href;
  const code = `import {openDb,addSession,journalHead} from ${JSON.stringify(helper)};
    import {CloudBlobs} from ${JSON.stringify(blobsModule)};
    Date.now=()=>10;
    const db=openDb(${JSON.stringify(source)});addSession(db);
    const blobs=new CloudBlobs(${JSON.stringify(blobsPath)});blobs.acquire();
    const ref=blobs.put(new TextEncoder().encode("committed raw fixture"));
    const batch=blobs.enqueue({streamId:"cloud",batchId:"crash",
      sourceDomain:journalHead(db).sourceDomain,blobHashes:[ref.hash],
      consent:${JSON.stringify(managedConsent)},scope:${JSON.stringify(managedScope)},
      journal:{from:0,through:journalHead(db).cut},build:sequence=>({sequence,ref})});
    process.on("message",()=>{});process.send({ref,batch});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const [committed] = await once(child, "message", { signal: AbortSignal.timeout(5000) });
  const exit = once(child, "exit", { signal: AbortSignal.timeout(5000) });
  child.kill("SIGKILL");
  await exit;
  const db = openDb(source), blobs = new CloudBlobs(blobsPath);
  t.after(() => { blobs.close(); db.close(); });
  assert.deepEqual(blobs.pending("cloud"), committed.batch);
  assert.equal(pendingBatch(db, "cloud"), null);
  assert.equal(blobs.acquire(), true);
  assert.equal(new TextDecoder().decode(blobs.get(committed.ref.hash)), "committed raw fixture");
});
