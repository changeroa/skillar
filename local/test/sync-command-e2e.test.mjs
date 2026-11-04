import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import {
  fixture as remoteFixture, grant, migrate, principal,
} from "../../worker/test/helpers/activity-runtime.mjs";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";

const { openDb } = await distImport("store/db.js");
const { createStore } = await distImport("store/index.js");
const { journalHead } = await distImport("sync/journal.js");
const { bindSource } = await distImport("sync/cloud-prepare.js");
const { atomicCloudJson } = await distImport("sync/cloud-connection.js");
const { approveSourceCommands } = await distImport("sync/command-control.js");
const { applySourceCommand } = await distImport("sync/command-apply.js");
const { runCloudCommandStep } = await distImport("sync/cloud-commands.js");

async function fixture(t) {
  const home = makeTempDir(), source = join(home, "source.sqlite");
  t.after(() => removeDir(home));
  const remote = await remoteFixture(t);
  await migrate(remote.db, new URL("../../worker/activity-migrations/0010_connector_commands.sql", import.meta.url));
  const connection = {
    version: 1, instanceId: randomUUID(), origin: "https://skillar.sh", accountId: "account-a",
    deviceId: "device-a", generation: 1, token: "T".repeat(43),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
  atomicCloudJson(home, "connection.json", connection);
  bindSource(source, connection);
  const db = openDb(source), store = createStore(db);
  t.after(() => db.close());
  const head = journalHead(db);
  await remote.head(head.cut, 1, head.sourceDomain);
  approveSourceCommands(home, true);
  const progress = {
    version: 1, instanceId: connection.instanceId, updatedAtMs: 0, phase: "caught-up",
    sourceDomain: head.sourceDomain, acknowledgedCut: head.cut, excluded: 0, attempts: 0, liveTurns: 0,
  };
  let loseAck = false;
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/v1/devices/self") return Response.json({
      accountId: connection.accountId, deviceId: connection.deviceId, generation: 1, shardId: "activity-00",
      scopes: ["activity:read", "activity:ingest"], ingestEnabled: true, version: 1, consent: grant(),
    });
    if (path.endsWith("/ack") && loseAck) {
      loseAck = false;
      throw new TypeError("fixture disconnected before ACK delivery");
    }
    return remote.api(path, JSON.parse(init.body), principal());
  };
  const enqueue = async operation => {
    const request = {
      profile: { deviceId: connection.deviceId, sourceDomain: head.sourceDomain },
      commandId: randomUUID(), baseRevision: head.cut, operation,
    };
    const response = await remote.api("/v1/activity/commands/enqueue", request, principal({ scopes: ["activity:read"] }));
    assert.equal(response.status, 202, await response.clone().text());
    return request;
  };
  const status = async request => {
    const response = await remote.api("/v1/activity/commands/status",
      { profile: request.profile, commandId: request.commandId }, principal({ scopes: ["activity:read"] }));
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  return {
    db, store, remote, enqueue, status,
    loseAck() { loseAck = true; },
    step() {
      return runCloudCommandStep(home, progress,
        async (command, instanceId) => {
          assert.equal(instanceId, connection.instanceId);
          return applySourceCommand(db, store, connection, command);
        }, { fetcher });
    },
  };
}

test("an offline native command becomes applied only after actual SQLite mutation and ACK", async t => {
  // Given a native encrypted D1/R2 queue with its selected Local source offline.
  const f = await fixture(t);
  const request = await f.enqueue({
    kind: "workflow.put", spec: { name: "native-remote-workflow", steps: [{ id: "build", skills: [] }] },
  });
  assert.equal((await f.status(request)).state, "pending");
  assert.equal(f.store.workflowSpec("native-remote-workflow"), undefined);
  // When the ordinary connector turn reaches the actual source store.
  await f.step();
  // Then the native cloud status is the committed source result.
  const result = await f.status(request), local = f.store.workflowSpec("native-remote-workflow");
  assert.equal(result.state, "applied");
  assert.equal(result.result.id, local.id);
  assert.equal(result.result.digest, local.digest);
  assert.equal(result.sourceRevision, journalHead(f.db).cut);
});

test("native redelivery after an ACK transport failure does not duplicate a local eval case", async t => {
  // Given a committed source mutation while its native queue still awaits ACK.
  const f = await fixture(t), request = await f.enqueue({ kind: "eval.add", query: "native synthetic query" });
  f.loseAck();
  await f.step();
  assert.equal((await f.status(request)).state, "pending");
  assert.equal(f.store.evalCases().length, 1);
  // When the native queue redelivers the command on the next turn.
  await f.step();
  // Then only one source mutation exists and the durable queue reaches applied.
  assert.equal((await f.status(request)).state, "applied");
  assert.equal(f.store.evalCases().length, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM connector_command_receipts").get().n, 1);
});
