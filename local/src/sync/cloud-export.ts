import { z } from "zod";
import { CloudSyncError } from "./cloud-blobs.js";
import { receiptSchema } from "./cloud-delivery.js";
import { sha256 } from "./cloud-documents.js";
import type { CloudHttp } from "./cloud-http.js";
import {
  contentDocumentSchema, migrationReferenceSchema, migrationStatusSchema,
  parseContentBatch, summarizeSnapshot,
} from "./cloud-wire.js";
import type { ContentRow } from "./cloud-wire.js";

const cursorSchema = z.strictObject({
  sequence: z.number().int().nonnegative(), journalThrough: z.number().int().nonnegative(),
});
export const exportPageSchema = z.strictObject({
  schemaVersion: z.literal(1), deviceId: z.string(), sourceDomain: z.string(),
  generation: z.number().int().positive(), afterSequence: z.number().int().nonnegative(),
  throughSequence: z.number().int().nonnegative(),
  start: cursorSchema.nullable(), cursor: cursorSchema.nullable(), head: cursorSchema.nullable(),
  hasMore: z.boolean(),
  batches: z.array(z.strictObject({
    batch: z.unknown().transform(value => parseContentBatch(value)),
    receipt: receiptSchema, document: contentDocumentSchema,
  })).max(1),
});

function migrationExport(input: unknown) {
  const { document, ...status } = z.record(z.string(), z.unknown()).parse(input);
  return { ...migrationStatusSchema.parse(status), document: contentDocumentSchema.nullable().parse(document) };
}

/** Exact HTTP size/hash and canonical whole-snapshot verification precede restore. */
export async function downloadSnapshot(http: CloudHttp, input: unknown) {
  const reference = migrationReferenceSchema.parse(input);
  const request = (page?: number) => http.request("/v1/activity/migrations/export", {
    body: JSON.stringify({ ...reference, ...(page === undefined ? {} : { page }) }),
    maxResponseBytes: 18 * 1024 * 1024,
  });
  const manifest = migrationExport(await request());
  if (!manifest.accepted || manifest.stagedPages.length !== manifest.migration.pageCount ||
      manifest.migration.counts.recording_clock !== 1) throw new CloudSyncError("full_snapshot_required");
  const rows: ContentRow[] = [];
  for (const [index, page] of manifest.stagedPages.entries()) {
    const exported = migrationExport(await request(index));
    const document = exported.document;
    if (!exported.accepted || document === null || page.index !== index ||
        JSON.stringify(exported.migration) !== JSON.stringify(manifest.migration) ||
        JSON.stringify(exported.stagedPages) !== JSON.stringify(manifest.stagedPages)) {
      throw new CloudSyncError("invalid_remote_receipt");
    }
    const bytes = Buffer.from(JSON.stringify(document)), summary = await summarizeSnapshot(document.rows);
    if (bytes.length !== page.totalBytes || sha256(bytes) !== page.contentHash ||
        JSON.stringify(summary.counts) !== JSON.stringify(page.counts)) {
      throw new CloudSyncError("invalid_remote_receipt");
    }
    rows.push(...document.rows);
  }
  const summary = await summarizeSnapshot(rows);
  if (summary.snapshotHash !== manifest.migration.snapshotHash ||
      JSON.stringify(summary.counts) !== JSON.stringify(manifest.migration.counts)) {
    throw new CloudSyncError("invalid_remote_receipt");
  }
  return { manifest, rows };
}

export function verifyExportBatch(item: z.infer<typeof exportPageSchema>["batches"][number]) {
  const { batch, receipt, document } = item;
  if (batch.batchId !== receipt.batchId || batch.sequence !== receipt.sequence ||
      batch.journal.through !== receipt.projectedThrough ||
      sha256(JSON.stringify(batch)) !== receipt.payloadHash ||
      sha256(JSON.stringify(document)) !== batch.contentHash ||
      Buffer.byteLength(JSON.stringify(document)) !== batch.totalBytes) {
    throw new CloudSyncError("invalid_remote_receipt");
  }
}
