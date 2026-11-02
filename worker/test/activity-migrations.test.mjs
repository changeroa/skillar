import assert from "node:assert/strict";
import test from "node:test";
import { fixture, snapshot, ref, packet, principal } from "./helpers/activity-migrations.mjs";

const doc = rows => ({ schemaVersion: 2, rows });
const row = (table, key, values, revision = 0, sourceOrder = 0) => ({
  table, key, values, revision, sourceOrder, operation: "upsert",
});
const small = doc([row("sessions", '["session"]', {
  id: "session", started_at: 100, first_prompt: "RAW_SENTINEL_한글🙂", end_orders_json: null,
})]);
const fullRows = () => {
  const s = "RAW_SENTINEL_한글🙂";
  const vector = '{"original-domain":0,"other-domain":17}';
  const mixed = JSON.stringify({ args: { nested: [s, null, 0] }, path: "/original/path" });
  const tables = {
    skills: { uri: s, root_id: s, name: s, description: s, tags_json: mixed, when_to_use: null,
      examples_json: mixed, aliases_ko_json: mixed, group_id: null, group_stage: null,
      invocation: s, body_head: s, digest: s, manifest_digest: s, resources_json: mixed,
      mtime_ms: 0, removed_at: null },
    sessions: { id: s, runtime: s, runtime_session_id: s, conversation_id: null, client_name: s,
      cwd: s, started_at: 0, ended_at: null, first_prompt: s, end_orders_json: vector },
    events: { id: s, kind: s, source: s, session_id: s, attribution_method: s,
      attribution_reason: null, runtime: s, trace_id: null, load_id: null, skill_uri: s,
      tool_use_id: null, ts: 0, text: s, text_digest: s, text_length: 0,
      data_json: mixed, source_key: s, turn_key: s, call_id: s, span_id: s, recording_orders_json: vector },
    loads: { load_id: s, trace_id: null, uri: s, manifest_digest: s, resources_json: mixed, created_at: 0 },
    eval_cases: { id: s, query: s, expected_uri: s, from_trace_id: null, created_at: 0 },
    otel_spans: { trace_id: s, span_id: s, parent_span_id: null, name: s, runtime: s,
      conversation_id: s, turn_key: s, call_id: s, start_ms: 0, end_ms: null, received_at: 0,
      recording_orders_json: vector },
    herdr_workspaces: { id: s, label: s, created_ms: 0, closed_ms: null },
    herdr_tabs: { id: s, workspace_id: s, label: s, created_ms: 0, closed_ms: null },
    herdr_panes: { id: s, workspace_id: s, tab_id: s, label: s, cwd: s, agent: s,
      created_ms: 0, closed_ms: null, last_seen_ms: 0 },
    pane_sessions: { pane_id: s, agent: s, source: s, agent_session_value: s, session_id: s,
      first_seen_ms: 0, last_seen_ms: null },
    workflow_specs: { id: s, name: s, version: 1, body_json: mixed, digest: s, created_ms: 0 },
    flows: { id: s, workspace_id: s, tab_id: s, spec_id: s, label: s, registered_ms: 0,
      ended_ms: null, start_event_ids_json: mixed, end_event_ids_json: mixed,
      end_sessions_json: mixed, end_spans_json: mixed, start_order_domain: s,
      start_order: 0, end_order_domain: null, end_order: null },
    flow_steps: { flow_id: s, pane_id: s, step_id: s, registered_ms: 0 },
    load_candidates: { load_id: s, session_id: s, ts: 0 },
    recording_clock: { singleton: 1, domain: "original-domain", position: 0 },
  };
  return Object.entries(tables).map(([table, values], index) =>
    row(table, JSON.stringify([s, table]), values, 0, index === 13 ? null : index - 1));
};
const success = response => {
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.body;
};
const noPublication = async f => {
  for (const table of ["migration_snapshots", "device_streams", "account_heads",
    "account_changes", "ingest_receipts", "jobs", "dispatch_outbox"]) {
    assert.equal((await f.rows(`SELECT COUNT(*) n FROM ${table}`))[0].n, 0, table);
  }
};
async function ready(t, documents = [small], options) {
  const f = await fixture(t), s = await snapshot(f, documents, options);
  success(await f.send("begin", s.begin));
  for (const [index] of documents.entries()) success(await s.stage(index));
  return { f, s };
}

