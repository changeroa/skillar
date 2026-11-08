import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "../store/db.js";
import { authorizeUpload, consentSchema, uploadScopeSchema } from "./consent.js";
import type { OutboxBatch } from "./outbox.js";
import { SyncError } from "./tables.js";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const streamSchema = z.object({
  source_domain: z.string(), device_id: z.string(), next_sequence: counter,
  ack_sequence: counter, ack_cut: counter,
});
const quotaSchema = z.object({
  maxBatches: z.number().int().positive().default(1024),
  maxBytes: z.number().int().positive().default(64 * 1024 * 1024),
});

/**
 * Only a verified baseline/status receipt may initialize a new live cursor.
 * Existing local pending bytes are never overwritten by a server status read.
 */
export function initializeQueue(
  db: Db, input: {
    readonly streamId: string; readonly deviceId: string;
    readonly sourceDomain: string;
    readonly sequence: number; readonly cut: number;
  },
): void {
  const sequence = counter.parse(input.sequence), cut = counter.parse(input.cut);
  const sourceDomain = z.string().min(1).max(512).parse(input.sourceDomain);
  const streamId = z.string().min(1).max(512).parse(input.streamId);
  const deviceId = z.string().min(1).max(512).parse(input.deviceId);
  db.prepare(`INSERT INTO sync_streams
    (stream_id,source_domain,device_id,next_sequence,ack_sequence,ack_cut)
    VALUES (?,?,?,?,?,?) ON CONFLICT(stream_id) DO NOTHING`)
    .run(streamId, sourceDomain, deviceId, counter.parse(sequence + 1), sequence, cut);
  const saved = streamSchema.parse(db.prepare("SELECT * FROM sync_streams WHERE stream_id=?").get(streamId));
  if (saved.source_domain !== sourceDomain || saved.device_id !== deviceId ||
      saved.ack_sequence !== sequence || saved.ack_cut !== cut) {
    throw new SyncError("invalid_stream");
  }
}

/**
 * P6 reuses P4's immutable spool/ACK tables for already-consent-transformed
 * request manifests. Raw blobs and references share this physical spool DB.
 * build must be synchronous and perform no I/O; it receives the allocated seq.
 */
export function spoolRequest(
  db: Db, input: {
    readonly streamId: string; readonly batchId: string;
    readonly sourceDomain: string;
    readonly consent: unknown; readonly scope: unknown;
    readonly journal: { readonly from: number; readonly through: number };
    readonly build: (sequence: number) => unknown;
    readonly blobHashes?: readonly string[];
    readonly assertLease?: () => void;
    readonly storedBlobBytes?: () => number;
    readonly quota?: { readonly maxBatches: number; readonly maxBytes: number };
  },
): OutboxBatch | null {
  const consent = consentSchema.parse(input.consent);
  if (consent.mode === "local-only") return null;
  if (consent.mode !== "managed-content") throw new SyncError("content_not_allowed");
  const scope = uploadScopeSchema.parse(input.scope);
  authorizeUpload(consent, scope);
  const streamId = z.string().min(1).max(512).parse(input.streamId);
  const batchId = z.string().min(1).max(512).parse(input.batchId);
  const journal = z.object({ from: counter, through: counter })
    .refine(value => value.through >= value.from).parse(input.journal);
  const quota = quotaSchema.parse(input.quota ?? {});
  const sourceDomain = z.string().min(1).max(512).parse(input.sourceDomain);
  db.exec("BEGIN IMMEDIATE");
  try {
    input.assertLease?.();
    db.prepare(`INSERT INTO sync_streams(stream_id,source_domain,device_id)
      VALUES (?,?,?) ON CONFLICT(stream_id) DO NOTHING`)
      .run(streamId, sourceDomain, scope.deviceId);
    const stream = streamSchema.parse(db.prepare("SELECT * FROM sync_streams WHERE stream_id=?").get(streamId));
    if (stream.source_domain !== sourceDomain || stream.device_id !== scope.deviceId) {
      throw new SyncError("invalid_stream");
    }
    const tail = z.object({ through: counter }).parse(db.prepare(`SELECT COALESCE(
      (SELECT journal_through FROM sync_outbox WHERE stream_id=?
      ORDER BY sequence DESC LIMIT 1),?) AS through`).get(streamId, stream.ack_cut));
    if (journal.from !== tail.through) throw new SyncError("invalid_cut");
    const sequence = counter.parse(stream.next_sequence);
    const payload = JSON.stringify(input.build(sequence));
    if (payload === undefined) throw new SyncError("invalid_stream");
    const bytes = Buffer.byteLength(payload);
    if (bytes > 256 * 1024) throw new SyncError("record_too_large");
    const used = z.object({ count: counter, bytes: counter }).parse(db.prepare(`SELECT
      count(*) AS count,COALESCE(sum(payload_bytes),0) AS bytes FROM sync_outbox`).get());
    const blobBytes = counter.parse(input.storedBlobBytes?.() ?? 0);
    if (used.count >= quota.maxBatches || used.bytes + blobBytes + bytes > quota.maxBytes) {
      throw new SyncError("outbox_full");
    }
    const batch: OutboxBatch = {
      stream_id: streamId, sequence, batch_id: batchId, payload,
      payload_hash: createHash("sha256").update(payload).digest("hex"), payload_bytes: bytes,
      journal_from: journal.from, journal_through: journal.through,
    };
    db.prepare(`INSERT INTO sync_outbox
      (stream_id,sequence,batch_id,payload,payload_hash,payload_bytes,journal_from,journal_through)
      VALUES (?,?,?,?,?,?,?,?)`).run(streamId, sequence, batchId, payload,
      batch.payload_hash, bytes, journal.from, journal.through);
    db.prepare("UPDATE sync_streams SET next_sequence=? WHERE stream_id=?")
      .run(counter.parse(sequence + 1), streamId);
    if (input.blobHashes !== undefined) {
      const pin = db.prepare("INSERT INTO sync_outbox_blobs VALUES(?,?,?)");
      for (const hash of new Set(input.blobHashes)) {
        pin.run(streamId, sequence, z.string().regex(/^[a-f0-9]{64}$/).parse(hash));
      }
    }
    db.exec("COMMIT");
    return batch;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
