import assert from "node:assert/strict";
import { test } from "node:test";
import { consentSchema } from "../dist/activity-consent.js";
import { contentKinds, activityBatchSchema } from "../dist/activity-schema.js";
import {
  MAX_CONTENT_BYTES, MAX_CONTENT_CHUNK_BYTES, MAX_CONTENT_CHUNKS,
  contentBatchSchema, contentChunkUploadSchema, contentDocumentSchema,
  contentRowSchema, contentTables, hashContent, parseContentBatch,
  parseContentDocument, transformContentRows, verifyContentBatch, verifyContentChunkUpload,
} from "../dist/activity-content.js";

const encoder = new TextEncoder();
const scope = {
  deviceId: "device", projectId: "project", rootId: "root", consentVersion: 2,
  fromMs: 1000, toMs: 2000, contentKinds, backfill: null,
};
const grant = {
  mode: "managed-content", version: 2, grantedAtMs: 1000,
  scope: { deviceId: "device", projectIds: ["project"], rootIds: ["root"] },
  serverProcessingAcknowledged: true, contentKinds,
};
const consent = consentSchema.parse(grant);
const common = {
  schemaVersion: 2, batchId: "batch", deviceId: "device", sourceDomain: "lineage",
  generation: 1, consentVersion: 2, projectId: "project", rootId: "root",
  range: { fromMs: 1000, toMs: 2000 }, backfill: null,
};
const row = (table, values, extra = {}) => ({
  table, key: '["/private/한글🙂"]', revision: 7, operation: "upsert",
  sourceOrder: 0, values, ...extra,
});
const sentinel = "PRIVATE_한글🙂";
const mixed = JSON.stringify({ nested: [{ prompt: sentinel, args: sentinel, path: sentinel }] });
// Every P4 source column, including migrations 2–6, has an exact roundtrip.
const valuesByTable = {
  skills: {
    uri: sentinel, root_id: sentinel, name: sentinel, description: sentinel, tags_json: mixed,
    when_to_use: null, examples_json: mixed, aliases_ko_json: mixed, group_id: null,
    group_stage: null, invocation: sentinel, body_head: sentinel, digest: sentinel,
    manifest_digest: sentinel, resources_json: mixed, mtime_ms: 1000, removed_at: null,
  },
  sessions: {
    id: sentinel, runtime: sentinel, runtime_session_id: sentinel, conversation_id: null,
    client_name: sentinel, cwd: sentinel, started_at: 1000, ended_at: null,
    first_prompt: sentinel, end_orders_json: mixed,
  },
  events: {
    id: sentinel, ts: 1000, kind: sentinel, source: sentinel, session_id: sentinel,
    attribution_method: sentinel, attribution_reason: null, runtime: sentinel, trace_id: null,
    load_id: null, skill_uri: sentinel, tool_use_id: null, text: sentinel,
    text_digest: sentinel, text_length: 0, data_json: mixed, source_key: sentinel,
    turn_key: sentinel, call_id: sentinel, span_id: sentinel, recording_orders_json: mixed,
  },
  loads: {
    load_id: sentinel, trace_id: null, uri: sentinel, manifest_digest: sentinel,
    resources_json: mixed, created_at: 1000,
  },
  eval_cases: { id: sentinel, query: sentinel, expected_uri: sentinel, from_trace_id: null, created_at: 1000 },
  otel_spans: {
    trace_id: sentinel, span_id: sentinel, parent_span_id: null, name: sentinel, runtime: sentinel,
    conversation_id: sentinel, turn_key: sentinel, call_id: sentinel,
    start_ms: 1000, end_ms: null, received_at: 1000, recording_orders_json: mixed,
  },
  herdr_workspaces: { id: sentinel, label: sentinel, created_ms: 1000, closed_ms: null },
  herdr_tabs: { id: sentinel, workspace_id: sentinel, label: sentinel, created_ms: 1000, closed_ms: null },
  herdr_panes: {
    id: sentinel, workspace_id: sentinel, tab_id: sentinel, label: sentinel, cwd: sentinel,
    created_ms: 1000, closed_ms: null, agent: sentinel, last_seen_ms: 1000,
  },
  pane_sessions: {
    pane_id: sentinel, agent: sentinel, source: sentinel, agent_session_value: sentinel,
    session_id: sentinel, first_seen_ms: 1000, last_seen_ms: null,
  },
  workflow_specs: { id: sentinel, name: sentinel, version: 1, body_json: mixed, digest: sentinel, created_ms: 1000 },
  flows: {
    id: sentinel, workspace_id: sentinel, tab_id: sentinel, spec_id: sentinel, label: sentinel,
    registered_ms: 1000, ended_ms: null, start_event_ids_json: mixed, end_event_ids_json: mixed,
    end_sessions_json: mixed, end_spans_json: mixed, start_order_domain: sentinel,
    start_order: 0, end_order_domain: null, end_order: null,
  },
  flow_steps: { flow_id: sentinel, pane_id: sentinel, step_id: sentinel, registered_ms: 1000 },
  load_candidates: { load_id: sentinel, session_id: sentinel, ts: 1000 },
  recording_clock: { singleton: 1, domain: sentinel, position: 0 },
};
const allRows = Object.entries(valuesByTable).map(([table, values]) => row(table, values));