test("revision0 cut0 baseline publishes all fifteen tables and exports original complete values", { timeout: 30000 }, async t => {
  // Given three bounded pages, including a multipart Unicode page, from a historical database.
  const rows = fullRows();
  rows[1].values.first_prompt += "한글🙂".repeat(20000);
  const documents = [doc(rows.slice(0, 5)), doc(rows.slice(5, 10)), doc(rows.slice(10))];
  const { f, s } = await ready(t, documents);
  assert.ok(s.packets[0].uploads.length > 1);
  await noPublication(f);
  // When the verified baseline is atomically completed, then retried after response loss.
  const accepted = success(await f.send("complete", ref(s.begin)));
  assert.deepEqual(success(await f.send("complete", ref(s.begin))), accepted);
  // Then original lineage, cut, revisions, full values, vectors and unknown boundaries survive.
  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.cursor, { sequence: 0, journalThrough: 0, changeSeq: 1 });
  const exported = [];
  for (const [index, expected] of documents.entries()) {
    const out = success(await f.send("export", { ...ref(s.begin), page: index }));
    assert.deepEqual(out.migration, s.begin);
    assert.deepEqual(out.document, expected);
    exported.push(...out.document.rows);
  }
  const verified = success(await f.send("summary", exported));
  assert.equal(verified.snapshotHash, s.begin.snapshotHash);
  assert.deepEqual(verified.counts, s.begin.counts);
  assert.ok(Object.values(verified.counts).every(count => count === 1));
  assert.equal((await f.rows("SELECT COUNT(*) n FROM account_changes"))[0].n, 1);
  assert.equal((await f.rows("SELECT COUNT(*) n FROM dispatch_outbox"))[0].n, 1);
  for (const table of ["migration_runs", "migration_pages", "content_uploads", "jobs", "dispatch_outbox"]) {
    assert.equal(JSON.stringify(await f.rows(`SELECT * FROM ${table}`)).includes("RAW_SENTINEL"), false);
  }
  for (const object of (await f.bucket.list()).objects) {
    assert.equal((await (await f.bucket.get(object.key)).text()).includes("RAW_SENTINEL"), false);
  }
});

test("multi-page stage resumes durably without premature acceptance or changed duplicates", { timeout: 30000 }, async t => {
  // Given a run with only the second page staged.
  const f = await fixture(t);
  const s = await snapshot(f, [small, doc([row("events", '["e"]', { id: "e", ts: 100 })])]);
  const begun = success(await f.send("begin", s.begin));
  assert.deepEqual(success(await f.send("begin", s.begin)), begun);
  success(await s.stage(1));
  await noPublication(f);
  // When a resumed caller requests status and retries immutable page identities.
  const resumed = success(await f.send("status", ref(s.begin)));
  assert.deepEqual(resumed.stagedPages, [s.packets[1].page]);
  assert.equal(resumed.cursor, null);
  assert.equal((await f.send("complete", ref(s.begin))).status, 409);
  assert.equal((await f.send("export", ref(s.begin))).status, 409);
  assert.equal((await f.send("begin", { ...s.begin, snapshotHash: "a".repeat(64) })).status, 409);
  assert.equal((await f.send("page", { ...s.packets[1].page, contentHash: "a".repeat(64) })).status, 409);
  assert.equal((await f.send("chunk", { ...s.packets[1].uploads[0], index: 1 })).status, 409);
  assert.deepEqual(success(await f.send("page", s.packets[1].page)), { staged: true, page: s.packets[1].page });
  success(await s.stage(0));
  // Then completing the original pages publishes exactly once.
  assert.equal(success(await f.send("complete", ref(s.begin))).accepted, true);
  assert.equal((await f.rows("SELECT COUNT(*) n FROM account_changes"))[0].n, 1);
});

test("missing or forged R2 plaintext never stages or acknowledges a baseline", { timeout: 30000 }, async t => {
  // Given valid references but no uploaded chunks.
  const f = await fixture(t), s = await snapshot(f, [small]);
  success(await f.send("begin", s.begin));
  // When staging before upload, then completing after a staged object's encrypted bytes disappear.
  assert.equal((await f.send("page", s.packets[0].page)).status, 409);
  await noPublication(f);
  success(await s.stage(0));
  const [{ object_key: key }] = await f.rows("SELECT object_key FROM content_uploads");
  await f.bucket.delete(key);
  const denied = await f.send("complete", ref(s.begin));
  // Then the actual R2 read, not the claimed manifest, governs durable acceptance.
  assert.equal(denied.status, 409);
  await noPublication(f);
});

