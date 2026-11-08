import { analysisRuntimeSchema, runtimeCommitSchema } from "../../../shared/activity-runtime.ts";
import type { RuntimeCommit } from "../../../shared/activity-runtime.ts";
import { contentKinds } from "../../../shared/activity-schema.ts";
import {
  contentScope, contentScopeHash, ContentConsentError,
  requireContentConsent, requireContentReadConsent,
} from "./content-consent.ts";
import {
  activeFence, contentDigest, streamIdentity, uploadedChunks,
} from "./content-db.ts";
import type { StoredChunk } from "./content-db.ts";
import type { ContentEnv } from "./content-env.ts";
import { ContentStorageError } from "./content-keys.ts";
import { readChunkBytes } from "./content-objects.ts";
import {
  findRuntime, runtimeChunks, runtimeCommit, runtimeMetadata, RuntimeError, saveRuntime,
} from "./runtime-store.ts";
import type { RuntimeRow } from "./runtime-store.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";

function reader(principal: IngestPrincipal): void {
  if (!principal.scopes.includes("activity:read") || principal.scopes.includes("device:manage") ||
      principal.shardId !== "activity-00") throw new ActivityLedgerError("forbidden");
}
async function permission(
  env: ContentEnv, principal: IngestPrincipal, commit: RuntimeCommit, read = false,
) {
  const scope = contentScope(commit, contentKinds);
  const consent = await (read ? requireContentReadConsent : requireContentConsent)(
    env.ACCOUNTS, principal, scope);
  if (commit.projectId !== `device:${principal.deviceId}` || commit.rootId !== null ||
      consent.scope.rootIds.length !== 0 || !contentKinds.every(kind => consent.contentKinds.includes(kind))) {
    throw new ContentConsentError();
  }
  if (commit.capturedAtMs < commit.range.fromMs || commit.capturedAtMs >= commit.range.toMs) {
    throw new ContentConsentError();
  }
  return consent;
}

/** Receipt age, not source time: authorized backfills may have historical captures. */
export async function requireRuntimeReadable(
  env: ContentEnv, principal: IngestPrincipal, row: RuntimeRow, nowMs = Date.now(),
): Promise<void> {
  await activeFence(env.ACTIVITY, principal);
  const commit = runtimeCommit(row);
  const consent = await permission(env, principal, commit, true);
  if (nowMs - row.received_at_ms >=
      Math.min(consent.retention.contentDays, consent.retention.projectionDays) * 86_400_000) {
    throw new RuntimeError("runtime_missing");
  }
  // A terminal upload intent denies reads even if consent is subsequently restored
  // or a timed-out PUT lands after DELETE. Immutable receipts remain retryable.
  const purged = await env.ACTIVITY.prepare(`SELECT 1 FROM content_uploads
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND batch_id=?
      AND state IN ('purging','purged') LIMIT 1`)
    .bind(principal.accountId, principal.generation, principal.deviceId, commit.sourceDomain,
      commit.batchId).first();
  if (purged !== null) throw new RuntimeError("runtime_missing");
}
async function contextBytes(
  env: ContentEnv, principal: IngestPrincipal, commit: RuntimeCommit, chunks: readonly StoredChunk[],
) {
  const bytes = new Uint8Array(commit.totalBytes);
  let offset = 0;
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.chunk_index !== index || offset + chunk.bytes > bytes.length) {
      throw new ContentStorageError("content_conflict", 409);
    }
    bytes.set(await readChunkBytes(env, principal, chunk), offset);
    offset += chunk.bytes;
  }
  if (offset !== bytes.length || await contentDigest(bytes) !== commit.contentHash) {
    throw new ContentStorageError("content_conflict", 409);
  }
  const context = analysisRuntimeSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (context.capturedAtMs !== commit.capturedAtMs) throw new ContentStorageError("content_conflict", 409);
  return context;
}

export async function commitRuntime(
  env: ContentEnv, principal: IngestPrincipal, input: unknown,
  options: { readonly now?: () => number } = {},
) {
  const commit = runtimeCommitSchema.parse(input);
  reader(principal);
  streamIdentity(principal, commit);
  await activeFence(env.ACTIVITY, principal);
  await permission(env, principal, commit);
  const payloadHash = await contentDigest(new TextEncoder().encode(JSON.stringify(commit)));
  const previous = await findRuntime(env.ACTIVITY, principal, commit.sourceDomain, commit.sequence);
  if (previous !== null) {
    if (previous.payload_hash !== payloadHash) throw new ActivityLedgerError("batch_conflict");
    await activeFence(env.ACTIVITY, principal);
    await permission(env, principal, commit);
    return { sequence: commit.sequence, sourceCut: commit.sourceCut, contentHash: commit.contentHash };
  }
  const chunks = await uploadedChunks(env.ACTIVITY, principal, commit);
  const scopeHash = await contentScopeHash(commit);
  if (chunks.length !== commit.chunks.length || chunks.some((chunk, index) => {
    const ref = commit.chunks[index];
    return ref === undefined || chunk.chunk_index !== index || ref.index !== index ||
      chunk.revision !== commit.sourceCut || ref.revision !== chunk.revision ||
      ref.plaintextHash !== chunk.plaintext_hash || ref.bytes !== chunk.bytes ||
      chunk.scope_hash !== scopeHash || !["stored", "committed"].includes(chunk.state);
  })) throw new ContentStorageError("content_conflict", 409);
  await contextBytes(env, principal, commit, chunks);
  await permission(env, principal, commit);
  await saveRuntime(env.ACTIVITY, principal, commit, payloadHash, chunks, options.now?.() ?? Date.now());
  await activeFence(env.ACTIVITY, principal);
  await permission(env, principal, commit);
  return { sequence: commit.sequence, sourceCut: commit.sourceCut, contentHash: commit.contentHash };
}

export async function latestRuntimeRevision(
  env: ContentEnv, principal: IngestPrincipal, sourceDomain: string,
  options: { readonly now?: () => number } = {},
) {
  reader(principal);
  await activeFence(env.ACTIVITY, principal);
  const row = await findRuntime(env.ACTIVITY, principal, sourceDomain);
  if (row === null) return null;
  try {
    await requireRuntimeReadable(env, principal, row, options.now?.() ?? Date.now());
  } catch (error) {
    if (error instanceof RuntimeError && error.code === "runtime_missing") return null;
    throw error;
  }
  await activeFence(env.ACTIVITY, principal);
  return runtimeMetadata(row);
}

export async function readRuntimeContext(
  env: ContentEnv, principal: IngestPrincipal,
  input: { readonly sourceDomain: string; readonly sequence?: number },
  options: { readonly now?: () => number } = {},
) {
  reader(principal);
  await activeFence(env.ACTIVITY, principal);
  const row = await findRuntime(env.ACTIVITY, principal, input.sourceDomain, input.sequence);
  if (row === null) throw new RuntimeError("runtime_missing");
  const commit = runtimeCommit(row);
  await requireRuntimeReadable(env, principal, row, options.now?.() ?? Date.now());
  const context = await contextBytes(env, principal, commit, runtimeChunks(row));
  await activeFence(env.ACTIVITY, principal);
  await requireRuntimeReadable(env, principal, row, options.now?.() ?? Date.now());
  return { context, ...runtimeMetadata(row) };
}
