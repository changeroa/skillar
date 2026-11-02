import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../store/db.js";
import {
  authorizeUpload, consentSchema, transformMutation, uploadScopeSchema,
} from "./consent.js";
import type { RecordScope } from "./consent.js";
import { journalHead } from "./journal.js";
import { chunkLimits } from "./snapshot.js";
import type { ChunkLimits } from "./snapshot.js";
import { mutationSchema, SyncError } from "./tables.js";
import type { Mutation } from "./tables.js";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const streamSchema = z.object({
  source_domain: z.string(), device_id: z.string(), next_sequence: counter, ack_sequence: counter,
  ack_hash: z.string().nullable(), ack_cut: counter,
});
const storedBatch = z.object({
  stream_id: z.string(), sequence: counter, batch_id: z.string(),
  payload: z.string(), payload_hash: z.string(), payload_bytes: counter,
  journal_from: counter, journal_through: counter,
});
export type OutboxBatch = z.infer<typeof storedBatch>;
export type SpoolRequest = {
  readonly streamId: string;
  readonly consent?: unknown;
  readonly scope: unknown;
  readonly records: readonly Mutation[];
  readonly journal: { readonly from: number; readonly through: number };
  readonly scopeFor: (mutation: Mutation) => RecordScope;
  readonly limits?: ChunkLimits;
  readonly quota?: { readonly maxBatches: number; readonly maxBytes: number };
};

/**
 * No implicit capture-level consent and no background/network work. The caller
 * supplies a bounded page and proven source membership. Only transformed bytes
 * enter the outbox. Any failure rolls back sequence allocation as well.
 */
export function spoolBatch(db: Db, request: SpoolRequest): OutboxBatch | null {
  const consent = consentSchema.parse(request.consent ?? { mode: "local-only" });
  if (consent.mode === "local-only") return null;
  const scope = uploadScopeSchema.parse(request.scope);
  authorizeUpload(consent, scope);
  const limits = chunkLimits(request.limits);
  const records = z.array(mutationSchema).min(1).max(limits.maxRecords).parse(request.records);
  const journal = z.strictObject({ from: counter, through: counter })
    .refine(value => value.through >= value.from).parse(request.journal);
  const streamId = z.string().min(1).max(512).parse(request.streamId);
  const transformed = records.map(record => {
    if (record.operation === "delete" && record.beforeValues === null) {
      throw new SyncError("scope_required");
    }
    const membership = request.scopeFor(record);
    if (membership.projectId !== scope.projectId || membership.rootId !== scope.rootId) {
      throw new SyncError("scope_required");
    }
    if (record.revision < journal.from || record.revision > journal.through) {
      throw new SyncError("invalid_cut");
    }
    return transformMutation(record, scope);
  });
  const quota = z.strictObject({
    maxBatches: z.number().int().positive().default(1024),
    maxBytes: z.number().int().positive().default(64 * 1024 * 1024),
  }).parse(request.quota ?? {});
  const head = journalHead(db);
  if (journal.through > head.cut) throw new SyncError("invalid_cut");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO sync_streams(stream_id,source_domain,device_id) VALUES (?,?,?)
      ON CONFLICT(stream_id) DO NOTHING`).run(streamId, head.sourceDomain, scope.deviceId);
    const stream = streamSchema.parse(db.prepare("SELECT * FROM sync_streams WHERE stream_id=?").get(streamId));
    if (stream.source_domain !== head.sourceDomain || stream.device_id !== scope.deviceId) {
      throw new SyncError("invalid_stream");
    }
    const tail = z.object({ through: counter }).parse(db.prepare(`SELECT
      COALESCE((SELECT journal_through FROM sync_outbox WHERE stream_id=?
        ORDER BY sequence DESC LIMIT 1), ?) AS through`).get(streamId, stream.ack_cut));
    if (journal.from !== tail.through) throw new SyncError("invalid_cut");
    const batchId = randomUUID();
    const payload = JSON.stringify({
      format: "skillar-local-outbox-v1", batchId, sourceDomain: head.sourceDomain,
      sequence: stream.next_sequence, scope, journal, records: transformed,
    });
    const bytes = Buffer.byteLength(payload);
    if (bytes > limits.maxBytes) throw new SyncError("record_too_large");
    const usage = z.object({ batches: counter, bytes: counter }).parse(db.prepare(
      "SELECT COUNT(*) AS batches, COALESCE(SUM(payload_bytes),0) AS bytes FROM sync_outbox").get());
    if (usage.batches >= quota.maxBatches || usage.bytes + bytes > quota.maxBytes) {
      throw new SyncError("outbox_full");
    }
    const batch: OutboxBatch = {
      stream_id: streamId, sequence: stream.next_sequence, batch_id: batchId,
      payload, payload_hash: createHash("sha256").update(payload).digest("hex"),
      payload_bytes: bytes, journal_from: journal.from, journal_through: journal.through,
    };
    db.prepare(`INSERT INTO sync_outbox VALUES (?,?,?,?,?,?,?,?)`).run(
      batch.stream_id, batch.sequence, batch.batch_id, batch.payload, batch.payload_hash,
      batch.payload_bytes, batch.journal_from, batch.journal_through,
    );
    db.prepare("UPDATE sync_streams SET next_sequence=next_sequence+1 WHERE stream_id=?").run(streamId);
    db.exec("COMMIT");
    return batch;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Only the oldest unacknowledged batch is eligible for sending. */
export function pendingBatch(db: Db, streamId: string): OutboxBatch | null {
  if (db.isTransaction) throw new SyncError("transaction_active");
  const row = db.prepare(`SELECT o.* FROM sync_outbox o JOIN sync_streams s USING(stream_id)
    WHERE o.stream_id=? AND o.sequence=s.ack_sequence+1`).get(streamId);
  return row === undefined ? null : storedBatch.parse(row);
}

/** ACK means an externally verified durable receipt; there is no sender in P4. */
export function acknowledgeBatch(db: Db, receipt: {
  readonly streamId: string; readonly sequence: number; readonly payloadHash: string;
}, assertLease?: () => void): void {
  if (db.isTransaction) throw new SyncError("transaction_active");
  db.exec("BEGIN IMMEDIATE");
  try {
    assertLease?.();
    const raw = db.prepare("SELECT * FROM sync_streams WHERE stream_id=?").get(receipt.streamId);
    if (raw === undefined) throw new SyncError("ack_out_of_order");
    const stream = streamSchema.parse(raw);
    if (receipt.sequence === stream.ack_sequence && receipt.payloadHash === stream.ack_hash) {
      db.exec("COMMIT");
      return;
    }
    const rawBatch = db.prepare("SELECT * FROM sync_outbox WHERE stream_id=? AND sequence=?")
      .get(receipt.streamId, receipt.sequence);
    if (receipt.sequence !== stream.ack_sequence + 1 || rawBatch === undefined) {
      throw new SyncError("ack_out_of_order");
    }
    const batch = storedBatch.parse(rawBatch);
    if (batch.payload_hash !== receipt.payloadHash) throw new SyncError("ack_out_of_order");
    db.prepare(`UPDATE sync_streams SET ack_sequence=?,ack_hash=?,ack_cut=? WHERE stream_id=?`)
      .run(receipt.sequence, receipt.payloadHash, batch.journal_through, receipt.streamId);
    db.prepare("DELETE FROM sync_outbox WHERE stream_id=? AND sequence=?")
      .run(receipt.streamId, receipt.sequence);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