async function packet(document, chunkSize = MAX_CONTENT_CHUNK_BYTES) {
  const bytes = encoder.encode(JSON.stringify(document));
  const uploads = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const part = bytes.subarray(offset, offset + chunkSize);
    uploads.push({
      ...common, revision: 7, index: uploads.length,
      plaintextHash: await hashContent(part), bytes: part.length,
      body: Buffer.from(part).toString("base64"),
    });
  }
  const batch = {
    ...common, sequence: 1, journal: { from: 0, through: 7 }, metadataMutations: [],
    chunks: uploads.map(({ body, ...upload }) => ({
      index: upload.index, revision: upload.revision, bytes: upload.bytes,
      plaintextHash: upload.plaintextHash,
    })),
    totalBytes: bytes.length, contentHash: await hashContent(bytes),
  };
  return { batch, uploads };
}

test("all-kind consent preserves all fifteen Unicode row images through chunk reassembly", async () => {
  // Given
  assert.deepEqual(Object.keys(valuesByTable), [...contentTables]);
  const before = structuredClone(allRows);
  // When
  const document = await transformContentRows(consent, scope, allRows.map(value => ({ ...value, beforeValues: value.values })));
  const { batch, uploads } = await packet(document, 127);
  const result = await verifyContentBatch(batch, uploads, consent);
  // Then
  assert.deepEqual(result, { schemaVersion: 2, rows: before });
  assert.deepEqual(allRows, before);
  assert.ok(Object.isFrozen(result.rows[0].values));
  assert.ok(Object.isFrozen(parseContentBatch(batch).chunks[0]));
  assert.equal(JSON.stringify(result).includes("beforeValues"), false);
});

test("local-only returns null before accessing or serializing any row", async () => {
  // Given
  const rows = new Proxy([], { get() { throw new Error("row access"); } });
  // When / Then
  assert.equal(await transformContentRows({ mode: "local-only" }, scope, rows), null);
  assert.equal(Buffer.byteLength(await transformContentRows({ mode: "local-only" }, scope, rows) ?? ""), 0);
});

test("metadata contains only typed numeric fields and table-tagged hashed keys", async () => {
  // Given
  const metadata = consentSchema.parse({
    mode: "metadata", version: 2, grantedAtMs: 1000, scope: grant.scope,
  });
  const metadataScope = { ...scope, contentKinds: [] };
  // When
  const document = await transformContentRows(metadata, metadataScope, allRows);
  // Then
  assert.equal(JSON.stringify(document).includes(sentinel), false);
  for (const item of document.rows) {
    assert.equal(item.key, await hashContent(encoder.encode(`${item.table}\0${allRows[0].key}`)));
    assert.ok(Object.values(item.values).every(value => value === null || typeof value === "number"));
  }
  assert.deepEqual(parseContentDocument(document, metadata, metadataScope), document);
  assert.throws(() => parseContentDocument({ schemaVersion: 2, rows: [allRows[0]] }, metadata, metadataScope),
    { code: "content_not_allowed" });
});

