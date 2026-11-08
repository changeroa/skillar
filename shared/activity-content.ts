import { z } from "zod";
import {
  ActivityContractError, activityBatchSchema, contentKinds, MAX_BATCH_BYTES,
  metadataMutationSchema, parseActivityBatch, revisionSchema, timestampSchema,
} from "./activity-schema.js";
import { authorizeUpload } from "./activity-consent.js";
import type { ContentKind } from "./activity-schema.js";
import type { Consent, UploadScope } from "./activity-consent.js";

export const MAX_CONTENT_CHUNK_BYTES = 128 * 1024;
export const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
export const MAX_CONTENT_CHUNKS = 128;
const encoder = new TextEncoder();
export const plaintextHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const byteCount = z.number().int().min(1).max(MAX_CONTENT_CHUNK_BYTES);
const wireSize = (value: unknown): boolean =>
  encoder.encode(JSON.stringify(value)).byteLength <= MAX_BATCH_BYTES;
const identity = activityBatchSchema.unwrap().pick({
  batchId: true, deviceId: true, sourceDomain: true, generation: true,
  consentVersion: true, projectId: true, rootId: true, range: true, backfill: true,
}).shape;

/** Immutable references identify plaintext, not a caller-chosen storage key. */
export const contentChunkRefSchema = z.strictObject({
  index: z.number().int().min(0).max(MAX_CONTENT_CHUNKS - 1),
  plaintextHash: plaintextHashSchema, bytes: byteCount, revision: revisionSchema,
}).readonly();
export type ContentChunkRef = z.infer<typeof contentChunkRefSchema>;

