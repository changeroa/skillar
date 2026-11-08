import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accepted, batch, event, fixture, oneCommit, principal, rejected, session, span, tombstone,
} from "./helpers/activity-ledger.mjs";

for (const kind of ["session", "tombstone"]) {
  test(`maximum 100-record ${kind} batch is committed without partial acknowledgement`, async t => {
    const f = await fixture(t);
    const value = batch({ journal: { from: 1, through: 100 }, mutations:
      Array.from({ length: 100 }, (_, i) => kind === "session" ? session(`s-${i}`) : tombstone("session", `s-${i}`, 1)) });
    accepted(await f.send(value), value);
    await f.counts({ ...oneCommit, session_facts: kind === "session" ? 100 : 0,
      entity_tombstones: kind === "tombstone" ? 100 : 0 });
  });
}

test("same-hash retries preserve the original receipt and exactly one set of effects", async t => {
  const f = await fixture(t), value = batch();
  accepted(await f.send(value), value);
  accepted(await f.send(value, principal(), 999), value);
  await f.counts(oneCommit);
  assert.deepEqual(await f.rows("SELECT state,input_revision,lease_fence FROM jobs"),
    [{ state: "pending", input_revision: 1, lease_fence: 0 }]);
  assert.deepEqual(await f.rows("SELECT state,attempts FROM dispatch_outbox"), [{ state: "pending", attempts: 0 }]);
  assert.deepEqual(await f.rows("SELECT head_seq,min_replay_seq FROM account_heads"), [{ head_seq: 1, min_replay_seq: 0 }]);
  assert.deepEqual(await f.rows("SELECT seq,invalidation_kind FROM account_changes"), [{ seq: 1, invalidation_kind: "activity" }]);
});

test("concurrent duplicate deliveries produce one identical receipt and one projection", async t => {
  const f = await fixture(t), value = batch();
  const results = await Promise.all(Array.from({ length: 6 }, () => f.send(value)));
  for (const result of results) accepted(result, value);
  await f.counts(oneCommit);
});

test("receipts retain normalized strict metadata for replay after newer projections", async t => {
  const f = await fixture(t);
  const first = batch({ rootId: "root", backfill: { version: 1, snapshotId: "snapshot", journalCut: 7 } });
  const reordered = Object.fromEntries(Object.entries(first).reverse());
  accepted(await f.send(reordered), first);
  const second = batch({ batchId: "batch-2", sequence: 2, journal: { from: 2, through: 2 },
    mutations: [session("session", 2, { runtime: "codex" })] });
  accepted(await f.send(second), second, 2);
  accepted(await f.send(reordered, principal(), 500), first);
  assert.deepEqual(await f.rows("SELECT metadata_json FROM ingest_receipts ORDER BY sequence"),
    [{ metadata_json: JSON.stringify(first) }, { metadata_json: JSON.stringify(second) }]);
  assert.deepEqual(await f.rows("SELECT revision,runtime FROM session_facts"), [{ revision: 2, runtime: "codex" }]);
  const invalid = await f.send(batch({ batchId: "invalid", raw: "not metadata" }));
  assert.equal(invalid.status, 400);
  await f.counts({ ...oneCommit, ingest_receipts: 2, jobs: 2, dispatch_outbox: 2, account_changes: 2 });
});

test("changed payload under the same batch ID conflicts without changing committed facts", async t => {
  const f = await fixture(t), value = batch();
  accepted(await f.send(value), value);
  for (const changes of [{ mutations: [session("session", 2)] }, { projectId: "other" },
    { sequence: 2 }, { journal: { from: 2, through: 2 } }]) {
    rejected(await f.send(batch(changes)), 409, "batch_conflict");
  }
  accepted(await f.send(value), value);
  await f.counts(oneCommit);
  assert.deepEqual(await f.rows("SELECT revision FROM session_facts"), [{ revision: 1 }]);
});

