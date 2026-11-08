import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";

const { openDb } = await distImport("store/db.js");
const { createStore } = await distImport("store/index.js");
const { journalHead } = await distImport("sync/journal.js");
const { bindSource } = await distImport("sync/cloud-prepare.js");
const { applySourceCommand } = await distImport("sync/command-apply.js");
const { canonicalCommandPayload } = await distImport("sync/command-wire.js");
const { atomicCloudJson } = await distImport("sync/cloud-connection.js");
const { approveSourceCommands, sourceCommandsEnabled } = await distImport("sync/command-control.js");

const NOW = Date.UTC(2026, 10, 4);
const SPEC = { name: "remote-ship", steps: [{ id: "build", skills: ["programming"] }] };

function fixture(t) {
  const home = makeTempDir(), path = join(home, "source.sqlite");
  t.after(() => removeDir(home));
  const connection = {
    version: 1, instanceId: randomUUID(), origin: "https://skillar.sh", accountId: "account-a",
    deviceId: "device-a", generation: 1, token: "T".repeat(43), expiresAt: Math.floor(NOW / 1000) + 3600,
  };
  atomicCloudJson(home, "connection.json", connection);
  bindSource(path, connection);
  let db = openDb(path), store = createStore(db, { now: () => NOW });
  t.after(() => db.close());
  return {
    home, connection,
    get db() { return db; }, get store() { return store; },
    reopen() { db.close(); db = openDb(path); store = createStore(db, { now: () => NOW }); },
    command(operation, overrides = {}) {
      const head = journalHead(db);
      const request = {
        profile: { deviceId: connection.deviceId, sourceDomain: head.sourceDomain },
        commandId: randomUUID(), baseRevision: head.cut, operation, ...overrides,
      };
      return {
        accountId: connection.accountId, generation: connection.generation,
        deviceId: request.profile.deviceId, sourceDomain: request.profile.sourceDomain,
        commandId: request.commandId, baseRevision: request.baseRevision, operation,
        payloadHash: createHash("sha256").update(canonicalCommandPayload(request)).digest("hex"),
        expiresAtMs: NOW + 60_000, consentVersion: 1,
      };
    },
    apply(command) { return applySourceCommand(db, store, connection, command, NOW); },
  };
}

test("a workflow command mutates the real source and journals the applied revision", t => {
  // Given a bound source with no workflow.
  const f = fixture(t), command = f.command({ kind: "workflow.put", spec: SPEC });
  // When the daemon applies the command.
  const result = f.apply(command);
  // Then the real source version and CDC revision are returned.
  assert.equal(result.state, "applied");
  assert.equal(f.store.workflowSpec(SPEC.name).version, 1);
  assert.equal(result.result.id, f.store.workflowSpec(SPEC.name).id);
  assert.equal(result.sourceRevision, journalHead(f.db).cut);
  assert.ok(result.sourceRevision > command.baseRevision);
});

test("an ACK-lost command replays its durable receipt after database restart", t => {
  // Given a committed source mutation whose ACK was lost.
  const f = fixture(t), command = f.command({ kind: "workflow.put", spec: SPEC });
  const committed = f.apply(command);
  f.reopen();
  // When the remote queue redelivers it.
  const result = f.apply(command);
  // Then it returns the identical result without another write.
  assert.deepEqual(result, committed);
  assert.equal(f.store.workflowSpecVersions(SPEC.name).length, 1);
  assert.equal(journalHead(f.db).cut, committed.sourceRevision);
});

test("a source-side edit defeats an older command base revision", t => {
  // Given an offline pending command and an intervening local edit.
  const f = fixture(t), command = f.command({ kind: "workflow.put", spec: SPEC });
  f.store.putWorkflowSpec({ name: "local", steps: [{ id: "a", skills: [] }] });
  const before = journalHead(f.db).cut;
  // When the command arrives.
  const result = f.apply(command);
  // Then it records a conflict without overwriting source state.
  assert.equal(result.state, "conflict");
  assert.equal(result.error, "source_revision_conflict");
  assert.equal(f.store.workflowSpec(SPEC.name), undefined);
  assert.equal(journalHead(f.db).cut, before);
});

