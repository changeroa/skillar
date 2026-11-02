import { z } from "zod";
import {
  contentChunkRefSchema, contentDocumentSchema, contentRowSchema, contentTables, hashContent,
  plaintextHashSchema, MAX_CONTENT_BYTES,
} from "./activity-content.js";
import type { ContentDocument, ContentRow } from "./activity-content.js";
import { activityBatchSchema, revisionSchema } from "./activity-schema.js";

/** P6 is a full, explicitly consented baseline, not an ordinary CDC batch. */
export const MAX_SNAPSHOT_PAGES = 128;
export const MAX_SNAPSHOT_ROWS = 10000;
export const MAX_SNAPSHOT_BYTES = MAX_CONTENT_BYTES;
export const MAX_SNAPSHOT_CHUNKS = 128;
export const MAX_SNAPSHOT_PAGE_BYTES = MAX_CONTENT_BYTES;
export const MAX_SNAPSHOT_PAGE_ROWS = 100;
const id = z.string().min(1).max(512).refine(value => !value.includes("\0"));
const identity = activityBatchSchema.unwrap().pick({
  deviceId: true, sourceDomain: true, generation: true,
}).shape;
export const migrationReferenceSchema = z.strictObject({
  ...identity, snapshotId: id,
}).readonly();
export type MigrationReference = z.infer<typeof migrationReferenceSchema>;
export const snapshotCountsSchema = z.record(z.enum(contentTables), revisionSchema);
export type SnapshotCounts = z.infer<typeof snapshotCountsSchema>;
export const migrationBeginSchema = z.strictObject({
  ...migrationReferenceSchema.unwrap().shape,
  schemaVersion: z.literal(1),
  purpose: z.enum(["initial", "backfill"]).default("initial"),
  ...activityBatchSchema.unwrap().pick({
    consentVersion: true, projectId: true, rootId: true, range: true,
  }).shape,
  backfill: activityBatchSchema.unwrap().shape.backfill,
  cut: revisionSchema,
  pageCount: z.number().int().min(1).max(MAX_SNAPSHOT_PAGES),
  counts: snapshotCountsSchema,
  snapshotHash: plaintextHashSchema,
}).superRefine((value, ctx) => {
  if (value.backfill !== null &&
      (value.backfill.snapshotId !== value.snapshotId || value.backfill.journalCut !== value.cut)) {
    ctx.addIssue({ code: "custom", message: "backfill must identify this snapshot and cut" });
  }
  if (value.backfill === null && (value.purpose !== "initial" ||
      Object.values(value.counts).some(count => count !== 0))) {
    ctx.addIssue({ code: "custom", message: "live-only baseline must contain no historical rows" });
  }
  if (Object.values(value.counts).reduce((a, b) => a + b, 0) > MAX_SNAPSHOT_ROWS) {
    ctx.addIssue({ code: "custom", message: "snapshot exceeds row limit" });
  }
}).readonly();
export type MigrationBegin = z.infer<typeof migrationBeginSchema>;
export const migrationPageSchema = z.strictObject({
  ...migrationReferenceSchema.unwrap().shape,
  index: z.number().int().min(0).max(MAX_SNAPSHOT_PAGES - 1),
  batchId: id,
  chunks: z.array(contentChunkRefSchema).min(1).max(128).readonly(),
  contentHash: plaintextHashSchema,
  totalBytes: z.number().int().positive().max(MAX_SNAPSHOT_PAGE_BYTES),
  counts: snapshotCountsSchema,
}).superRefine((value, ctx) => {
  if (value.chunks.some((part, index) => part.index !== index) ||
      value.chunks.reduce((sum, part) => sum + part.bytes, 0) !== value.totalBytes) {
    ctx.addIssue({ code: "custom", message: "invalid contiguous chunk lengths" });
  }
}).readonly();
export type MigrationPage = z.infer<typeof migrationPageSchema>;
const statusFields = {
  migration: migrationBeginSchema, rollbackRequested: z.boolean(),
  stagedPages: z.array(migrationPageSchema).max(MAX_SNAPSHOT_PAGES).readonly(),
};
export const migrationStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...statusFields, state: z.literal("staging"), accepted: z.literal(false), cursor: z.null() }),
  z.strictObject({ ...statusFields, state: z.literal("abandoned"), accepted: z.literal(false), cursor: z.null() }),
  z.strictObject({
    ...statusFields, state: z.literal("complete"), accepted: z.literal(true),
    cursor: z.strictObject({
      sequence: revisionSchema, journalThrough: revisionSchema, changeSeq: revisionSchema.min(1),
    }).readonly(),
  }),
]).readonly();
export type MigrationStatus = z.infer<typeof migrationStatusSchema>;
export type MigrationPageResult = { readonly staged: true; readonly page: MigrationPage };
export type MigrationExport = MigrationStatus & { readonly document: ContentDocument | null };
export const snapshotPageDocumentSchema = z.strictObject({
  schemaVersion: contentDocumentSchema.unwrap().shape.schemaVersion,
  rows: z.array(contentRowSchema)
    .max(MAX_SNAPSHOT_PAGE_ROWS).readonly(),
}).refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= MAX_SNAPSHOT_PAGE_BYTES,
  "snapshot page exceeds byte limit").readonly();

export class MigrationContractError extends Error {
  readonly status = 409;
  constructor(readonly code: "snapshot_integrity" | "snapshot_limit") {
    super(code);
    this.name = "MigrationContractError";
  }
}

/** Sort object property names only; opaque JSON strings and numeric values are untouched. */
export function canonicalSnapshotRow(row: ContentRow): string {
  return JSON.stringify({
    table: row.table, key: row.key, revision: row.revision, operation: row.operation,
    sourceOrder: row.sourceOrder,
    values: row.values === null ? null : Object.fromEntries(
      Object.entries(row.values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    ),
  });
}

/**
 * Whole hash = SHA256 of a JSON array of canonical rows, ordered by contentTables
 * index then UTF-16 key order. Page boundaries do not affect it. Source keys,
 * revisions, sourceOrder, opaque strings and NULL boundaries all participate.
 */
export async function summarizeSnapshot(rows: readonly ContentRow[]): Promise<{
  readonly counts: SnapshotCounts; readonly snapshotHash: string; readonly bytes: number;
}> {
  if (rows.length > MAX_SNAPSHOT_ROWS) throw new MigrationContractError("snapshot_limit");
  const counts: SnapshotCounts = snapshotCountsSchema.parse(
    Object.fromEntries(contentTables.map(table => [table, 0])),
  );
  const ordered = [...rows].sort((a, b) => contentTables.indexOf(a.table) - contentTables.indexOf(b.table)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let previous: ContentRow | undefined;
  for (const row of ordered) {
    if (previous?.table === row.table && previous.key === row.key) {
      throw new MigrationContractError("snapshot_integrity");
    }
    counts[row.table]++;
    previous = row;
  }
  const bytes = new TextEncoder().encode(`[${ordered.map(canonicalSnapshotRow).join(",")}]`);
  if (bytes.length > MAX_SNAPSHOT_BYTES) throw new MigrationContractError("snapshot_limit");
  return { counts, snapshotHash: await hashContent(bytes), bytes: bytes.length };
}
