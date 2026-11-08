import { z } from "zod";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";

export const storedChunkSchema = z.strictObject({
  chunk_index: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  plaintext_hash: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
  scope_hash: z.string().regex(/^[a-f0-9]{64}$/),
  object_key: z.string(), key_version: z.string(),
  state: z.enum(["writing", "stored", "committed", "purging", "purged"]),
}).readonly();
export type StoredChunk = z.infer<typeof storedChunkSchema>;
export type ContentIdentity = {
  readonly deviceId: string; readonly sourceDomain: string;
  readonly generation: number; readonly batchId: string;
};

export function streamIdentity(principal: IngestPrincipal, batch: ContentIdentity) {
  if (!principal.scopes.includes("activity:ingest") ||
      principal.scopes.includes("device:manage") ||
      principal.deviceId !== batch.deviceId || principal.generation !== batch.generation ||
      principal.shardId !== "activity-00") throw new ActivityLedgerError("forbidden");
  return [principal.accountId, principal.generation, principal.deviceId,
    batch.sourceDomain, batch.batchId] as const;
}

export async function activeFence(db: D1Database, principal: IngestPrincipal): Promise<void> {
  const row = await db.prepare(`SELECT 1 FROM tenant_fences
    WHERE account_id=? AND generation=? AND state='active'`)
    .bind(principal.accountId, principal.generation).first();
  if (row === null) throw new ActivityLedgerError("tenant_fenced");
}

export async function contentDigest(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function contentObjectKey(
  principal: IngestPrincipal, batch: ContentIdentity,
  chunk: { readonly index: number; readonly plaintextHash: string },
): Promise<string> {
  const encode = async (value: string) => contentDigest(new TextEncoder().encode(value));
  const [device, source, batchId] = await Promise.all([
    encode(batch.deviceId), encode(batch.sourceDomain), encode(batch.batchId),
  ]);
  return `activity/${encodeURIComponent(principal.accountId)}/${principal.generation}` +
    `/${device}/${source}/${batchId}/${chunk.index}-${chunk.plaintextHash}`;
}

/** Intent survives failed/late PUTs. Never remove it merely because PUT failed. */
export async function recordUploadIntent(
  db: D1Database, principal: IngestPrincipal, batch: ContentIdentity,
  chunk: {
    readonly index: number; readonly revision: number; readonly plaintextHash: string;
    readonly bytes: number; readonly scopeHash: string; readonly objectKey: string;
    readonly keyVersion: string;
  },
): Promise<StoredChunk> {
  const identity = streamIdentity(principal, batch);
  try {
    await db.prepare(`INSERT INTO content_uploads
      (account_id,generation,device_id,source_domain,batch_id,chunk_index,revision,
        plaintext_hash,bytes,scope_hash,object_key,key_version,state,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'writing',?)
      ON CONFLICT(account_id,generation,device_id,source_domain,batch_id,chunk_index) DO NOTHING`)
      .bind(...identity, chunk.index, chunk.revision, chunk.plaintextHash, chunk.bytes,
        chunk.scopeHash, chunk.objectKey, chunk.keyVersion, Date.now()).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("tenant_fenced")) {
      throw new ActivityLedgerError("tenant_fenced");
    }
    if (error instanceof Error && error.message.includes("batch_conflict")) {
      throw new ActivityLedgerError("batch_conflict");
    }
    throw error;
  }
  const stored = await db.prepare(`SELECT chunk_index,revision,plaintext_hash,bytes,
    scope_hash,object_key,key_version,state FROM content_uploads
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND batch_id=?
    AND chunk_index=?`).bind(...identity, chunk.index).first();
  return storedChunkSchema.parse(stored);
}

export async function uploadedChunks(
  db: D1Database, principal: IngestPrincipal, batch: ContentIdentity,
): Promise<readonly StoredChunk[]> {
  const rows = await db.prepare(`SELECT chunk_index,revision,plaintext_hash,bytes,
    scope_hash,object_key,key_version,state FROM content_uploads WHERE account_id=?
    AND generation=? AND device_id=? AND source_domain=? AND batch_id=? ORDER BY chunk_index`)
    .bind(...streamIdentity(principal, batch)).all();
  return z.array(storedChunkSchema).parse(rows.results);
}

export async function markStored(
  db: D1Database, principal: IngestPrincipal, batch: ContentIdentity, index: number,
): Promise<void> {
  await db.prepare(`UPDATE content_uploads SET state='stored' WHERE account_id=?
    AND generation=? AND device_id=? AND source_domain=? AND batch_id=? AND chunk_index=?
    AND state='writing'`).bind(...streamIdentity(principal, batch), index).run();
}

/**
 * Closed-generation intents remain scan candidates even after a successful
 * deletion: an older timed-out PUT may still complete after this sweep.
 */
export async function sweepContent(
  db: D1Database, bucket: R2Bucket,
  options: { readonly limit?: number; readonly orphanBeforeMs?: number } = {},
): Promise<{ readonly deleted: number }> {
  const bounded = z.number().int().min(1).max(1000).parse(options.limit ?? 100);
  const before = z.number().int().parse(options.orphanBeforeMs ?? Date.now() - 86_400_000);
  const rows = await db.prepare(`SELECT u.object_key FROM content_uploads u
    LEFT JOIN tenant_fences f ON f.account_id=u.account_id
    WHERE f.account_id IS NULL OR f.state<>'active' OR f.generation<>u.generation
      OR (u.created_at<? AND u.state<>'committed' AND NOT EXISTS (
        SELECT 1 FROM content_manifests m WHERE m.account_id=u.account_id
          AND m.generation=u.generation AND m.device_id=u.device_id
          AND m.source_domain=u.source_domain AND m.batch_id=u.batch_id))
    ORDER BY u.purge_order,u.object_key LIMIT ?`).bind(before, bounded).all();
  const objects = z.array(z.object({ object_key: z.string() })).parse(rows.results);
  let deleted = 0;
  for (const object of objects) {
    // Claim before DELETE. A concurrent manifest cannot commit a purging chunk;
    // a manifest that already committed prevents the active-orphan claim.
    const claim = await db.prepare(`UPDATE content_uploads SET state='purging'
      WHERE object_key=? AND (NOT EXISTS (SELECT 1 FROM tenant_fences f
        WHERE f.account_id=content_uploads.account_id
          AND f.generation=content_uploads.generation AND f.state='active')
        OR NOT EXISTS (SELECT 1 FROM content_manifests m
          WHERE m.account_id=content_uploads.account_id
            AND m.generation=content_uploads.generation AND m.device_id=content_uploads.device_id
            AND m.source_domain=content_uploads.source_domain AND m.batch_id=content_uploads.batch_id))`)
      .bind(object.object_key).run();
    if (claim.meta.changes !== 1) continue;
    await bucket.delete(object.object_key);
    await db.prepare(`UPDATE content_uploads SET state='purged',
      purge_order=(SELECT COALESCE(MAX(purge_order),0)+1 FROM content_uploads)
      WHERE object_key=?`)
      .bind(object.object_key).run();
    deleted++;
  }
  return { deleted };
}
