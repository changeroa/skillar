import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../store/db.js";
import { mutationSchema, SyncError, targetTables } from "./tables.js";
import type { Mutation } from "./tables.js";

export type ChunkLimits = { readonly maxRecords?: number; readonly maxBytes?: number };
export function chunkLimits(limits: ChunkLimits = {}) {
  const parsed = z.strictObject({
    maxRecords: z.number().int().min(1).max(100).default(100),
    maxBytes: z.number().int().min(1).max(256 * 1024).default(256 * 1024),
  }).safeParse(limits);
  if (!parsed.success) throw new SyncError("invalid_limits");
  return parsed.data;
}

export type SnapshotChunk = {
  readonly snapshotId: string; readonly sourceDomain: string; readonly cut: number;
  readonly index: number; readonly records: readonly Mutation[];
  readonly bytes: number; readonly hash: string;
};

/**
 * A dedicated reader is required. The generator owns its read transaction until
 * exhaustion/return(), including pauses between chunks. Its first SELECT pins
 * BOTH the journal cut and source rows to the same WAL snapshot.
 */
export function* logicalSnapshot(db: Db, options: ChunkLimits & {
  readonly maxDurationMs?: number;
} = {}): Generator<SnapshotChunk> {
  if (db.isTransaction) throw new SyncError("transaction_active");
  const limits = chunkLimits({
    maxRecords: options.maxRecords, maxBytes: options.maxBytes,
  });
  const maxDuration = z.number().positive().finite().parse(options.maxDurationMs ?? 30_000);
  const deadline = performance.now() + maxDuration;
  const snapshotId = randomUUID();
  db.exec("BEGIN");
  try {
    // journalHead cannot run inside transactions; this query is deliberately the
    // first read, rather than using the pre-transaction head.
    const pinned = z.object({ cut: z.number().int(), source_domain: z.string() }).parse(
      db.prepare(`SELECT source_domain, COALESCE((SELECT MAX(seq) FROM sync_journal),0) AS cut
        FROM sync_identity`).get());
    let index = 0;
    let records: Mutation[] = [];
    const chunk = (): SnapshotChunk => {
      const payload = JSON.stringify(records);
      return { snapshotId, sourceDomain: pinned.source_domain, cut: pinned.cut,
        index: index++, records, bytes: Buffer.byteLength(payload),
        hash: createHash("sha256").update(payload).digest("hex") };
    };
    for (const table of targetTables) {
      const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map(row =>
        z.object({ name: z.string(), pk: z.number() }).parse(row));
      const keys = columns.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk);
      const withoutRowid = table === "load_candidates";
      const key = `json_array(${keys.map(c => `"${c.name}"`).join(",")})`;
      const values = `json_object(${columns.map(c => `'${c.name}',"${c.name}"`).join(",")})`;
      const query = db.prepare(`SELECT ${key} AS entity_key, ${values} AS row_json,
        ${withoutRowid ? "NULL" : "rowid"} AS source_order FROM "${table}"
        ORDER BY ${withoutRowid ? keys.map(c => `"${c.name}"`).join(",") : "rowid"}`);
      for (const raw of query.iterate()) {
        if (performance.now() > deadline) throw new SyncError("snapshot_expired");
        const row = z.object({
          entity_key: z.string(), row_json: z.string(), source_order: z.number().nullable(),
        }).parse(raw);
        const record = mutationSchema.parse({ table, key: row.entity_key, revision: pinned.cut,
          operation: "upsert", sourceOrder: row.source_order, values: JSON.parse(row.row_json) });
        if (Buffer.byteLength(JSON.stringify([record])) > limits.maxBytes) {
          throw new SyncError("record_too_large");
        }
        if (records.length === limits.maxRecords ||
            Buffer.byteLength(JSON.stringify([...records, record])) > limits.maxBytes) {
          yield chunk();
          records = [];
        }
        records.push(record);
      }
    }
    if (records.length > 0) yield chunk();
    // Empty snapshots still communicate their verified cut and hash.
    else if (index === 0) yield chunk();
  } finally {
    db.exec("ROLLBACK");
  }
}