for (const kind of contentKinds) {
  test(`selected ${kind} consent strips mixed JSON and unrelated source text`, async () => {
    // Given
    const selected = consentSchema.parse({ ...grant, contentKinds: [kind] });
    const selectedScope = { ...scope, contentKinds: [kind] };
    // When
    const document = await transformContentRows(selected, selectedScope, allRows);
    // Then
    for (const item of document.rows) {
      for (const column of Object.keys(item.values)) {
        assert.equal(column.endsWith("_json"), false);
      }
    }
    assert.equal(document.rows.find(item => item.table === "sessions").values.first_prompt,
      kind === "prompt" ? sentinel : undefined);
    assert.equal(document.rows.find(item => item.table === "eval_cases").values.query,
      kind === "query" ? sentinel : undefined);
    assert.equal(document.rows.find(item => item.table === "herdr_panes").values.cwd,
      kind === "path" ? sentinel : undefined);
    assert.equal(document.rows.find(item => item.table === "skills").values.body_head,
      kind === "private-skills" ? sentinel : undefined);
    assert.equal(document.rows.find(item => item.table === "events").values.text, undefined);
    assert.equal(document.rows.find(item => item.table === "skills").values.uri, undefined);
    assert.deepEqual(parseContentDocument(document, selected, selectedScope), document);
  });
}

test("server rejects a validly hashed chunk with forbidden nested sentinel content", async () => {
  // Given
  const selected = consentSchema.parse({ ...grant, contentKinds: ["prompt"] });
  const forbidden = { schemaVersion: 2, rows: [row("events", { data_json: mixed }, { key: "a".repeat(64) })] };
  const { batch, uploads } = await packet(forbidden);
  // When / Then
  await assert.rejects(verifyContentBatch(batch, uploads, selected), { code: "content_not_allowed" });
});

test("scope cannot silently broaden selected categories and deletion before-images stay local", async () => {
  // Given
  const selected = consentSchema.parse({ ...grant, contentKinds: ["prompt", "path"] });
  const narrow = { ...scope, contentKinds: ["prompt"] };
  const deleted = row("sessions", null, { operation: "delete", beforeValues: { started_at: 1000, first_prompt: sentinel } });
  // When
  const document = await transformContentRows(selected, narrow, [deleted]);
  // Then
  assert.equal(document.rows[0].values, null);
  assert.match(document.rows[0].key, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(document).includes(sentinel), false);
  assert.throws(() => parseContentDocument({ schemaVersion: 2, rows: [
    row("sessions", { cwd: sentinel }, { key: "a".repeat(64) }),
  ] }, selected, narrow), { code: "content_not_allowed" });
});

test("P1 device scope version and separate historical authorization are enforced before rows", async () => {
  // Given
  const unreadable = new Proxy([], { get() { throw new Error("unauthorized row access"); } });
  // When / Then
  for (const change of [
    { deviceId: "other" }, { projectId: "other" }, { rootId: "other" }, { consentVersion: 3 },
  ]) await assert.rejects(transformContentRows(consent, { ...scope, ...change }, unreadable), { code: "consent_required" });
  await assert.rejects(transformContentRows(consent, { ...scope, fromMs: 0 }, unreadable), { code: "range_not_allowed" });
  const backfill = { version: 1, snapshotId: "snap", journalCut: 7 };
  const historical = { ...scope, fromMs: 0, toMs: 1000, backfill };
  await assert.rejects(transformContentRows(consent, historical, unreadable), { code: "range_not_allowed" });
  const historicalConsent = consentSchema.parse({
    ...grant, backfill: { ...backfill, range: { fromMs: 0, toMs: 1000 } },
  });
  const document = await transformContentRows(historicalConsent, historical, [row("events", { ts: 0 })]);
  assert.equal(document.rows[0].values.ts, 0);
  await assert.rejects(transformContentRows(historicalConsent, {
    ...historical, backfill: { ...backfill, journalCut: 8 },
  }, unreadable), { code: "range_not_allowed" });
});