test("sequence and journal gaps never acknowledge or skip stream positions", async t => {
  const f = await fixture(t);
  for (const changes of [{ sequence: 2 }, { journal: { from: 0, through: 1 } },
    { journal: { from: 2, through: 2 } }]) {
    rejected(await f.send(batch(changes)), 409, "sequence_gap");
    await f.counts({});
  }
  accepted(await f.send(), batch());
  for (const changes of [{ sequence: 3, journal: { from: 2, through: 2 } },
    { sequence: 2, journal: { from: 3, through: 3 } },
    { sequence: 2, journal: { from: 1, through: 2 } },
    { sequence: 1, journal: { from: 2, through: 2 } }]) {
    rejected(await f.send(batch({ batchId: "batch-2", ...changes })), 409, "sequence_gap");
    await f.counts(oneCommit);
  }
  const second = batch({ batchId: "batch-2", sequence: 2, journal: { from: 2, through: 4 } });
  accepted(await f.send(second), second, 2);
  accepted(await f.send(batch(), principal(), 200), batch());
  assert.deepEqual(await f.rows("SELECT sequence,journal_through FROM device_streams"),
    [{ sequence: 2, journal_through: 4 }]);
  assert.deepEqual(await f.rows("SELECT head_seq FROM account_heads"), [{ head_seq: 2 }]);
  assert.deepEqual(await f.rows("SELECT metadata_json FROM ingest_receipts ORDER BY sequence"),
    [{ metadata_json: JSON.stringify(batch()) }, { metadata_json: JSON.stringify(second) }]);
});

test("identical IDs are isolated across two accounts, devices, and domains", async t => {
  const f = await fixture(t);
  await f.seedFence("account-b");
  for (const accountId of ["account-a", "account-b"]) {
    let change = 0;
    for (const deviceId of ["device-a", "device-b"]) for (const sourceDomain of ["codex", "omo"]) {
      const value = batch({ deviceId, sourceDomain, mutations: [
        session(), event("event", 1, { sourceKey: "same-source" }), span(),
      ] });
      accepted(await f.send(value, principal({ accountId, deviceId })), value, 1, ++change);
    }
  }
  await f.counts({ ingest_receipts: 8, session_facts: 8, event_facts: 8, span_facts: 8,
    jobs: 8, dispatch_outbox: 8, account_heads: 2, account_changes: 8, device_streams: 8 });
  const value = batch({ batchId: "delete", sequence: 2, journal: { from: 2, through: 2 },
    mutations: [tombstone("session", "session", 1), tombstone("event", "event", 1), tombstone("span", "span", 1)] });
  accepted(await f.send(value), value, 2, 5);
  for (const table of ["session_facts", "event_facts", "span_facts"]) {
    assert.deepEqual(await f.rows(`SELECT account_id,device_id,source_domain FROM ${table}
      ORDER BY account_id,device_id,source_domain`), [
      { account_id: "account-a", device_id: "device-a", source_domain: "omo" },
      { account_id: "account-a", device_id: "device-b", source_domain: "codex" },
      { account_id: "account-a", device_id: "device-b", source_domain: "omo" },
      { account_id: "account-b", device_id: "device-a", source_domain: "codex" },
      { account_id: "account-b", device_id: "device-a", source_domain: "omo" },
      { account_id: "account-b", device_id: "device-b", source_domain: "codex" },
      { account_id: "account-b", device_id: "device-b", source_domain: "omo" },
    ]);
  }
});

for (const entity of ["session", "event", "span"]) {
  test(`${entity}: stale/equal revisions cannot overwrite or resurrect a tombstoned fact`, async t => {
    const f = await fixture(t), make = { session, event, span }[entity];
    let sequence = 0;
    const commit = async mutations => {
      const n = ++sequence, value = batch({ batchId: `batch-${n}`, sequence: n,
        journal: { from: n, through: n }, mutations });
      accepted(await f.send(value), value, n);
    };
    const changed = entity === "session" ? { runtime: "codex" } :
      entity === "event" ? { status: "failed" } : { parentSpanId: "parent" };
    await commit([make(entity, 3)]);
    await commit([make(entity, 2, changed), make(entity, 3, changed), tombstone(entity, entity, 2)]);
    assert.deepEqual(await f.rows(`SELECT revision,facts_json FROM ${entity}_facts`),
      [{ revision: 3, facts_json: JSON.stringify(make(entity, 3).facts) }]);
    await commit([tombstone(entity, entity, 3)]);
    await commit([make(entity, 2), make(entity, 3), tombstone(entity, entity, 1)]);
    assert.deepEqual(await f.rows(`SELECT * FROM ${entity}_facts`), []);
    assert.deepEqual(await f.rows("SELECT entity_type,entity_key,revision FROM entity_tombstones"),
      [{ entity_type: entity, entity_key: entity, revision: 3 }]);
    await commit([make(entity, 4, changed)]);
    assert.deepEqual(await f.rows(`SELECT revision,facts_json FROM ${entity}_facts`),
      [{ revision: 4, facts_json: JSON.stringify(make(entity, 4, changed).facts) }]);
  });
}