test("wrong whole hash counts or duplicate source keys cannot publish", { timeout: 30000 }, async t => {
  // Given valid individual pages with a duplicate identity across the page boundary.
  const f = await fixture(t), s = await snapshot(f, [small,
    doc([row("sessions", '["different"]', { id: "different", started_at: 100 })])]);
  success(await f.send("begin", s.begin));
  success(await s.stage(0));
  const duplicate = await packet(small, { through: 0, batchId: s.packets[1].page.batchId });
  for (const upload of duplicate.uploads) {
    success(await f.send("chunk", { ...upload, backfill: s.begin.backfill }));
  }
  success(await f.send("page", { ...s.packets[1].page, chunks: duplicate.batch.chunks,
    contentHash: duplicate.batch.contentHash, totalBytes: duplicate.batch.totalBytes }));
  // When complete recomputes the entire snapshot rather than trusting page summaries.
  const denied = await f.send("complete", ref(s.begin));
  // Then duplicate source rows fail before any publication or cursor.
  assert.equal(denied.status, 409);
  await noPublication(f);
});

test("incorrect declared whole hash fails despite valid page hashes", { timeout: 30000 }, async t => {
  // Given a run whose pages are authentic but whole snapshot hash is wrong.
  const { f, s } = await ready(t, [small], { snapshotHash: "a".repeat(64) });
  // When completion verifies canonical values.
  assert.equal((await f.send("complete", ref(s.begin))).status, 409);
  // Then no fake hash can initialize the stream.
  await noPublication(f);
});

test("incorrect table count fails at staging and at whole-snapshot verification", { timeout: 30000 }, async t => {
  // Given a correct page and an incorrect fifteen-table aggregate vector.
  const f = await fixture(t), s = await snapshot(f, [small]);
  s.begin.counts.events = 1;
  success(await f.send("begin", s.begin));
  for (const upload of s.packets[0].uploads) success(await f.send("chunk", upload));
  // When either page or whole count is falsely declared.
  assert.equal((await f.send("page", {
    ...s.packets[0].page, counts: { ...s.packets[0].page.counts, events: 1 },
  })).status, 409);
  success(await f.send("page", s.packets[0].page));
  assert.equal((await f.send("complete", ref(s.begin))).status, 409);
  // Then table count mismatches have no durable acceptance.
  await noPublication(f);
});

test("closed generation blocks publication and final-transaction fence rolls every effect back", { timeout: 30000 }, async t => {
  // Given verified staging and a deterministic deletion event during cursor publication.
  const { f, s } = await ready(t);
  await f.db.prepare(`CREATE TRIGGER test_close_generation AFTER INSERT ON device_streams
    BEGIN UPDATE tenant_fences SET state='closed'; END`).run();
  // When final publication reaches the last same-shard fence.
  assert.equal((await f.send("complete", ref(s.begin))).status, 403);
  // Then publication, cursor, jobs, changes and state all rolled back together.
  await noPublication(f);
  assert.equal((await f.rows("SELECT state FROM migration_runs"))[0].state, "staging");
  await f.db.prepare("DROP TRIGGER test_close_generation").run();
  await f.db.prepare("UPDATE tenant_fences SET state='closed'").run();
  assert.equal((await f.send("complete", ref(s.begin))).status, 403);
  await noPublication(f);
  assert.equal((await f.send("sweep", { orphanBeforeMs: Number.MAX_SAFE_INTEGER })).body.deleted, 1);
});

test("staged and published page pins stop P5 GC without starving unrelated orphan cleanup", { timeout: 30000 }, async t => {
  // Given an active staged snapshot whose upload would otherwise be an old orphan.
  const { f, s } = await ready(t);
  // When the unchanged P5 sweeper claims it before and after publication.
  assert.equal(success(await f.send("sweep", { orphanBeforeMs: Number.MAX_SAFE_INTEGER })).deleted, 0);
  const orphan = { ...s.packets[0].uploads[0], batchId: "unrelated-orphan" };
  success(await f.send("chunk", orphan));
  await f.db.prepare("UPDATE content_uploads SET purge_order=100 WHERE batch_id='unrelated-orphan'").run();
  assert.equal(success(await f.send("sweep", { limit: 1, orphanBeforeMs: Number.MAX_SAFE_INTEGER })).deleted, 1);
  success(await f.send("complete", ref(s.begin)));
  // P5 deliberately retains upload intents and may DELETE an already absent
  // orphan again; the pinned snapshot must remain excluded and readable.
  assert.equal(success(await f.send("sweep", { orphanBeforeMs: Number.MAX_SAFE_INTEGER })).deleted, 1);
  assert.deepEqual(await f.rows("SELECT state FROM content_uploads WHERE batch_id=?", s.packets[0].page.batchId),
    [{ state: "committed" }]);
  // Then both stage verification and published reverse export retain actual R2 bytes.
  assert.deepEqual(success(await f.send("export", { ...ref(s.begin), page: 0 })).document, small);
});

