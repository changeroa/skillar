import { contentKinds } from "../../../shared/activity-schema.ts";
import {
  parseContentChunkUpload, parseContentDocument, verifyContentChunkUpload,
} from "../../../shared/activity-content.ts";
import {
  contentScope, contentScopeHash, requireContentConsent,
} from "./content-consent.ts";
import {
  activeFence, contentDigest, contentObjectKey, markStored,
  recordUploadIntent, streamIdentity,
} from "./content-db.ts";
import type { StoredChunk } from "./content-db.ts";
import type { ContentEnv } from "./content-env.ts";
import { ContentStorageError, readContentKey, writeContentKey } from "./content-keys.ts";
import { decryptContent, encryptContent } from "./crypto.ts";
import type { IngestPrincipal } from "./types.ts";
import { initializeContentAccount } from "./content-account.ts";

export async function readChunkBytes(
  env: ContentEnv, principal: IngestPrincipal,
  stored: Pick<StoredChunk, "object_key" | "key_version" | "revision" | "plaintext_hash" | "bytes">,
): Promise<Uint8Array> {
  const object = await env.ACTIVITY_RAW.get(stored.object_key);
  if (object === null) throw new ContentStorageError("content_missing", 409);
  const key = await readContentKey(env.ACTIVITY, principal, env.CONTENT_KEYRING,
    Number(stored.key_version));
  const envelope: unknown = await object.json();
  const bytes = await decryptContent(key, {
    accountId: principal.accountId, generation: principal.generation,
    objectKey: stored.object_key, revision: stored.revision, schemaVersion: 2,
  }, envelope);
  if (bytes.byteLength !== stored.bytes || await contentDigest(bytes) !== stored.plaintext_hash) {
    throw new ContentStorageError("content_conflict", 409);
  }
  return bytes;
}

/** A chunk receipt is not a batch receipt; only finalization accepts a batch. */
export async function storeContentChunk(
  env: ContentEnv, principal: IngestPrincipal, input: unknown,
) {
  const chunk = parseContentChunkUpload(input);
  streamIdentity(principal, chunk);
  await initializeContentAccount(env, principal, contentScope(chunk));
  await activeFence(env.ACTIVITY, principal);
  const consent = await requireContentConsent(env.ACCOUNTS, principal, contentScope(chunk));
  const bytes = await verifyContentChunkUpload(chunk);
  if (!contentKinds.every(kind => consent.contentKinds.includes(kind))) {
    // A selected-kind upload must be independently authorizable before R2 PUT.
    // Opaque multipart documents require the complete seven-kind grant.
    if (chunk.index !== 0) throw new ContentStorageError("content_conflict", 409);
    const document: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    parseContentDocument(document, consent, contentScope(chunk, consent.contentKinds));
  }
  const current = await writeContentKey(env.ACTIVITY, principal, env.CONTENT_KEYRING);
  const stored = await recordUploadIntent(env.ACTIVITY, principal, chunk, {
    index: chunk.index, revision: chunk.revision, plaintextHash: chunk.plaintextHash,
    bytes: chunk.bytes, scopeHash: await contentScopeHash(chunk),
    objectKey: await contentObjectKey(principal, chunk, chunk), keyVersion: String(current.version),
  });
  if (stored.state === "purging" || stored.state === "purged") {
    throw new ContentStorageError("content_expired", 409);
  }
  const key = stored.key_version === String(current.version) ? current.key :
    await readContentKey(env.ACTIVITY, principal, env.CONTENT_KEYRING, Number(stored.key_version));
  const envelope = await encryptContent(key, {
    accountId: principal.accountId, generation: principal.generation,
    objectKey: stored.object_key, revision: stored.revision, schemaVersion: 2,
  }, new Uint8Array(bytes));
  await env.ACTIVITY_RAW.put(stored.object_key, JSON.stringify(envelope), {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
  });
  // A conditional no-op is only an exact retry after the existing bytes verify.
  await readChunkBytes(env, principal, stored);
  await markStored(env.ACTIVITY, principal, chunk, chunk.index);
  await activeFence(env.ACTIVITY, principal);
  await requireContentConsent(env.ACCOUNTS, principal, contentScope(chunk));
  return {
    stored: true, chunk: {
      index: chunk.index, revision: chunk.revision, plaintextHash: chunk.plaintextHash,
      bytes: chunk.bytes,
    },
  };
}
