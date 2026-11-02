import { parseActivityBatch, timestampSchema } from "../../../shared/activity-schema.ts";
import { commitGuard, projectMutation } from "./projections.ts";
import { ActivityLedgerError, receiptSchema } from "./types.ts";
import type { IngestPrincipal, IngestReceipt } from "./types.ts";

export async function commitActivityBatch(
  db: D1Database,
  input: { readonly principal: IngestPrincipal; readonly batch: unknown; readonly receivedAtMs: number },
): Promise<IngestReceipt> {
  const batch = parseActivityBatch(input.batch);
  const principal = input.principal;
  if (!principal.scopes.includes("activity:ingest") || principal.scopes.includes("device:manage") ||
      principal.deviceId !== batch.deviceId ||
      principal.generation !== batch.generation || principal.shardId !== "activity-00") {
    throw new ActivityLedgerError("forbidden");
  }
  const receivedAt = timestampSchema.parse(input.receivedAtMs);
  const metadataJson = JSON.stringify(batch);
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(metadataJson),
  ));
  const payloadHash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  const commitId = crypto.randomUUID();
  const stream = {
    accountId: principal.accountId, generation: principal.generation,
    deviceId: principal.deviceId, sourceDomain: batch.sourceDomain, commitId,
  };
  const identity = [stream.accountId, stream.generation, stream.deviceId, stream.sourceDomain];
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO ingest_receipts
      (account_id,generation,device_id,source_domain,batch_id,payload_hash,metadata_json,sequence,
        journal_from,journal_through,commit_id,durable_at,state)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'projecting')
      ON CONFLICT(account_id,generation,device_id,source_domain,batch_id) DO NOTHING`)
      .bind(...identity, batch.batchId, payloadHash, metadataJson, batch.sequence,
        batch.journal.from, batch.journal.through, commitId, receivedAt),
    ...batch.mutations.flatMap(mutation => projectMutation(db, stream, mutation)),
    db.prepare(`INSERT INTO device_streams
      (account_id,generation,device_id,source_domain,sequence,journal_through)
      SELECT ?,?,?,?,?,? WHERE ${commitGuard}
      ON CONFLICT(account_id,generation,device_id,source_domain)
      DO UPDATE SET sequence=excluded.sequence,journal_through=excluded.journal_through`)
      .bind(...identity, batch.sequence, batch.journal.through, commitId),
    db.prepare(`INSERT INTO jobs
      (account_id,generation,device_id,source_domain,batch_id,state,input_revision)
      SELECT ?,?,?,?,?,'pending',? WHERE ${commitGuard}`)
      .bind(...identity, batch.batchId, batch.journal.through, commitId),
    db.prepare(`INSERT INTO dispatch_outbox
      (account_id,generation,device_id,source_domain,batch_id,state)
      SELECT ?,?,?,?,?,'pending' WHERE ${commitGuard}`)
      .bind(...identity, batch.batchId, commitId),
    db.prepare(`INSERT INTO account_heads(account_id,generation,head_seq)
      SELECT ?,?,0 WHERE ${commitGuard}
      ON CONFLICT(account_id,generation) DO NOTHING`)
      .bind(stream.accountId, stream.generation, commitId),
    db.prepare(`UPDATE account_heads SET head_seq=head_seq+1
      WHERE account_id=? AND generation=? AND ${commitGuard}`)
      .bind(stream.accountId, stream.generation, commitId),
    db.prepare(`INSERT INTO account_changes(account_id,generation,seq,invalidation_kind)
      SELECT account_id,generation,head_seq,'activity' FROM account_heads
      WHERE account_id=? AND generation=? AND ${commitGuard}`)
      .bind(stream.accountId, stream.generation, commitId),
    // The final fence runs after projection, receipt, jobs and changes in this SAME transaction.
    db.prepare(`UPDATE ingest_receipts SET state='projected',projected_through=journal_through,
      change_seq=(SELECT head_seq FROM account_heads WHERE account_id=? AND generation=?)
      WHERE commit_id=? AND state='projecting'`)
      .bind(stream.accountId, stream.generation, commitId),
    db.prepare(`SELECT batch_id AS batchId,payload_hash AS payloadHash,sequence,durable_at AS durableAt,
      projected_through AS projectedThrough,change_seq AS changeSeq,state FROM ingest_receipts
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND batch_id=?`)
      .bind(...identity, batch.batchId),
  ];
  try {
    const results = await db.batch(statements);
    return receiptSchema.parse(results.at(-1)?.results[0]);
  } catch (error) {
    if (error instanceof Error) {
      for (const code of ["tenant_fenced", "batch_conflict", "sequence_gap"] as const) {
        if (error.message.includes(code)) throw new ActivityLedgerError(code);
      }
    }
    throw error;
  }
}
