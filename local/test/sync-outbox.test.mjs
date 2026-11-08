import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { PACKAGE_ROOT, makeTempDir, removeDir, distImport } from "./_helpers.mjs";
import {
  acknowledgeBatch, addSession, consent, contentKinds, journalHead, openDb,
  pendingBatch, readJournal, request, scope, seedAll, spoolBatch,
} from "./helpers/sync.mjs";

const { authorizeUpload, consentSchema, uploadScopeSchema } = await distImport("sync/consent.js");
const receipt = b => ({ streamId: b.stream_id, sequence: b.sequence, payloadHash: b.payload_hash });
const counts = db => ({ ...db.prepare(`SELECT
  (SELECT COUNT(*) FROM sync_outbox) AS batches,
  (SELECT COUNT(*) FROM sync_streams) AS streams,
  (SELECT COALESCE(SUM(payload_bytes),0) FROM sync_outbox) AS bytes`).get() });

test("local-only defaults spool zero payload bytes and never invoke transformations or networking", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  addSession(db);
  t.mock.method(globalThis, "fetch", () => assert.fail("P4 has no HTTP sender"));
  for (const grant of [undefined, { mode: "local-only" }]) {
    assert.equal(spoolBatch(db, request(db, { consent: grant,
      scopeFor: () => assert.fail("local-only must stop before inspecting payload") })), null);
  }
  assert.deepEqual(counts(db), { batches: 0, streams: 0, bytes: 0 });
});

test("metadata hashes raw sentinel keys and strips raw columns and nested before-images before spool", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  seedAll(db);
  addSession(db, "/SENTINEL/private-key");
  db.exec("DELETE FROM sessions WHERE id='/SENTINEL/private-key'");
  const batch = spoolBatch(db, request(db));
  assert.ok(batch);
  assert.equal(batch.payload.includes("SENTINEL"), false);
  assert.equal(batch.payload.includes("skill://private"), false);
  const records = JSON.parse(batch.payload).records;
  assert.ok(records.every(r => /^[0-9a-f]{64}$/.test(r.key)));
  assert.ok(records.every(r => r.beforeValues === null));
  assert.equal(batch.payload_bytes, Buffer.byteLength(batch.payload));
  assert.equal(batch.payload_hash, createHash("sha256").update(batch.payload).digest("hex"));
  assert.throws(() => db.exec("UPDATE sync_outbox SET payload='changed'"), /immutable/);
  const metadataDelete = records.find(r => r.operation === "delete");
  assert.ok(metadataDelete);
  assert.equal(metadataDelete.values, null);
});

test("all-kind managed consent preserves exact raw final row images and source keys", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  seedAll(db);
  const input = request(db, {
    consent: { ...consent, mode: "managed-content", serverProcessingAcknowledged: true, contentKinds },
    scope: { ...scope, contentKinds },
  });
  const batch = spoolBatch(db, input);
  assert.deepEqual(JSON.parse(batch.payload).records, input.records);
  assert.ok(batch.payload.includes("SENTINEL"));
});

test("consent, membership, historical range, partial raw and unknown nested fields fail before durable spool", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  addSession(db);
  const variants = [
    { scope: { ...scope, projectId: "other" } },
    { scope: { ...scope, rootId: "other" } },
    { scope: { ...scope, consentVersion: 2 } },
    { scope: { ...scope, deviceId: "other" } },
    { consent: { ...consent, grantedAtMs: 101 } },
    { scope: { ...scope, fromMs: 101 } }, // Row timestamp, not just scope label.
    { scope: { ...scope, contentKinds: ["prompt"] } },
    { scope: { ...scope, backfill: { version: 1, snapshotId: "old", journalCut: 1 } } },
    { scopeFor: () => ({ projectId: "other", rootId: null }) },
    { scope: { ...scope, nested: { secret: "SENTINEL" } } },
    { consent: { ...consent, mode: "managed-content", serverProcessingAcknowledged: false, contentKinds } },
    { consent: { ...consent, mode: "managed-content", serverProcessingAcknowledged: true, contentKinds: ["prompt"] },
      scope: { ...scope, contentKinds: ["prompt"] } },
  ];
  for (const variant of variants) assert.throws(() => spoolBatch(db, request(db, variant)));
  assert.deepEqual(counts(db), { batches: 0, streams: 0, bytes: 0 });
});