test("GC wins before staging and no final manifest can revive a purged chunk", { timeout: 30000 }, async t => {
  // Given uploaded but unpinned page chunks.
  const f = await fixture(t), s = await snapshot(f, [small]);
  success(await f.send("begin", s.begin));
  for (const upload of s.packets[0].uploads) success(await f.send("chunk", upload));
  assert.equal(success(await f.send("sweep", { orphanBeforeMs: Number.MAX_SAFE_INTEGER })).deleted, 1);
  // When an obsolete caller tries to stage and publish those references.
  assert.equal((await f.send("page", s.packets[0].page)).status, 409);
  assert.equal((await f.send("complete", ref(s.begin))).status, 409);
  // Then purging wins, without a premature stream ACK.
  await noPublication(f);
});

test("closed-generation late PUT remains cleanable after an earlier successful sweep", { timeout: 30000 }, async t => {
  // Given a durable P5 upload intent whose actual encrypted PUT timed out.
  const f = await fixture(t), s = await snapshot(f, [small]);
  success(await f.send("begin", s.begin));
  success(await f.send("armLatePut", {}));
  assert.notEqual((await f.send("chunk", s.packets[0].uploads[0])).status, 200);
  assert.equal((await f.rows("SELECT state FROM content_uploads"))[0].state, "writing");
  await f.db.prepare("UPDATE tenant_fences SET state='closed'").run();
  success(await f.send("sweep", {}));
  // When the exact deferred encrypted PUT arrives after the deletion event.
  success(await f.send("releaseLatePut", {}));
  assert.equal((await f.bucket.list()).objects.length, 1);
  // Then a later closed-generation sweep still tracks it and publication remains fenced.
  assert.equal(success(await f.send("sweep", {})).deleted, 1);
  assert.equal((await f.bucket.list()).objects.length, 0);
  assert.equal((await f.send("complete", ref(s.begin))).status, 403);
  await noPublication(f);
});

test("rollback preserves accepted baseline and later CDC while abandoning only new staging", { timeout: 30000 }, async t => {
  // Given an accepted baseline followed by genuine P5 content.
  const { f, s } = await ready(t, [small], { cut: 7 });
  success(await f.send("complete", ref(s.begin)));
  await f.consent(s.begin, { grantedAtMs: 0 });
  const cdc = await packet(doc([row("sessions", '["session"]', {
    id: "session", started_at: 100, first_prompt: "AFTER", end_orders_json: null,
  }, 8)]), { from: 7, through: 8 });
  for (const upload of cdc.uploads) success(await f.send("chunk", upload));
  success(await f.send("cdc", cdc.batch));
  const before = await f.rows("SELECT * FROM device_streams");
  // When rollback is requested on the accepted migration.
  const rolled = success(await f.send("rollback", ref(s.begin)));
  // Then accepted bytes, current cursor and newer accepted data survive.
  assert.equal(rolled.rollbackRequested, true);
  assert.equal(rolled.accepted, true);
  assert.deepEqual(await f.rows("SELECT * FROM device_streams"), before);
  assert.deepEqual(success(await f.send("export", { ...ref(s.begin), page: 0 })).document, small);
  assert.equal(success(await f.send("readCdc", { sourceDomain: "source", batchId: "batch-1" }))
    .rows[0].values.first_prompt, "AFTER");
});

test("abandoned staging unpins pages but cannot complete or be repurposed", { timeout: 30000 }, async t => {
  // Given a staged, unaccepted run.
  const { f, s } = await ready(t);
  // When the owner rolls it back.
  const rolled = success(await f.send("rollback", ref(s.begin)));
  // Then only staging is abandoned; no acceptance is claimed and R2 can be swept.
  assert.equal(rolled.state, "abandoned");
  assert.equal(rolled.accepted, false);
  assert.equal((await f.send("complete", ref(s.begin))).status, 409);
  assert.equal((await f.send("page", s.packets[0].page)).status, 409);
  assert.equal(success(await f.send("sweep", { orphanBeforeMs: Number.MAX_SAFE_INTEGER })).deleted, 1);
  await noPublication(f);
});