export const contentChunkUploadSchema = z.strictObject({
  ...identity, schemaVersion: z.literal(2),
  ...contentChunkRefSchema.unwrap().shape,
  body: z.string().min(4).max(4 * Math.ceil(MAX_CONTENT_CHUNK_BYTES / 3))
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).refine(wireSize, "chunk JSON exceeds 256 KiB").readonly();
export type ContentChunkUpload = z.infer<typeof contentChunkUploadSchema>;

export const contentBatchSchema = z.strictObject({
  ...identity, schemaVersion: z.literal(2),
  sequence: activityBatchSchema.unwrap().shape.sequence,
  journal: activityBatchSchema.unwrap().shape.journal,
  metadataMutations: z.array(metadataMutationSchema).max(100).readonly(),
  chunks: z.array(contentChunkRefSchema).min(1).max(MAX_CONTENT_CHUNKS).readonly(),
  contentHash: plaintextHashSchema,
  totalBytes: z.number().int().min(1).max(MAX_CONTENT_BYTES),
}).superRefine((batch, ctx) => {
  if (batch.chunks.some((chunk, index) => chunk.index !== index)) {
    ctx.addIssue({ code: "custom", message: "chunk indexes must be ordered and contiguous" });
  }
  if (batch.chunks.reduce((total, chunk) => total + chunk.bytes, 0) !== batch.totalBytes) {
    ctx.addIssue({ code: "custom", message: "chunk byte totals do not match" });
  }
  if (!wireSize(batch)) ctx.addIssue({ code: "custom", message: "batch JSON exceeds 256 KiB" });
  if (batch.metadataMutations.length > 0) {
    // Reuse the v1 range checks without changing or loosening its schema.
    const { chunks, contentHash, totalBytes, metadataMutations, ...common } = batch;
    parseActivityBatch({ ...common, schemaVersion: 1, mutations: metadataMutations });
  }
}).readonly();
export type ContentBatch = z.infer<typeof contentBatchSchema>;

export function parseContentChunkUpload(input: unknown): ContentChunkUpload {
  return contentChunkUploadSchema.parse(input);
}

export function parseContentBatch(input: unknown): ContentBatch {
  return contentBatchSchema.parse(input);
}

export class ContentContractError extends Error {
  constructor(readonly code: "chunk_integrity" | "content_integrity" | "document_too_large") {
    super(code);
    this.name = "ContentContractError";
  }
}

export async function hashContent(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** A syntactically valid chunk is not trusted until this asynchronous check. */
export async function verifyContentChunkUpload(input: unknown): Promise<Uint8Array> {
  const chunk = parseContentChunkUpload(input);
  const binary = atob(chunk.body);
  const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
  if (btoa(binary) !== chunk.body || bytes.byteLength !== chunk.bytes ||
      bytes.byteLength > MAX_CONTENT_CHUNK_BYTES ||
      await hashContent(bytes) !== chunk.plaintextHash) {
    throw new ContentContractError("chunk_integrity");
  }
  return bytes;
}

export const contentTables = [
  "skills", "sessions", "events", "loads", "eval_cases", "otel_spans",
  "herdr_workspaces", "herdr_tabs", "herdr_panes", "pane_sessions",
  "workflow_specs", "flows", "flow_steps", "load_candidates", "recording_clock",
] as const;
export const contentTableSchema = z.enum(contentTables);
export type ContentTable = z.infer<typeof contentTableSchema>;
export const contentScalarSchema = z.union([z.string().max(MAX_CONTENT_BYTES), z.number().finite(), z.null()]);
export const contentValuesSchema = z.record(z.string(), contentScalarSchema).readonly();

// Closed P4 source columns. New local columns require an explicit wire review.
const numericColumns: Readonly<Record<ContentTable, readonly string[]>> = {
  skills: ["mtime_ms", "removed_at"], sessions: ["started_at", "ended_at"],
  events: ["ts", "text_length"], loads: ["created_at"], eval_cases: ["created_at"],
  otel_spans: ["start_ms", "end_ms", "received_at"],
  herdr_workspaces: ["created_ms", "closed_ms"], herdr_tabs: ["created_ms", "closed_ms"],
  herdr_panes: ["created_ms", "closed_ms", "last_seen_ms"],
  pane_sessions: ["first_seen_ms", "last_seen_ms"], workflow_specs: ["version", "created_ms"],
  flows: ["registered_ms", "ended_ms", "start_order", "end_order"],
  flow_steps: ["registered_ms"], load_candidates: ["ts"],
  recording_clock: ["singleton", "position"],
};
const textColumns: Readonly<Record<ContentTable, readonly string[]>> = {
  skills: ["uri", "root_id", "name", "description", "tags_json", "when_to_use",
    "examples_json", "aliases_ko_json", "group_id", "group_stage", "invocation",
    "body_head", "digest", "manifest_digest", "resources_json"],
  sessions: ["id", "runtime", "runtime_session_id", "conversation_id", "client_name",
    "cwd", "first_prompt", "end_orders_json"],
  events: ["id", "kind", "source", "session_id", "attribution_method", "attribution_reason",
    "runtime", "trace_id", "load_id", "skill_uri", "tool_use_id", "text", "text_digest",
    "data_json", "source_key", "turn_key", "call_id", "span_id", "recording_orders_json"],
  loads: ["load_id", "trace_id", "uri", "manifest_digest", "resources_json"],
  eval_cases: ["id", "query", "expected_uri", "from_trace_id"],
  otel_spans: ["trace_id", "span_id", "parent_span_id", "name", "runtime",
    "conversation_id", "turn_key", "call_id", "recording_orders_json"],
  herdr_workspaces: ["id", "label"], herdr_tabs: ["id", "workspace_id", "label"],
  herdr_panes: ["id", "workspace_id", "tab_id", "label", "cwd", "agent"],
  pane_sessions: ["pane_id", "agent", "source", "agent_session_value", "session_id"],
  workflow_specs: ["id", "name", "body_json", "digest"],
  flows: ["id", "workspace_id", "tab_id", "spec_id", "label", "start_event_ids_json",
    "end_event_ids_json", "end_sessions_json", "end_spans_json", "start_order_domain", "end_order_domain"],
  flow_steps: ["flow_id", "pane_id", "step_id"],
  load_candidates: ["load_id", "session_id"], recording_clock: ["domain"],
};
const nonTimeColumns = new Set(["text_length", "version", "start_order", "end_order", "singleton", "position"]);

export const contentRowSchema = z.strictObject({
  table: contentTableSchema, key: z.string().max(MAX_CONTENT_BYTES),
  revision: revisionSchema, operation: z.enum(["upsert", "delete"]),
  sourceOrder: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable(),
  values: contentValuesSchema.nullable(),
}).superRefine((row, ctx) => {
  if ((row.operation === "delete") !== (row.values === null)) {
    ctx.addIssue({ code: "custom", message: "delete requires null values; upsert requires values" });
  }
  for (const [column, value] of Object.entries(row.values ?? {})) {
    const numeric = numericColumns[row.table].includes(column);
    if (!numeric && !textColumns[row.table].includes(column)) {
      ctx.addIssue({ code: "custom", path: ["values", column], message: "unknown source column" });
    } else if (value !== null && typeof value !== (numeric ? "number" : "string")) {
      ctx.addIssue({ code: "custom", path: ["values", column], message: "incorrect source column type" });
    } else if (numeric && !nonTimeColumns.has(column) && !timestampSchema.nullable().safeParse(value).success) {
      ctx.addIssue({ code: "custom", path: ["values", column], message: "invalid source timestamp" });
    }
  }
}).readonly();
export type ContentRow = z.infer<typeof contentRowSchema>;
export const contentDocumentSchema = z.strictObject({
  schemaVersion: z.literal(2), rows: z.array(contentRowSchema).max(10000).readonly(),
}).refine(document => encoder.encode(JSON.stringify(document)).byteLength <= MAX_CONTENT_BYTES,
  "document exceeds 16 MiB").readonly();
export type ContentDocument = z.infer<typeof contentDocumentSchema>;

/** Before-images are accepted only at the local boundary and never serialized. */
const localRowSchema = z.strictObject({
  ...contentRowSchema.unwrap().shape,
  beforeValues: contentValuesSchema.nullable().optional(),
}).readonly();

function granted(consent: Consent, kinds: readonly ContentKind[]): boolean {
  return consent.mode === "managed-content" && kinds.every(kind => consent.contentKinds.includes(kind));
}

function keyKinds(table: ContentTable): readonly ContentKind[] {
  return table === "skills" ? ["path", "private-skills"] : ["path"];
}

function columnKinds(table: ContentTable, column: string): readonly ContentKind[] {
  if (numericColumns[table].includes(column)) return [];
  // JSON strings are opaque, mixed-content containers, never regex-redacted.
  if (column.endsWith("_json")) return contentKinds;
  if (table === "sessions" && column === "first_prompt") return ["prompt"];
  if (table === "eval_cases" && column === "query") return ["query"];
  if (column === "cwd") return ["path"];
  if (column === "uri" || column === "skill_uri" || column === "expected_uri") {
    return ["path", "private-skills"];
  }
  if (table === "skills") return ["private-skills"];
  // Labels, source IDs, digests and free text have no narrower proven category.
  return contentKinds;
}

function authorizeRows(consent: Consent, scope: UploadScope): void {
  // Callers cannot obtain additional categories by omitting them from scope.
  authorizeUpload(consent, scope);
}

function checkTimes(row: ContentRow, scope: UploadScope): void {
  for (const column of numericColumns[row.table]) {
    if (nonTimeColumns.has(column)) continue;
    const value = row.values?.[column];
    if (typeof value === "number" && (value < scope.fromMs || value >= scope.toMs)) {
      throw new ActivityContractError("range_not_allowed");
    }
  }
}

function allowsColumn(consent: Consent, scope: UploadScope, table: ContentTable, column: string): boolean {
  const kinds = columnKinds(table, column);
  return kinds.length === 0 || (granted(consent, kinds) && kinds.every(kind => scope.contentKinds.includes(kind)));
}

function allowsKey(consent: Consent, scope: UploadScope, table: ContentTable): boolean {
  const kinds = keyKinds(table);
  return granted(consent, kinds) && kinds.every(kind => scope.contentKinds.includes(kind));
}

/**
 * Resolve row project/root membership locally before calling. Local-only exits
 * before touching rows, JSON serialization or hashing; no payload is constructed.
 */
export async function transformContentRows(
  consent: Consent, scope: UploadScope, rows: readonly unknown[],
): Promise<ContentDocument | null> {
  if (consent.mode === "local-only") return null;
  authorizeRows(consent, scope);
  const transformed: ContentRow[] = [];
  for (const input of rows) {
    const local = localRowSchema.parse(input);
    const { beforeValues, ...wire } = local;
    const row = contentRowSchema.parse(wire);
    checkTimes(row, scope);
    // Delete before-images provide local range evidence, never wire data.
    if (beforeValues !== undefined && beforeValues !== null) {
      checkTimes(contentRowSchema.parse({ ...wire, operation: "upsert", values: beforeValues }), scope);
    }
    const key = allowsKey(consent, scope, row.table) ? row.key :
      await hashContent(encoder.encode(`${row.table}\0${row.key}`));
    const values = row.values === null ? null : Object.fromEntries(
      Object.entries(row.values).filter(([column]) => allowsColumn(consent, scope, row.table, column)),
    );
    transformed.push({ ...row, key, values });
  }
  return contentDocumentSchema.parse({ schemaVersion: 2, rows: transformed });
}

/** Server boundary after reassembly: reject, rather than strip, forbidden fields. */
export function parseContentDocument(input: unknown, consent: Consent, scope: UploadScope): ContentDocument {
  authorizeRows(consent, scope);
  const document = contentDocumentSchema.parse(input);
  for (const row of document.rows) {
    checkTimes(row, scope);
    if (!allowsKey(consent, scope, row.table) && !plaintextHashSchema.safeParse(row.key).success) {
      throw new ActivityContractError("content_not_allowed");
    }
    if (Object.keys(row.values ?? {}).some(column => !allowsColumn(consent, scope, row.table, column))) {
      throw new ActivityContractError("content_not_allowed");
    }
  }
  return document;
}

/**
 * Reassemble in manifest order, verify immutable references and whole plaintext,
 * decode UTF-8 strictly, then apply the same selected-kind server policy.
 */
export async function verifyContentBatch(
  input: unknown, uploads: readonly unknown[], consent: Consent,
): Promise<ContentDocument> {
  const batch = parseContentBatch(input);
  const scope: UploadScope = {
    deviceId: batch.deviceId, projectId: batch.projectId, rootId: batch.rootId,
    consentVersion: batch.consentVersion, fromMs: batch.range.fromMs, toMs: batch.range.toMs,
    backfill: batch.backfill, contentKinds: consent.mode === "managed-content" ? consent.contentKinds : [],
  };
  authorizeRows(consent, scope);
  if (uploads.length !== batch.chunks.length) throw new ContentContractError("content_integrity");
  const plaintext = new Uint8Array(batch.totalBytes);
  let offset = 0;
  for (const [index, upload] of uploads.entries()) {
    const chunk = parseContentChunkUpload(upload);
    const ref = batch.chunks[index];
    if (ref === undefined ||
        Object.keys(identity).some(key => Reflect.get(chunk, key) !== Reflect.get(batch, key) &&
          JSON.stringify(Reflect.get(chunk, key)) !== JSON.stringify(Reflect.get(batch, key))) ||
        chunk.index !== ref.index || chunk.revision !== ref.revision ||
        chunk.plaintextHash !== ref.plaintextHash || chunk.bytes !== ref.bytes) {
      throw new ContentContractError("content_integrity");
    }
    const bytes = await verifyContentChunkUpload(chunk);
    plaintext.set(bytes, offset);
    offset += bytes.byteLength;
  }
  if (await hashContent(plaintext) !== batch.contentHash) throw new ContentContractError("content_integrity");
  const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  return parseContentDocument(json, consent, scope);
}
