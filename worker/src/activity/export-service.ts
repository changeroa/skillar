import { z } from "zod";
import {
  contentChunkRefSchema, parseContentBatch, parseContentDocument,
} from "../../../shared/activity-content.ts";
import type { ContentBatch, ContentDocument } from "../../../shared/activity-content.ts";
import { activityBatchSchema, parseActivityBatch, revisionSchema } from "../../../shared/activity-schema.ts";
import {
  contentScope, readContentScope, requireContentConsent, requireContentReadConsent,
} from "./content-consent.ts";
import { activeFence, contentDigest } from "./content-db.ts";
import type { ContentEnv } from "./content-env.ts";
import { ContentStorageError } from "./content-keys.ts";
import { readBatchContent } from "./content-service.ts";
import { ActivityLedgerError, receiptSchema } from "./types.ts";
import type { IngestPrincipal, IngestReceipt } from "./types.ts";

const requestSchema = activityBatchSchema.unwrap().pick({
  deviceId: true, sourceDomain: true, generation: true, consentVersion: true,
  projectId: true, rootId: true, range: true, backfill: true,
}).extend({
  afterSequence: revisionSchema,
  throughSequence: revisionSchema.optional(),
  limit: z.number().int().min(1).max(4).default(1),
}).readonly();
const cursorSchema = z.object({
  sequence: revisionSchema, journalThrough: revisionSchema,
}).readonly();
const savedSchema = z.object({
  metadata_json: z.string(), manifest_json: z.string().nullable(),
  batchId: z.string(), payloadHash: z.string(), sequence: z.number(),
  durableAt: z.number(), projectedThrough: z.number(), changeSeq: z.number(),
  state: z.literal("projected"),
});
type Cursor = z.infer<typeof cursorSchema>;

