import { z } from "zod";
import {
  contentChunkRefSchema, contentDocumentSchema, MAX_CONTENT_BYTES,
  parseContentBatch, parseContentDocument, plaintextHashSchema,
} from "../../../shared/activity-content.ts";
import { sourceDomainSchema } from "../../../shared/activity-schema.ts";
import { contentScope, contentScopeHash, requireContentConsent } from "./content-consent.ts";
import {
  activeFence, contentDigest, streamIdentity, uploadedChunks,
} from "./content-db.ts";
import type { ContentEnv } from "./content-env.ts";
import { ContentStorageError } from "./content-keys.ts";
import { readChunkBytes } from "./content-objects.ts";
import { commitActivityBatch } from "./ledger.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";

const storedPartSchema = contentChunkRefSchema.unwrap().extend({
  objectKey: z.string(), keyVersion: z.number().int().positive(), encryptionVersion: z.literal(1),
}).readonly();
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(2), contentHash: plaintextHashSchema,
  totalBytes: z.number().int().min(1).max(MAX_CONTENT_BYTES),
  chunks: z.array(storedPartSchema).min(1).max(128).readonly(),
}).readonly();
type Manifest = z.infer<typeof manifestSchema>;

async function assemble(env: ContentEnv, principal: IngestPrincipal, manifest: Manifest) {
  const plaintext = new Uint8Array(manifest.totalBytes);
  let offset = 0;
  for (const [index, part] of manifest.chunks.entries()) {
    if (part.index !== index || offset + part.bytes > plaintext.length) {
      throw new ContentStorageError("content_conflict", 409);
    }
    const bytes = await readChunkBytes(env, principal, {
      object_key: part.objectKey, key_version: String(part.keyVersion), revision: part.revision,
      plaintext_hash: part.plaintextHash, bytes: part.bytes,
    });
    plaintext.set(bytes, offset);
    offset += bytes.length;
  }
  if (offset !== plaintext.length || await contentDigest(plaintext) !== manifest.contentHash) {
    throw new ContentStorageError("content_conflict", 409);
  }
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  return value;
}

export async function acceptContentBatch(
  env: ContentEnv, principal: IngestPrincipal, input: unknown,
) {
  const batch = parseContentBatch(input);
  streamIdentity(principal, batch);
  await activeFence(env.ACTIVITY, principal);
  const consent = await requireContentConsent(env.ACCOUNTS, principal, contentScope(batch));
  const stored = await uploadedChunks(env.ACTIVITY, principal, batch);
  const scopeHash = await contentScopeHash(batch);
  if (stored.length !== batch.chunks.length) throw new ContentStorageError("content_missing", 409);
  const chunks = batch.chunks.map((part, index) => {
    const object = stored[index];
    if (object === undefined || !["stored", "committed"].includes(object.state) ||
        object.scope_hash !== scopeHash || object.chunk_index !== part.index ||
        object.plaintext_hash !== part.plaintextHash || object.bytes !== part.bytes ||
        object.revision !== part.revision || part.revision !== batch.journal.through) {
      throw new ContentStorageError("content_conflict", 409);
    }
    return {
      ...part, objectKey: object.object_key, keyVersion: Number(object.key_version),
      encryptionVersion: 1,
    };
  });
  const manifest = manifestSchema.parse({
    schemaVersion: 2, contentHash: batch.contentHash, totalBytes: batch.totalBytes, chunks,
  });
  const document = parseContentDocument(await assemble(env, principal, manifest),
    consent, contentScope(batch, consent.contentKinds));
  if ([...document.rows, ...batch.metadataMutations].some(row =>
    row.revision <= batch.journal.from || row.revision > batch.journal.through)) {
    throw new ContentStorageError("content_conflict", 409);
  }
  // Consent is checked again after all awaited R2 reads, before the final
  // same-shard generation-fenced receipt/manifest/projection transaction.
  await requireContentConsent(env.ACCOUNTS, principal, contentScope(batch));
  return commitActivityBatch(env.ACTIVITY, {
    principal, receivedAtMs: Date.now(),
    batch: {
      schemaVersion: 1, batchId: batch.batchId, deviceId: batch.deviceId,
      sourceDomain: batch.sourceDomain, generation: batch.generation,
      consentVersion: batch.consentVersion, projectId: batch.projectId, rootId: batch.rootId,
      range: batch.range, backfill: batch.backfill, sequence: batch.sequence,
      // P4/P5 use (previousCut,through]; the P3 ledger uses inclusive from.
      journal: { from: batch.journal.from + 1, through: batch.journal.through },
      mutations: batch.metadataMutations,
    },
    durableContent: {
      payloadHash: await contentDigest(new TextEncoder().encode(JSON.stringify(batch))),
      contentHash: batch.contentHash, totalBytes: batch.totalBytes,
      manifestJson: JSON.stringify(manifest),
    },
  });
}

/** Internal repository read; the API caller still authenticates the principal. */
export async function readBatchContent(
  env: ContentEnv, principal: IngestPrincipal,
  input: { readonly sourceDomain: string; readonly batchId: string },
) {
  if (!principal.scopes.includes("activity:read")) throw new ActivityLedgerError("forbidden");
  await activeFence(env.ACTIVITY, principal);
  const source = sourceDomainSchema.parse(input.sourceDomain);
  const batchId = z.string().min(1).max(512).parse(input.batchId);
  const identity = [principal.accountId, principal.generation, principal.deviceId, source, batchId];
  const row = await env.ACTIVITY.prepare(`SELECT manifest_json FROM content_manifests
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND batch_id=?`)
    .bind(...identity).first();
  if (row === null) throw new ContentStorageError("content_missing", 409);
  const saved = z.object({ manifest_json: z.string() }).parse(row);
  const document = contentDocumentSchema.parse(await assemble(env, principal,
    manifestSchema.parse(JSON.parse(saved.manifest_json))));
  await activeFence(env.ACTIVITY, principal);
  return document;
}