test("delete retains historical time and project evidence even after the live source row disappears", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  db.exec("INSERT INTO sessions(id,runtime,started_at,cwd) VALUES ('s','codex',1,'/old-project')");
  const before = journalHead(db).cut;
  db.exec("DELETE FROM sessions");
  const tombstone = readJournal(db, { after: before, through: journalHead(db).cut })[0];
  assert.equal(tombstone.beforeValues.cwd, "/old-project");
  assert.equal(tombstone.beforeValues.started_at, 1);
  const input = request(db, { records: [tombstone], scope: { ...scope, fromMs: 100 } });
  assert.throws(() => spoolBatch(db, input), { code: "range_not_allowed" });
  assert.throws(() => spoolBatch(db, { ...input, scope,
    scopeFor: r => ({ projectId: r.beforeValues.cwd, rootId: null }) }), { code: "scope_required" });
  assert.throws(() => spoolBatch(db, { ...input, scope,
    records: [{ ...tombstone, beforeValues: null }] }), { code: "scope_required" });
  const backfill = { version: 1, snapshotId: "snapshot", journalCut: journalHead(db).cut };
  const batch = spoolBatch(db, { ...input, scope: { ...scope, backfill },
    consent: { ...consent, grantedAtMs: 100, backfill: { ...backfill, range: { fromMs: 0, toMs: 10000 } } } });
  assert.ok(batch);
  assert.equal(batch.payload.includes("/old-project"), false);
  assert.equal(JSON.parse(batch.payload).records[0].beforeValues, null);
});

test("bounded spool rejects oversized records and quota pressure without consuming sequence", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  addSession(db, "large", "x".repeat(256 * 1024));
  const raw = request(db, {
    consent: { ...consent, mode: "managed-content", serverProcessingAcknowledged: true, contentKinds },
    scope: { ...scope, contentKinds },
  });
  assert.throws(() => spoolBatch(db, raw), { code: "record_too_large" });
  assert.throws(() => spoolBatch(db, request(db, { limits: { maxBytes: 1 } })), { code: "record_too_large" });
  assert.throws(() => spoolBatch(db, request(db, { quota: { maxBytes: 1, maxBatches: 1 } })), { code: "outbox_full" });
  assert.deepEqual(counts(db), { batches: 0, streams: 0, bytes: 0 });
  const first = spoolBatch(db, request(db));
  assert.equal(first.sequence, 1);
  assert.throws(() => spoolBatch(db, request(db, {
    journal: { from: first.journal_through, through: first.journal_through },
    quota: { maxBytes: 64 * 1024 * 1024, maxBatches: 1 },
  })), { code: "outbox_full" });
  assert.equal(db.prepare("SELECT next_sequence FROM sync_streams").get().next_sequence, 2);
});

test("default record limit is 100 and serialized envelopes stay under 256 KiB", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  for (let i = 0; i < 101; i++) addSession(db, `s${i}`);
  const first = request(db);
  assert.equal(first.records.length, 100);
  const batch = spoolBatch(db, first);
  assert.equal(JSON.parse(batch.payload).records.length, 100);
  assert.ok(batch.payload_bytes <= 256 * 1024);
  const tail = readJournal(db, { after: first.records.at(-1).revision, through: journalHead(db).cut });
  assert.equal(tail.length, 1);
  assert.throws(() => spoolBatch(db, { ...first, streamId: "too-many",
    records: [...first.records, ...tail] }), /100/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sync_streams WHERE stream_id='too-many'").get().n, 0);
});

test("stop-and-wait exposes one immutable batch and ACK cannot skip or change its hash", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  addSession(db);
  const a = spoolBatch(db, request(db));
  db.exec("UPDATE sessions SET first_prompt='changed'");
  const b = spoolBatch(db, request(db, { journal: { from: a.journal_through, through: journalHead(db).cut } }));
  assert.deepEqual(pendingBatch(db, "stream"), a);
  assert.throws(() => acknowledgeBatch(db, receipt(b)), { code: "ack_out_of_order" });
  assert.throws(() => acknowledgeBatch(db, { ...receipt(a), payloadHash: "wrong" }), { code: "ack_out_of_order" });
  acknowledgeBatch(db, receipt(a));
  acknowledgeBatch(db, receipt(a)); // Receipt retry after a lost local ACK response.
  assert.deepEqual(pendingBatch(db, "stream"), b);
  acknowledgeBatch(db, receipt(b));
  assert.equal(pendingBatch(db, "stream"), null);
  assert.equal(db.prepare("SELECT ack_cut FROM sync_streams").get().ack_cut, b.journal_through);
  assert.throws(() => spoolBatch(db, request(db)), { code: "invalid_cut" });
});