/** Read-only, internal-principal CDC export. Never skip a metadata-only receipt. */
export async function exportContent(env: ContentEnv, principal: IngestPrincipal, input: unknown) {
  const request = requestSchema.parse(input);
  if (principal.kind !== "device" || principal.deviceId !== request.deviceId ||
      principal.generation !== request.generation || principal.shardId !== "activity-00" ||
      !principal.scopes.includes("activity:read") || principal.scopes.includes("device:manage")) {
    throw new ActivityLedgerError("forbidden");
  }
  const authorize = async () => {
    await activeFence(env.ACTIVITY, principal);
    await requireContentConsent(env.ACCOUNTS, principal, contentScope(request));
  };
  await authorize();
  const identity = [principal.accountId, principal.generation, principal.deviceId, request.sourceDomain];
  const headRow = await env.ACTIVITY.prepare(`SELECT sequence,journal_through AS journalThrough
    FROM device_streams WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?`)
    .bind(...identity).first();
  const head = headRow === null ? null : cursorSchema.parse(headRow);
  const throughSequence = request.throughSequence ?? head?.sequence ?? 0;
  if (throughSequence > (head?.sequence ?? 0) || request.afterSequence > throughSequence) {
    throw new ActivityLedgerError("sequence_gap");
  }
  // A published baseline has sequence=0 and may have a nonzero journal cut.
  // The first accepted CDC receipt records that cut as inclusive journal_from-1.
  const anchor = await env.ACTIVITY.prepare(`SELECT sequence,journal_through AS journalThrough
    FROM ingest_receipts WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
      AND sequence=? AND state='projected'`).bind(...identity, request.afterSequence).first();
  let cursor: Cursor | null = anchor === null ? null : cursorSchema.parse(anchor);
  if (request.afterSequence > 0 && cursor === null) throw new ActivityLedgerError("sequence_gap");
  if (request.afterSequence === 0 && head !== null) {
    const first = await env.ACTIVITY.prepare(`SELECT journal_from FROM ingest_receipts
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND sequence=1
        AND state='projected'`).bind(...identity).first();
    cursor = { sequence: 0, journalThrough: first === null ? head.journalThrough :
      z.object({ journal_from: revisionSchema.min(1) }).parse(first).journal_from - 1 };
  }
  const start = cursor;
  const rows = await env.ACTIVITY.prepare(`SELECT r.metadata_json,m.manifest_json,
    r.batch_id AS batchId,r.payload_hash AS payloadHash,r.sequence,r.durable_at AS durableAt,
    r.projected_through AS projectedThrough,r.change_seq AS changeSeq,r.state
    FROM ingest_receipts r LEFT JOIN content_manifests m
      ON m.account_id=r.account_id AND m.generation=r.generation AND m.device_id=r.device_id
      AND m.source_domain=r.source_domain AND m.batch_id=r.batch_id AND m.commit_id=r.commit_id
    WHERE r.account_id=? AND r.generation=? AND r.device_id=? AND r.source_domain=?
      AND r.sequence>? AND r.sequence<=? AND r.state='projected'
    ORDER BY r.sequence LIMIT ?`)
    .bind(...identity, request.afterSequence, throughSequence, request.limit).all();
  const batches: { readonly batch: ContentBatch; readonly receipt: IngestReceipt;
    readonly document: ContentDocument }[] = [];
  for (const raw of rows.results) {
    const saved = savedSchema.parse(raw);
    if (saved.sequence !== (cursor?.sequence ?? request.afterSequence) + 1) {
      throw new ActivityLedgerError("sequence_gap");
    }
    if (saved.manifest_json === null) throw new ContentStorageError("content_missing", 409);
    const metadata = parseActivityBatch(JSON.parse(saved.metadata_json), { allowEmptyMetadata: true });
    const manifest = z.object({
      contentHash: z.string(), totalBytes: z.number(),
      chunks: z.array(z.object(contentChunkRefSchema.unwrap().shape)),
    }).parse(JSON.parse(saved.manifest_json));
    const { mutations, ...common } = metadata;
    const batch = parseContentBatch({
      ...common, schemaVersion: 2, journal: { from: metadata.journal.from - 1,
        through: metadata.journal.through }, metadataMutations: mutations, ...manifest,
    });
    const receipt = receiptSchema.parse({
      batchId: saved.batchId, payloadHash: saved.payloadHash, sequence: saved.sequence,
      durableAt: saved.durableAt, projectedThrough: saved.projectedThrough,
      changeSeq: saved.changeSeq, state: saved.state,
    });
    if (batch.batchId !== receipt.batchId || batch.sequence !== receipt.sequence ||
        batch.deviceId !== principal.deviceId || batch.generation !== principal.generation ||
        batch.sourceDomain !== request.sourceDomain ||
        batch.journal.from !== cursor?.journalThrough ||
        batch.journal.through !== receipt.projectedThrough ||
        await contentDigest(new TextEncoder().encode(JSON.stringify(batch))) !== receipt.payloadHash) {
      throw new ContentStorageError("content_conflict", 409);
    }
    const consent = await requireContentReadConsent(env.ACCOUNTS, principal, contentScope(batch));
    const document = parseContentDocument(await readBatchContent(env, principal, batch),
      consent, readContentScope(consent, contentScope(batch, consent.contentKinds)));
    batches.push({ batch, receipt, document });
    cursor = { sequence: batch.sequence, journalThrough: batch.journal.through };
  }
  if ((cursor?.sequence ?? request.afterSequence) < throughSequence && batches.length < request.limit) {
    throw new ActivityLedgerError("sequence_gap");
  }
  // No stale grant may escape after awaited R2 reads, including an empty page.
  for (const { batch, document } of batches) {
    const consent = await requireContentReadConsent(env.ACCOUNTS, principal, contentScope(batch));
    parseContentDocument(document, consent, readContentScope(consent, contentScope(batch, consent.contentKinds)));
  }
  await authorize();
  return {
    schemaVersion: 1, deviceId: request.deviceId, sourceDomain: request.sourceDomain,
    generation: request.generation, afterSequence: request.afterSequence, throughSequence,
    start, cursor, head, hasMore: (cursor?.sequence ?? request.afterSequence) < throughSequence, batches,
  };
}