test("a failed receipt commit rolls back both mutation and CDC journal", t => {
  // Given a fault at the durable receipt boundary.
  const f = fixture(t), command = f.command({ kind: "workflow.put", spec: SPEC });
  const before = journalHead(f.db).cut;
  f.db.exec(`CREATE TRIGGER fail_command_receipt BEFORE INSERT ON connector_command_receipts
    BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END`);
  // When apply cannot commit its receipt.
  assert.throws(() => f.apply(command), /fixture receipt failure/);
  // Then neither source content nor its journal survives.
  assert.equal(f.store.workflowSpec(SPEC.name), undefined);
  assert.equal(journalHead(f.db).cut, before);
  assert.equal(f.db.prepare("SELECT count(*) n FROM connector_command_receipts").get().n, 0);
});

test("a duplicated eval command creates exactly one source-local case", t => {
  // Given a source-local eval command and its committed receipt.
  const f = fixture(t), command = f.command({ kind: "eval.add", query: "synthetic query", expectedUri: "skill://local/test/SKILL.md" });
  const committed = f.apply(command);
  // When the same command is applied again.
  const result = f.apply(command);
  // Then it replays the receipt, not the insertion.
  assert.deepEqual(result, committed);
  assert.equal(f.store.evalCases().length, 1);
});

test("flow creation captures source recording vectors rather than cloud time", t => {
  // Given a workflow and a source recording clock.
  const f = fixture(t);
  f.store.putWorkflowSpec(SPEC);
  const clock = f.db.prepare("SELECT domain,position FROM recording_clock").get();
  const command = f.command({ kind: "flow.create", workspaceId: "ws", spec: { name: SPEC.name } });
  // When a remote create is applied locally.
  const result = f.apply(command);
  // Then its source vectors and source time match the local authority.
  const row = f.db.prepare("SELECT * FROM flows WHERE id=?").get(result.result.id);
  assert.equal(row.registered_ms, NOW);
  assert.equal(row.start_order_domain, clock.domain);
  assert.equal(row.start_order, clock.position);
});

test("ending a flow freezes the local recording boundary", t => {
  // Given a local open flow.
  const f = fixture(t), spec = f.store.putWorkflowSpec(SPEC).row;
  const flow = f.store.createFlow({ workspaceId: "ws", specId: spec.id }).flow;
  const clock = f.db.prepare("SELECT domain,position FROM recording_clock").get();
  // When the remote end is applied.
  const result = f.apply(f.command({ kind: "flow.end", flowId: flow.id }));
  // Then the end boundary is determined on the source.
  const row = f.db.prepare("SELECT * FROM flows WHERE id=?").get(flow.id);
  assert.equal(result.state, "applied");
  assert.equal(row.ended_ms, NOW);
  assert.equal(row.end_order_domain, clock.domain);
  assert.equal(row.end_order, clock.position);
});

test("unknown flow steps are rejected without source mutation", t => {
  // Given a flow with only its declared build step.
  const f = fixture(t), spec = f.store.putWorkflowSpec(SPEC).row;
  const flow = f.store.createFlow({ workspaceId: "ws", specId: spec.id }).flow;
  const before = journalHead(f.db).cut;
  // When a remote command names an absent step.
  const result = f.apply(f.command({ kind: "flow.map-step", flowId: flow.id, paneId: "pane", stepId: "missing" }));
  // Then it fails deterministically with no partial mapping.
  assert.equal(result.state, "rejected");
  assert.equal(result.error, "unknown_step");
  assert.deepEqual(f.store.flowSteps(flow.id), []);
  assert.equal(journalHead(f.db).cut, before);
});

test("commands from another generation or device cannot touch the source", t => {
  // Given a bound source and a command with a foreign device identity.
  const f = fixture(t), command = f.command({ kind: "workflow.put", spec: SPEC });
  // When the identity disagrees with the connection.
  assert.throws(() => f.apply({ ...command, generation: 2 }), /command_identity_mismatch/);
  // Then the source remains unchanged.
  assert.equal(f.store.workflowSpec(SPEC.name), undefined);
});

test("remote command approval is off by default and does not survive reconnection", t => {
  // Given explicit local approval for one connection.
  const f = fixture(t);
  assert.equal(sourceCommandsEnabled(f.home), false);
  approveSourceCommands(f.home, true);
  assert.equal(sourceCommandsEnabled(f.home), true);
  // When the connection identity changes.
  atomicCloudJson(f.home, "connection.json", { ...f.connection, instanceId: randomUUID() });
  // Then the new connection cannot inherit remote write approval.
  assert.equal(sourceCommandsEnabled(f.home), false);
});