test("source-key dedup and tombstones fence aliases, but null source keys remain distinct", async t => {
  const f = await fixture(t);
  const mutations = [event("original", 3, { sourceKey: "source" }),
    event("duplicate", 9, { sourceKey: "source" }), event("null-a"), event("null-b")];
  accepted(await f.send(batch({ mutations })), batch({ mutations }));
  assert.deepEqual(await f.rows("SELECT entity_key,revision FROM event_facts ORDER BY entity_key"),
    [{ entity_key: "null-a", revision: 1 }, { entity_key: "null-b", revision: 1 }, { entity_key: "original", revision: 3 }]);
  const second = batch({ batchId: "batch-2", sequence: 2, journal: { from: 2, through: 2 },
    mutations: [tombstone("event", "original", 3), event("alias", 3, { sourceKey: "source" }),
      event("older-alias", 2, { sourceKey: "source" })] });
  accepted(await f.send(second), second, 2);
  assert.deepEqual(await f.rows("SELECT entity_key FROM event_facts ORDER BY entity_key"),
    [{ entity_key: "null-a" }, { entity_key: "null-b" }]);
  assert.deepEqual(await f.rows("SELECT source_key,revision FROM entity_tombstones"), [{ source_key: "source", revision: 3 }]);
});

test("equal timestamps and out-of-order arrivals preserve source and recording orders, null and zero", async t => {
  const f = await fixture(t);
  const first = batch({ mutations: [
    event("later", 1, { sourceOrder: 9, recordingOrders: { codex: 9, omo: 0 } }),
    event("unknown"), span("unknown"), session(),
  ] });
  accepted(await f.send(first), first);
  const second = batch({ batchId: "batch-2", sequence: 2, journal: { from: 2, through: 2 }, mutations: [
    event("earlier", 1, { sourceOrder: 0, recordingOrders: { codex: 0, omo: 7 }, inputTokens: 0, outputTokens: 0 }),
    event("old-time", 1, { timestampMs: 0, sourceOrder: 5 }),
    span("zero", 1, { startMs: 0, endMs: 0, recordingOrders: { codex: 0 }, inputTokens: 0, outputTokens: 0 }),
    session("zero", 1, { endedMs: 0, automated: false }),
  ] });
  accepted(await f.send(second), second, 2);
  assert.deepEqual(await f.rows(`SELECT entity_key,source_order,recording_orders_json,
    json_extract(facts_json,'$.inputTokens') AS tokens FROM event_facts
    ORDER BY timestamp_ms,source_order NULLS LAST,entity_key`), [
    { entity_key: "old-time", source_order: 5, recording_orders_json: "{}", tokens: null },
    { entity_key: "earlier", source_order: 0, recording_orders_json: '{"codex":0,"omo":7}', tokens: 0 },
    { entity_key: "later", source_order: 9, recording_orders_json: '{"codex":9,"omo":0}', tokens: null },
    { entity_key: "unknown", source_order: null, recording_orders_json: "{}", tokens: null },
  ]);
  assert.deepEqual(await f.rows("SELECT entity_key,facts_json FROM span_facts ORDER BY entity_key"),
    [span("unknown"), second.mutations[2]].map(m => ({ entity_key: m.key, facts_json: JSON.stringify(m.facts) })));
  assert.deepEqual(await f.rows("SELECT entity_key,ended_ms,json_extract(facts_json,'$.automated') AS automated FROM session_facts ORDER BY entity_key"),
    [{ entity_key: "session", ended_ms: null, automated: null }, { entity_key: "zero", ended_ms: 0, automated: 0 }]);
});

