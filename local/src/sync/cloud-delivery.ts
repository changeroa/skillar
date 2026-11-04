import { z } from "zod";
import { CloudSyncError } from "./cloud-blobs.js";
import type { CloudBlobs } from "./cloud-blobs.js";
import type { BlobReference } from "./cloud-documents.js";
import { sha256 } from "./cloud-documents.js";
import { CloudRequestError } from "./cloud-http.js";
import type { CloudHttp } from "./cloud-http.js";
import { requireJob } from "./cloud-jobs.js";
import {
  contentChunkRefSchema, migrationPageSchema, migrationStatusSchema,
  parseContentBatch, parseContentChunkUpload,
} from "./cloud-wire.js";
import type { OutboxBatch } from "./outbox.js";

export const receiptSchema = z.strictObject({
  batchId: z.string(), payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  sequence: z.number().int().positive(), durableAt: z.number().int(),
  projectedThrough: z.number().int().nonnegative(), changeSeq: z.number().int().positive(),
  state: z.literal("projected"),
});
async function request(blobs: CloudBlobs, http: CloudHttp, path: string, body: string) {
  blobs.renew();
  const value = await http.request(path, { body });
  blobs.renew();
  return value;
}
async function upload(
  blobs: CloudBlobs, http: CloudHttp, refs: readonly BlobReference[],
  expected: readonly z.infer<typeof contentChunkRefSchema>[],
) {
  if (refs.length !== expected.length) throw new CloudSyncError("spool_blob_corrupt");
  for (const [index, reference] of refs.entries()) {
    const bytes = blobs.get(reference.hash);
    if (bytes.byteLength !== reference.bytes) throw new CloudSyncError("spool_blob_corrupt");
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const chunk = parseContentChunkUpload(JSON.parse(body));
    const declared = contentChunkRefSchema.parse({
      index: chunk.index, revision: chunk.revision,
      plaintextHash: chunk.plaintextHash, bytes: chunk.bytes,
    });
    // The strict reference parser rejects extra chunk fields; select only the
    // machine-consumed identity before comparing the server's durable chunk ACK.
    const wanted = expected[index];
    const ack = z.strictObject({ stored: z.literal(true), chunk: contentChunkRefSchema })
      .parse(await request(blobs, http, "/v1/activity/chunks", body));
    if (wanted === undefined || JSON.stringify(ack.chunk) !== JSON.stringify(wanted) ||
        declared.index !== wanted.index || declared.plaintextHash !== wanted.plaintextHash ||
        declared.bytes !== wanted.bytes || declared.revision !== wanted.revision) {
      throw new CloudSyncError("invalid_remote_receipt");
    }
  }
}

/** A bounded unit of work; an accepted snapshot is never inferred from a page ACK. */
export async function deliverCloudJob(blobs: CloudBlobs, http: CloudHttp, batch: OutboxBatch) {
  const job = requireJob(batch.payload);
  switch (job.kind) {
    case "cdc": {
      const body = parseContentBatch(JSON.parse(job.body));
      if (body.sequence !== batch.sequence || body.batchId !== batch.batch_id ||
          body.journal.from !== batch.journal_from || body.journal.through !== batch.journal_through ||
          sha256(JSON.stringify(body)) !== job.payloadHash) throw new CloudSyncError("invalid_spool_job");
      try {
        await upload(blobs, http, job.refs, body.chunks);
      } catch (error) {
        // Expired chunks can belong to an accepted batch whose ACK was lost.
        // Only the exact receipt below can acknowledge it; otherwise stay pending.
        if (!(error instanceof CloudRequestError && error.status === 409 && error.code === "content_expired")) {
          throw error;
        }
      }
      const receipt = receiptSchema.parse(await request(blobs, http, "/v1/activity/batches", job.body));
      if (receipt.batchId !== body.batchId || receipt.sequence !== body.sequence ||
          receipt.payloadHash !== job.payloadHash || receipt.projectedThrough !== body.journal.through) {
        throw new CloudSyncError("invalid_remote_receipt");
      }
      return { accepted: true, kind: "cdc", excluded: job.excluded, receipt } as const;
    }
    case "migration": {
      const status = migrationStatusSchema.parse(await request(blobs, http,
        "/v1/activity/migrations/begin", JSON.stringify(job.begin)));
      if (JSON.stringify(status.migration) !== JSON.stringify(job.begin)) {
        throw new CloudSyncError("invalid_remote_receipt");
      }
      if (status.state === "abandoned") throw new CloudSyncError("migration_closed");
      const reference = {
        deviceId: job.begin.deviceId, generation: job.begin.generation,
        sourceDomain: job.begin.sourceDomain, snapshotId: job.begin.snapshotId,
      };
      const staged = new Map(status.stagedPages.map(page => [page.index, page]));
      for (const page of job.pages) {
        const previous = staged.get(page.page.index);
        if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(page.page)) {
          throw new CloudSyncError("invalid_remote_receipt");
        }
      }
      const next = job.pages.find(page => !staged.has(page.page.index));
      if (next !== undefined) {
        await upload(blobs, http, next.refs, next.page.chunks);
        const saved = z.strictObject({ staged: z.literal(true), page: migrationPageSchema })
          .parse(await request(blobs, http, "/v1/activity/migrations/page", JSON.stringify(next.page)));
        if (JSON.stringify(saved.page) !== JSON.stringify(next.page)) {
          throw new CloudSyncError("invalid_remote_receipt");
        }
        return { accepted: false, kind: "migration", excluded: job.excluded,
          stagedPages: staged.size + 1, totalPages: job.pages.length } as const;
      }
      const completed = status.accepted ? status : migrationStatusSchema.parse(await request(
        blobs, http, "/v1/activity/migrations/complete", JSON.stringify(reference)));
      if (!completed.accepted || JSON.stringify(completed.migration) !== JSON.stringify(job.begin) ||
          (job.begin.purpose === "initial" &&
            (completed.cursor.sequence !== 0 || completed.cursor.journalThrough !== job.begin.cut))) {
        throw new CloudSyncError("invalid_remote_receipt");
      }
      return { accepted: true, kind: "migration", excluded: job.excluded,
        status: completed } as const;
    }
    default: {
      const exhaustive: never = job;
      return exhaustive;
    }
  }
}
