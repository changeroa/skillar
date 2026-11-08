import { z } from "zod";
import { sourceDomainSchema, timestampSchema } from "../../../shared/activity-schema.ts";
import { runtimeCommitSchema } from "../../../shared/activity-runtime.ts";
import type { RuntimeCommit } from "../../../shared/activity-runtime.ts";
import { storedChunkSchema } from "./content-db.ts";
import type { StoredChunk } from "./content-db.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";

export class RuntimeError extends Error {
  constructor(readonly code: "runtime_source_cut" | "runtime_missing" | "runtime_content_missing",
    readonly status: 409 = 409) {
    super(code);
    this.name = "RuntimeError";
  }
}
export const runtimeRowSchema = z.object({
  sequence: z.number().int().positive(), source_sequence: z.number().int().nonnegative(),
  source_cut: z.number().int().nonnegative(), captured_at_ms: timestampSchema,
  received_at_ms: timestampSchema,
  payload_hash: z.string(), content_hash: z.string(), commit_json: z.string(), chunks_json: z.string(),
});
export type RuntimeRow = z.infer<typeof runtimeRowSchema>;
export function runtimeMetadata(row: RuntimeRow) {
  return { sequence: row.sequence, sourceSequence: row.source_sequence,
    sourceCut: row.source_cut, capturedAtMs: row.captured_at_ms, receivedAtMs: row.received_at_ms };
}
export function runtimeCommit(row: RuntimeRow): RuntimeCommit {
  return runtimeCommitSchema.parse(JSON.parse(row.commit_json));
}
export function runtimeChunks(row: RuntimeRow): StoredChunk[] {
  return z.array(storedChunkSchema).parse(JSON.parse(row.chunks_json));
}
export async function findRuntime(
  db: D1Database, principal: IngestPrincipal, sourceDomain: string, sequence?: number,
): Promise<RuntimeRow | null> {
  const source = sourceDomainSchema.parse(sourceDomain);
  if (sequence !== undefined) z.number().int().positive().safe().parse(sequence);
  const result = await db.prepare(`SELECT * FROM runtime_contexts
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
      AND (? IS NULL OR sequence=?) ORDER BY sequence DESC LIMIT 1`)
    .bind(principal.accountId, principal.generation, principal.deviceId, source,
      sequence ?? null, sequence ?? null).first();
  return result === null ? null : runtimeRowSchema.parse(result);
}
export async function saveRuntime(
  db: D1Database, principal: IngestPrincipal, commit: RuntimeCommit,
  payloadHash: string, chunks: readonly StoredChunk[], receivedAtMs = Date.now(),
): Promise<void> {
  const identity = [principal.accountId, principal.generation, principal.deviceId, commit.sourceDomain];
  const source = await db.prepare(`SELECT sequence FROM device_streams
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND journal_through=?
    UNION ALL SELECT sequence FROM ingest_receipts
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
      AND state='projected' AND projected_through=?
    UNION ALL SELECT 0 AS sequence FROM migration_runs
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
      AND state='complete' AND purpose='initial' AND cut=? LIMIT 1`)
    .bind(...identity, commit.sourceCut, ...identity, commit.sourceCut, ...identity, commit.sourceCut).first();
  if (source === null) throw new RuntimeError("runtime_source_cut");
  const sourceSequence = z.object({ sequence: z.number().int().nonnegative() }).parse(source).sequence;
  try {
    await db.prepare(`INSERT INTO runtime_contexts
      (account_id,generation,device_id,source_domain,sequence,batch_id,payload_hash,content_hash,
        source_sequence,source_cut,captured_at_ms,received_at_ms,commit_json,chunks_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(account_id,generation,device_id,source_domain,sequence) DO NOTHING`)
      .bind(...identity, commit.sequence, commit.batchId, payloadHash, commit.contentHash,
        sourceSequence, commit.sourceCut, commit.capturedAtMs, receivedAtMs, JSON.stringify(commit),
        JSON.stringify(chunks)).run();
  } catch (error) {
    if (error instanceof Error) {
      for (const code of ["tenant_fenced", "batch_conflict", "sequence_gap"] as const) {
        if (error.message.includes(code)) throw new ActivityLedgerError(code);
      }
      for (const code of ["runtime_source_cut", "runtime_content_missing"] as const) {
        if (error.message.includes(code)) throw new RuntimeError(code);
      }
    }
    throw error;
  }
}