for (const [name, changes] of Object.entries({
  scope: { scopes: ["activity:read"] }, management: { scopes: ["activity:ingest", "device:manage"] },
  device: { deviceId: "other" }, generation: { generation: 2 }, shard: { shardId: "other" },
})) test(`rejects mismatched ${name} principal without effects`, async t => {
  const f = await fixture(t);
  rejected(await f.send(batch(), principal(changes)), 403, "forbidden");
  await f.counts({});
});

for (const state of ["missing", "closed", "old-generation"]) {
  test(`never opens a ${state} tenant fence`, async t => {
    const f = await fixture(t, { seed: false });
    if (state !== "missing") await f.seedFence("account-a", state === "old-generation" ? 2 : 1,
      state === "old-generation" ? "active" : "closed");
    rejected(await f.send(), 403, "tenant_fenced");
    await f.counts({});
    assert.deepEqual(await f.rows("SELECT generation,state FROM tenant_fences"),
      state === "missing" ? [] : [{ generation: state === "old-generation" ? 2 : 1,
        state: state === "old-generation" ? "active" : "closed" }]);
  });
}

for (const effect of ["DELETE FROM tenant_fences", "UPDATE tenant_fences SET state='closed'",
  "UPDATE tenant_fences SET generation=2"]) test(`receipt retry respects fence: ${effect}`, async t => {
  const f = await fixture(t);
  accepted(await f.send(), batch());
  await f.db.prepare(effect).run();
  rejected(await f.send(), 403, "tenant_fenced");
  await f.counts(oneCommit);
});

for (const fault of ["abort", "close", "generation"]) {
  test(`late ${fault} failure atomically rolls back every effect and permits a clean retry`, async t => {
    const f = await fixture(t);
    const value = batch({ mutations: [session(), event(), span(), tombstone("event", "absent", 1)] });
    const effect = fault === "abort" ? "SELECT RAISE(ABORT,'injected_late')" :
      `UPDATE tenant_fences SET ${fault === "close" ? "state='closed'" : "generation=2"} WHERE account_id=NEW.account_id`;
    await f.db.prepare(`CREATE TRIGGER injected AFTER INSERT ON account_changes BEGIN ${effect}; END`).run();
    const result = await f.send(value);
    if (fault === "abort") { assert.equal(result.status, 500); assert.match(result.body.code, /injected_late/); }
    else rejected(result, 403, "tenant_fenced");
    await f.counts({});
    assert.deepEqual(await f.rows("SELECT generation,state FROM tenant_fences"), [{ generation: 1, state: "active" }]);
    await f.db.prepare("DROP TRIGGER injected").run();
    accepted(await f.send(value), value);
    await f.counts({ ...oneCommit, event_facts: 1, span_facts: 1, entity_tombstones: 1 });
  });
}

test("late failure preserves an existing head, stream, and projection rather than partially advancing them", async t => {
  const f = await fixture(t);
  accepted(await f.send(), batch());
  await f.db.prepare("CREATE TRIGGER injected AFTER INSERT ON account_changes BEGIN SELECT RAISE(ABORT,'injected_late'); END").run();
  const second = batch({ batchId: "batch-2", sequence: 2, journal: { from: 2, through: 3 },
    mutations: [session("session", 2, { runtime: "codex" }), event()] });
  const failed = await f.send(second);
  assert.equal(failed.status, 500);
  assert.match(failed.body.code, /injected_late/);
  await f.counts(oneCommit);
  assert.deepEqual(await f.rows("SELECT revision,runtime FROM session_facts"), [{ revision: 1, runtime: "unknown" }]);
  assert.deepEqual(await f.rows("SELECT head_seq FROM account_heads"), [{ head_seq: 1 }]);
  assert.deepEqual(await f.rows("SELECT sequence,journal_through FROM device_streams"), [{ sequence: 1, journal_through: 1 }]);
  await f.db.prepare("DROP TRIGGER injected").run();
  accepted(await f.send(second), second, 2);
  await f.counts({ ...oneCommit, ingest_receipts: 2, event_facts: 1, jobs: 2, dispatch_outbox: 2, account_changes: 2 });
});