test("SIGKILL preserves committed immutable spool and contiguous ACK through database reopen", async t => {
  const dir = makeTempDir();
  t.after(() => removeDir(dir));
  const path = join(dir, "crash.db");
  const helper = new URL("test/helpers/sync.mjs", PACKAGE_ROOT).href;
  const code = `import { openDb, addSession, spoolBatch, request } from ${JSON.stringify(helper)};
    const db=openDb(${JSON.stringify(path)}); addSession(db);
    const batch=spoolBatch(db,request(db));
    db.exec("BEGIN; UPDATE sessions SET first_prompt='UNCOMMITTED'");
    process.on("message",()=>{}); process.send(batch);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const exit = once(child, "exit", { signal: AbortSignal.timeout(10000) });
  const [batch] = await once(child, "message", { signal: AbortSignal.timeout(10000) });
  child.kill("SIGKILL");
  const [, signal] = await exit;
  assert.equal(signal, "SIGKILL");
  let db = openDb(path);
  try {
    assert.deepEqual(pendingBatch(db, "stream"), batch);
    assert.equal(db.prepare("SELECT first_prompt FROM sessions").get().first_prompt, "SENTINEL");
    acknowledgeBatch(db, receipt(batch));
  } finally { db.close(); }
  db = openDb(path);
  try {
    assert.equal(pendingBatch(db, "stream"), null);
    acknowledgeBatch(db, receipt(batch));
    db.exec("UPDATE sessions SET first_prompt='after reopen'");
    const next = spoolBatch(db, request(db, { journal: { from: batch.journal_through, through: journalHead(db).cut } }));
    assert.equal(next.sequence, 2);
  } finally { db.close(); }
});

test("standalone consent boundary agrees with shared P1 parsing and authorization", async () => {
  const vectors = [
    [consent, scope],
    [{ ...consent, grantedAtMs: 1 }, scope],
    [consent, { ...scope, rootId: "private" }],
    [{ mode: "local-only" }, scope],
    [consent, { ...scope, contentKinds: ["query"] }],
    [{ ...consent, mode: "managed-content", contentKinds, serverProcessingAcknowledged: true },
      { ...scope, contentKinds }],
    [{ ...consent, mode: "managed-content", contentKinds, serverProcessingAcknowledged: true, externalModelTransfer: true },
      scope],
  ];
  const sharedUrl = new URL("../shared/activity-consent.ts", PACKAGE_ROOT).href;
  const code = `import {registerHooks} from "node:module";
    registerHooks({resolve(specifier,context,next){
      if(context.parentURL===${JSON.stringify(sharedUrl)} &&
          specifier.startsWith("./") && specifier.endsWith(".js")) {
        return next(specifier.slice(0,-3)+".ts",context);
      }
      return next(specifier,context);
    }});
    const {consentSchema,authorizeUpload}=await import(${JSON.stringify(sharedUrl)});
    const vectors=${JSON.stringify(vectors)};
    console.log(JSON.stringify(vectors.map(([c,s])=>{try {authorizeUpload(consentSchema.parse(c),s);return "ok"}
      catch(e){return e.code??"invalid"}})));`;
  const child = spawn(process.execPath, ["--experimental-transform-types", "--input-type=module", "-e", code],
    { stdio: ["ignore", "pipe", "inherit"] });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", text => { stdout += text; });
  const [codeValue] = await once(child, "close", { signal: AbortSignal.timeout(10000) });
  assert.equal(codeValue, 0);
  const local = vectors.map(([c, s]) => {
    try { authorizeUpload(consentSchema.parse(c), uploadScopeSchema.parse(s)); return "ok"; }
    catch (error) { return error.code ?? "invalid"; }
  });
  assert.deepEqual(local, JSON.parse(stdout));
});
