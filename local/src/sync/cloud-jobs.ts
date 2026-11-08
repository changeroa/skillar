import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CloudSyncError } from "./cloud-blobs.js";
import type { CloudBlobs } from "./cloud-blobs.js";
import {
  blobReferenceSchema, sha256, snapshotDocuments, spoolDocumentChunks,
} from "./cloud-documents.js";
import {
  migrationBeginSchema, migrationPageSchema, parseContentBatch, summarizeSnapshot,
} from "./cloud-wire.js";
import type { Consent, ContentRow, MigrationBegin, UploadScope } from "./cloud-wire.js";

export const migrationJobSchema = z.strictObject({
  kind: z.literal("migration"), begin: migrationBeginSchema,
  pages: z.array(z.strictObject({
    page: migrationPageSchema, refs: z.array(blobReferenceSchema).min(1).max(128),
  })).min(1).max(128),
  excluded: z.number().int().nonnegative(),
});
export const cdcJobSchema = z.strictObject({
  kind: z.literal("cdc"), refs: z.array(blobReferenceSchema).min(1).max(128),
  body: z.string().max(256 * 1024), payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  excluded: z.number().int().nonnegative(),
});
export const cloudJobSchema = z.discriminatedUnion("kind", [migrationJobSchema, cdcJobSchema]);
export type CloudJob = z.infer<typeof cloudJobSchema>;

export function liveStream(instanceId: string, sourceDomain: string): string {
  return `cloud-live:${instanceId}:${sourceDomain}`;
}

export async function stageMigrationJob(
  blobs: CloudBlobs, input: {
    readonly streamId: string; readonly reference: {
      readonly deviceId: string; readonly sourceDomain: string; readonly generation: number;
      readonly snapshotId: string; readonly cut: number; readonly purpose: "initial" | "backfill";
    };
    readonly consent: Consent; readonly scope: UploadScope;
    readonly rows: readonly ContentRow[]; readonly excluded: number;
  },
) {
  const reference = input.reference;
  const documents = snapshotDocuments(input.rows);
  const summary = await summarizeSnapshot(input.rows);
  const begin: MigrationBegin = migrationBeginSchema.parse({
    ...reference, schemaVersion: 1, consentVersion: input.scope.consentVersion,
    projectId: input.scope.projectId, rootId: input.scope.rootId,
    range: { fromMs: input.scope.fromMs, toMs: input.scope.toMs },
    backfill: input.scope.backfill, pageCount: documents.length,
    counts: summary.counts, snapshotHash: summary.snapshotHash,
  });
  const pages: z.infer<typeof migrationJobSchema>["pages"] = [];
  for (const [index, document] of documents.entries()) {
    const batchId = `${reference.snapshotId}:page:${index}`;
    const chunks = spoolDocumentChunks(blobs, document, {
      schemaVersion: 2, batchId, deviceId: reference.deviceId,
      sourceDomain: reference.sourceDomain, generation: reference.generation,
      consentVersion: begin.consentVersion, projectId: begin.projectId, rootId: begin.rootId,
      range: begin.range, backfill: begin.backfill,
    }, reference.cut);
    pages.push({
      page: migrationPageSchema.parse({
        deviceId: reference.deviceId, sourceDomain: reference.sourceDomain,
        generation: reference.generation, snapshotId: reference.snapshotId,
        index, batchId, chunks: chunks.chunks, contentHash: chunks.contentHash,
        totalBytes: chunks.totalBytes, counts: (await summarizeSnapshot(document.rows)).counts,
      }),
      refs: chunks.refs,
    });
  }
  return blobs.enqueue({
    streamId: input.streamId, batchId: reference.snapshotId,
    sourceDomain: reference.sourceDomain,
    consent: input.consent, scope: input.scope,
    journal: { from: 0, through: reference.cut },
    blobHashes: pages.flatMap(page => page.refs.map(ref => ref.hash)),
    build: () => migrationJobSchema.parse({
      kind: "migration", begin, pages, excluded: input.excluded,
    }),
  });
}

export function stageCdcJob(
  blobs: CloudBlobs, input: {
    readonly streamId: string; readonly deviceId: string; readonly sourceDomain: string;
    readonly generation: number; readonly consent: Consent; readonly scope: UploadScope;
    readonly after: number; readonly cut: number;
    readonly rows: readonly ContentRow[]; readonly excluded: number;
  },
) {
  const batchId = randomUUID();
  const common = {
    schemaVersion: 2, batchId, deviceId: input.deviceId,
    sourceDomain: input.sourceDomain, generation: input.generation,
    consentVersion: input.scope.consentVersion, projectId: input.scope.projectId,
    rootId: input.scope.rootId, range: { fromMs: input.scope.fromMs, toMs: input.scope.toMs },
    backfill: input.scope.backfill,
  } as const;
  const chunks = spoolDocumentChunks(blobs, { schemaVersion: 2, rows: input.rows }, common, input.cut);
  return blobs.enqueue({
    streamId: input.streamId, batchId, consent: input.consent, scope: input.scope,
    sourceDomain: input.sourceDomain, blobHashes: chunks.refs.map(ref => ref.hash),
    journal: { from: input.after, through: input.cut },
    build: sequence => {
      const body = JSON.stringify(parseContentBatch({
        ...common, sequence, journal: { from: input.after, through: input.cut },
        metadataMutations: [], chunks: chunks.chunks,
        totalBytes: chunks.totalBytes, contentHash: chunks.contentHash,
      }));
      return cdcJobSchema.parse({
        kind: "cdc", refs: chunks.refs, body, payloadHash: sha256(body), excluded: input.excluded,
      });
    },
  });
}

export function requireJob(value: string): CloudJob {
  const result = cloudJobSchema.safeParse(JSON.parse(value));
  if (!result.success) throw new CloudSyncError("invalid_spool_job");
  return result.data;
}
