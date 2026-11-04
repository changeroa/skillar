import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import test from "node:test";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";

const { openDb } = await distImport("store/db.js");
const { createStore } = await distImport("store/index.js");
const { journalHead } = await distImport("sync/journal.js");
const { bindSource } = await distImport("sync/cloud-prepare.js");
const { applySourceCommand } = await distImport("sync/command-apply.js");
const { canonicalCommandPayload } = await distImport("sync/command-wire.js");
const { atomicCloudJson } = await distImport("sync/cloud-connection.js");
const { approveSourceCommands } = await distImport("sync/command-control.js");
const { runCloudCommandStep, requestCommandApply } = await distImport("sync/cloud-commands.js");
const { consentSchema } = await distImport("sync/cloud-wire.js");

function fixture(t) {
  const home = makeTempDir(), path = join(home, "source.sqlite");
  t.after(() => removeDir(home));
  const connection = {
    version: 1, instanceId: randomUUID(), origin: "https://skillar.sh", accountId: "account-a",
    deviceId: "device-a", generation: 1, token: "T".repeat(43),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
  atomicCloudJson(home, "connection.json", connection);
  bindSource(path, connection);
  const db = openDb(path), store = createStore(db);
  t.after(() => db.close());
  const head = journalHead(db), request = {
    profile: { deviceId: connection.deviceId, sourceDomain: head.sourceDomain },
    commandId: randomUUID(), baseRevision: head.cut, operation: { kind: "eval.add", query: "synthetic command query" },
  };
  const command = {
    accountId: connection.accountId, generation: connection.generation,
    deviceId: connection.deviceId, sourceDomain: head.sourceDomain,
    commandId: request.commandId, baseRevision: head.cut, operation: request.operation,
    payloadHash: createHash("sha256").update(canonicalCommandPayload(request)).digest("hex"),
    consentVersion: 1, expiresAtMs: Date.now() + 60_000,
  };
  const consent = consentSchema.parse({
    mode: "managed-content", version: 1, grantedAtMs: 0,
    scope: { deviceId: connection.deviceId, projectIds: [`device:${connection.deviceId}`], rootIds: [] },
    serverProcessingAcknowledged: true,
    contentKinds: ["prompt", "query", "args", "error", "path", "span-attributes", "private-skills"],
  });
  const self = {
    accountId: connection.accountId, deviceId: connection.deviceId, generation: 1, shardId: "activity-00",
    scopes: ["activity:read", "activity:ingest"], ingestEnabled: true, version: 1, consent,
  };
  const calls = [], acknowledgements = [];
  let loseAck = false, onPoll = () => {};
  const fetcher = async (url, init) => {
    const route = new URL(url).pathname;
    calls.push(route);
    if (route === "/v1/devices/self") return Response.json(self);
    assert.equal(init.headers.authorization, `Bearer ${connection.token}`);
    if (route === "/v1/activity/commands/poll") {
      onPoll();
      return Response.json({ command });
    }
    assert.equal(route, "/v1/activity/commands/ack");
    const receipt = JSON.parse(init.body);
    acknowledgements.push(receipt);
    if (loseAck) { loseAck = false; throw new TypeError("fixture lost ACK response"); }
    return Response.json({
      commandId: receipt.commandId, state: receipt.state, baseRevision: command.baseRevision,
      sourceRevision: receipt.sourceRevision, result: receipt.result, error: receipt.error,
    });
  };
  const progress = {
    version: 1, instanceId: connection.instanceId, updatedAtMs: 0, phase: "caught-up",
    sourceDomain: head.sourceDomain, acknowledgedCut: head.cut, excluded: 0, attempts: 0, liveTurns: 0,
  };
  const apply = async input => applySourceCommand(db, store, connection, input);
  return {
    home, db, store, command, connection, calls, acknowledgements,
    approve() { approveSourceCommands(home, true); },
    loseAck() { loseAck = true; }, onPoll(fn) { onPoll = fn; },
    step(callback = apply) { return runCloudCommandStep(home, progress, callback, { fetcher }); },
  };
}

test("unapproved connectors make no command network requests", async t => {
  // Given the default Local-only command approval.
  const f = fixture(t);
  // When an existing sync turn finishes.
  await f.step();
  // Then neither command payload nor status is requested.
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.store.evalCases(), []);
});

test("an approved connector ACKs only after the real source transaction commits", async t => {
  // Given an opted-in source and one pending command.
  const f = fixture(t);
  f.approve();
  // When the bounded command turn runs.
  await f.step();
  // Then source data exists and the durable outcome was acknowledged.
  assert.equal(f.store.evalCases().length, 1);
  assert.equal(f.acknowledgements.length, 1);
  assert.equal(f.acknowledgements[0].state, "applied");
  assert.equal(f.acknowledgements[0].sourceRevision, journalHead(f.db).cut);
});

test("a lost ACK response redelivers the identical source receipt without another mutation", async t => {
  // Given a source commit followed by a lost ACK response.
  const f = fixture(t);
  f.approve();
  f.loseAck();
  await f.step();
  // When the next ordinary sync turn receives the pending command again.
  await f.step();
  // Then it replays the exact receipt and leaves a single eval case.
  assert.equal(f.store.evalCases().length, 1);
  assert.equal(f.acknowledgements.length, 2);
  assert.deepEqual(f.acknowledgements[1], f.acknowledgements[0]);
});

test("a missing main-thread apply remains pending and never sends an ACK", async t => {
  // Given an approved connector without a usable source RPC handler.
  const f = fixture(t);
  f.approve();
  // When Local apply cannot be reached.
  await f.step(async () => null);
  // Then no application is invented.
  assert.equal(f.acknowledgements.length, 0);
  assert.deepEqual(f.store.evalCases(), []);
});

test("disabling local approval during poll prevents source application", async t => {
  // Given an in-flight poll and local approval.
  const f = fixture(t);
  f.approve();
  f.onPoll(() => approveSourceCommands(f.home, false));
  // When the poll response arrives after disable.
  await f.step();
  // Then the previously authorized command does not run.
  assert.equal(f.acknowledgements.length, 0);
  assert.deepEqual(f.store.evalCases(), []);
});

test("the source RPC subscribes before posting and ignores unrelated replies", async t => {
  // Given a real message channel.
  const f = fixture(t), channel = new MessageChannel();
  t.after(() => { channel.port1.close(); channel.port2.close(); });
  channel.port2.once("message", request => {
    channel.port2.postMessage({ kind: "command-applied", id: randomUUID(), result: null });
    channel.port2.postMessage({
      kind: "command-applied", id: request.id,
      result: { commandId: f.command.commandId, payloadHash: f.command.payloadHash,
        state: "rejected", sourceRevision: f.command.baseRevision, result: null, error: "fixture_rejected" },
    });
  });
  // When the source replies on the subscribed channel.
  const result = await requestCommandApply(channel.port1, f.command, f.connection.instanceId);
  // Then only the correlated completion is accepted.
  assert.equal(result.error, "fixture_rejected");
});
