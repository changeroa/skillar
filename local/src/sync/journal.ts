import { z } from "zod";
import type { Db } from "../store/db.js";
import { mutationSchema, SyncError } from "./tables.js";
import type { Mutation } from "./tables.js";

const cutSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const headSchema = z.object({ cut: cutSchema, source_domain: z.string() });

/** Only call outside a source transaction: a cut must never split recursive triggers. */
export function journalHead(db: Db): { readonly cut: number; readonly sourceDomain: string } {
  if (db.isTransaction) throw new SyncError("transaction_active");
  const head = headSchema.parse(db.prepare(`SELECT source_domain,
    COALESCE((SELECT MAX(seq) FROM sync_journal), 0) AS cut FROM sync_identity`).get());
  return { cut: head.cut, sourceDomain: head.source_domain };
}

const journalRow = z.object({
  seq: cutSchema, table_name: z.string(), entity_key: z.string(), operation: z.string(),
  source_order: z.number().int().nullable(), row_json: z.string().nullable(),
  before_json: z.string().nullable(),
});

/**
 * Coalesce only inside a caller's fixed, committed cut. Never re-read live rows.
 * Consumers page by returned revision; through must be a head/snapshot cut, not an
 * arbitrary intermediate trigger seq. Old revisions remain available after deletes.
 */
export function readJournal(db: Db, range: {
  readonly after: number; readonly through: number; readonly limit?: number;
}): readonly Mutation[] {
  const head = journalHead(db);
  const after = cutSchema.parse(range.after);
  const through = cutSchema.parse(range.through);
  const limit = z.number().int().min(1).max(100).parse(range.limit ?? 100);
  if (through < after || through > head.cut) throw new SyncError("invalid_cut");
  return db.prepare(`SELECT j.* FROM sync_journal j
    WHERE j.seq > ? AND j.seq <= ? AND NOT EXISTS (
      SELECT 1 FROM sync_journal n WHERE n.table_name = j.table_name
        AND n.entity_key = j.entity_key AND n.seq > j.seq AND n.seq <= ?)
    ORDER BY j.seq LIMIT ?`).all(after, through, through, limit).map(raw => {
    const row = journalRow.parse(raw);
    return mutationSchema.parse({
      table: row.table_name, key: row.entity_key, revision: row.seq,
      operation: row.operation, sourceOrder: row.source_order,
      values: row.row_json === null ? null : JSON.parse(row.row_json),
      beforeValues: row.before_json === null ? null : JSON.parse(row.before_json),
    });
  });
}