for (const cut of [0, 7]) test(`CDC begins sequence1 from cut+1 after baseline cut${cut}`, { timeout: 30000 }, async t => {
  // Given a distinct baseline cursor, even for historical revision/cut zero.
  const { f, s } = await ready(t, [small], { cut });
  success(await f.send("complete", ref(s.begin)));
  await f.consent(s.begin, { grantedAtMs: 0 });
  const cdc = await packet(doc([row("events", '["new"]', { id: "new", ts: 100 }, cut + 1)]),
    { from: cut, through: cut + 1, sequence: 1 });
  for (const upload of cdc.uploads) success(await f.send("chunk", upload));
  // When P5 accepts the first CDC batch with its unchanged lower-bound rule.
  const receipt = success(await f.send("cdc", cdc.batch));
  // Then it is the first ordinary receipt, not a synthetic baseline receipt.
  assert.equal(receipt.sequence, 1);
  assert.equal(receipt.projectedThrough, cut + 1);
  assert.deepEqual(await f.rows("SELECT sequence,journal_from,journal_through FROM ingest_receipts"),
    [{ sequence: 1, journal_from: cut + 1, journal_through: cut + 1 }]);
  assert.equal((await f.rows("SELECT head_seq FROM account_heads"))[0].head_seq, 2);
  const replacement = { ...s.begin, snapshotId: "replacement",
    backfill: { ...s.begin.backfill, snapshotId: "replacement" } };
  await f.consent(replacement);
  assert.equal((await f.send("begin", replacement)).body.error, "migration_epoch_required");
});

test("current consent device account generation and least scopes fence every operation", { timeout: 30000 }, async t => {
  // Given accepted original data under a verified same-device principal.
  const { f, s } = await ready(t);
  success(await f.send("complete", ref(s.begin)));
  // When read scope alone exports, but other identities or narrowed/revoked consent try to read or write.
  const readOnly = principal({ scopes: ["activity:read"] });
  assert.equal((await f.send("export", { ...ref(s.begin), page: 0 }, readOnly)).status, 200);
  assert.equal((await f.send("rollback", ref(s.begin), readOnly)).status, 403);
  for (const who of [principal({ accountId: "other" }), principal({ deviceId: "other" }),
    principal({ generation: 2 }), principal({ scopes: ["device:manage", "activity:read"] })]) {
    assert.equal((await f.send("export", { ...ref(s.begin), page: 0 }, who)).status, 403);
  }
  await f.consent(s.begin, { contentKinds: ["prompt"] });
  assert.equal((await f.send("export", { ...ref(s.begin), page: 0 })).status, 403);
  await f.consent(s.begin);
  await f.accounts.prepare("UPDATE devices SET revoked_at=1").run();
  // Then a formerly valid principal cannot continue after primary-D1 device revocation.
  for (const name of ["status", "complete", "export", "rollback"]) {
    assert.equal((await f.send(name, ref(s.begin))).status, 403);
  }
});

test("P5 cannot reuse staged migration chunks as an ordinary CDC manifest", { timeout: 30000 }, async t => {
  // Given staged snapshot chunks with an otherwise ordinary batch-shaped wrapper.
  const { f, s } = await ready(t, [doc([row("events", "e", { ts: 100 }, 1)])], { cut: 1 });
  const p = s.packets[0].page;
  const batch = {
    schemaVersion: 2, batchId: p.batchId, deviceId: s.begin.deviceId,
    sourceDomain: s.begin.sourceDomain, generation: 1, consentVersion: 1,
    projectId: "project", rootId: null, range: s.begin.range, backfill: s.begin.backfill,
    chunks: p.chunks, contentHash: p.contentHash, totalBytes: p.totalBytes,
    sequence: 1, journal: { from: 0, through: 1 }, metadataMutations: [],
  };
  // When the ordinary P5 publication path tries to claim these pinned chunks.
  assert.notEqual((await f.send("cdc", batch)).status, 200);
  // Then its entire receipt transaction rolls back and the baseline can still publish.
  await noPublication(f);
  assert.equal(success(await f.send("complete", ref(s.begin))).accepted, true);
});