test("every typed timestamp rejects strings, nonintegers and out-of-range row evidence", async () => {
  // Given / When / Then
  for (const [table, values] of Object.entries(valuesByTable)) {
    for (const [column, value] of Object.entries(values)) {
      if (value !== 1000) continue;
      for (const invalid of ["1000", 1000.5, 8640000000000001]) {
        assert.equal(contentRowSchema.safeParse(row(table, { [column]: invalid })).success, false);
      }
      for (const outside of [999, 2000]) {
        await assert.rejects(transformContentRows(consent, scope, [row(table, { [column]: outside })]),
          { code: "range_not_allowed" });
      }
    }
  }
  await assert.rejects(transformContentRows(consent, scope, [
    row("sessions", null, { operation: "delete", beforeValues: { started_at: 999 } }),
  ]), { code: "range_not_allowed" });
});

test("strict source documents reject unknown columns, nesting, beforeValues and invalid versions", () => {
  // Given
  const valid = row("events", { ts: 1000 });
  // When / Then
  for (const invalid of [
    { ...valid, table: "meta" }, { ...valid, accountId: "forged" },
    { ...valid, beforeValues: null }, { ...valid, values: { unknown: sentinel } },
    { ...valid, values: { data_json: { nested: sentinel } } },
    { ...valid, values: { text_length: sentinel } }, { ...valid, values: { ts: true } },
    { ...valid, operation: "delete" }, { ...valid, values: null },
    { ...valid, revision: -1 }, { ...valid, sourceOrder: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.equal(contentRowSchema.safeParse(invalid).success, false);
  for (const invalid of [
    { schemaVersion: 1, rows: [valid] }, { schemaVersion: 2, rows: [valid], accountId: "forged" },
    { schemaVersion: 2, rows: Array(10001).fill(valid) },
    { schemaVersion: 2, rows: [row("sessions", { first_prompt: "x".repeat(MAX_CONTENT_BYTES) })] },
  ]) assert.equal(contentDocumentSchema.safeParse(invalid).success, false);
});

test("chunk verification checks decoded SHA256 bytes, canonical base64 and 128 KiB limit", async () => {
  // Given
  const data = new Uint8Array(MAX_CONTENT_CHUNK_BYTES).fill(65);
  const chunk = {
    ...common, revision: 0, index: 0, bytes: data.length,
    plaintextHash: await hashContent(data), body: Buffer.from(data).toString("base64"),
  };
  // When / Then
  assert.deepEqual(await verifyContentChunkUpload(chunk), data);
  for (const change of [
    { bytes: data.length - 1 }, { plaintextHash: "0".repeat(64) },
    { body: `${chunk.body.slice(0, -4)}QkI=` },
  ]) await assert.rejects(verifyContentChunkUpload({ ...chunk, ...change }), { code: "chunk_integrity" });
  const one = { ...chunk, bytes: 1, plaintextHash: await hashContent(new Uint8Array([65])), body: "QR==" };
  await assert.rejects(verifyContentChunkUpload(one), { code: "chunk_integrity" });
  for (const change of [
    { bytes: MAX_CONTENT_CHUNK_BYTES + 1 }, { bytes: 0 }, { index: MAX_CONTENT_CHUNKS },
    { revision: -1 }, { plaintextHash: "A".repeat(64) }, { body: "!!!=" }, { body: "" },
    { accountId: "forged" }, { schemaVersion: 1 },
  ]) {
    assert.equal(contentChunkUploadSchema.safeParse({ ...chunk, ...change }).success, false);
  }
  // More than the decoded limit can share the same base64 length; async verification owns this check.
  const tooLarge = Buffer.alloc(MAX_CONTENT_CHUNK_BYTES + 1);
  await assert.rejects(verifyContentChunkUpload({
    ...chunk, body: tooLarge.toString("base64"),
  }), { code: "chunk_integrity" });
});

test("batch bounds enforce ordered contiguous references and exact totals without account identity", async () => {
  // Given
  const { batch } = await packet({ schemaVersion: 2, rows: [row("events", { ts: 1000 })] });
  // When / Then
  assert.ok(contentBatchSchema.safeParse(batch).success);
  assert.equal(activityBatchSchema.safeParse(batch).success, false);
  const ref = batch.chunks[0];
  for (const change of [
    { schemaVersion: 1 }, { accountId: "forged" }, { metadataMutations: Array(101).fill({}) },
    { chunks: [] }, { chunks: [{ ...ref, index: 1 }] },
    { chunks: [ref, ref], totalBytes: ref.bytes * 2 },
    { chunks: [{ ...ref, index: 1 }, ref], totalBytes: ref.bytes * 2 },
    { totalBytes: batch.totalBytes + 1 }, { totalBytes: MAX_CONTENT_BYTES + 1 },
    { contentHash: "not-sha256" }, { journal: { from: 2, through: 1 } }, { sequence: 0 },
    { chunks: Array.from({ length: 129 }, (_, index) => ({ ...ref, index })) },
    { metadataMutations: [{
      entity: "session", key: "id", revision: 1,
      facts: { runtime: "unknown", startedMs: 2000, endedMs: null, automated: null },
    }] },
    { metadataMutations: [{
      entity: "session", key: "id", revision: 1,
      facts: { runtime: "unknown", startedMs: 1000, endedMs: null, automated: null, raw: sentinel },
    }] },
  ]) assert.throws(() => parseContentBatch({ ...batch, ...change }));
  const maximum = {
    ...batch, chunks: Array.from({ length: MAX_CONTENT_CHUNKS }, (_, index) =>
      ({ ...ref, index, bytes: MAX_CONTENT_CHUNK_BYTES })), totalBytes: MAX_CONTENT_BYTES,
  };
  assert.ok(contentBatchSchema.safeParse(maximum).success);
  assert.throws(() => parseContentBatch({
    ...batch, metadataMutations: Array.from({ length: 100 }, () => ({
      entity: "tombstone", target: "event", key: "\u0001".repeat(512), revision: 1,
    })),
  }));
});

test("reassembly rejects changed immutable scope refs order whole hash and invalid UTF8", async () => {
  // Given
  const document = { schemaVersion: 2, rows: [row("sessions", { first_prompt: sentinel })] };
  const { batch, uploads } = await packet(document, 100);
  // When / Then
  for (const change of [
    { sourceDomain: "other" }, { batchId: "other" }, { revision: 8 },
    { projectId: "other" }, { range: { fromMs: 999, toMs: 2000 } },
    { generation: 2 }, { backfill: { version: 1, snapshotId: "snap", journalCut: 0 } },
  ]) await assert.rejects(verifyContentBatch(batch, [{ ...uploads[0], ...change }, ...uploads.slice(1)], consent),
    { code: "content_integrity" });
  await assert.rejects(verifyContentBatch({ ...batch, contentHash: "0".repeat(64) }, uploads, consent),
    { code: "content_integrity" });
  await assert.rejects(verifyContentBatch(batch, uploads.slice(1), consent), { code: "content_integrity" });
  await assert.rejects(verifyContentBatch(batch, [...uploads].reverse(), consent), { code: "content_integrity" });
  await assert.rejects(verifyContentBatch(batch, uploads, { mode: "local-only" }), { code: "consent_required" });
  const invalid = new Uint8Array([0xff]);
  const hash = await hashContent(invalid);
  await assert.rejects(verifyContentBatch({
    ...batch, chunks: [{ index: 0, revision: 7, bytes: 1, plaintextHash: hash }],
    totalBytes: 1, contentHash: hash,
  }, [{ ...common, index: 0, revision: 7, bytes: 1, plaintextHash: hash, body: "/w==" }], consent), TypeError);
});
