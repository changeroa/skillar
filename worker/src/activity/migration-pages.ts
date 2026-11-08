import { z } from "zod";
import {
  snapshotPageDocumentSchema, summarizeSnapshot,
} from "../../../shared/activity-sync.ts";
import type { MigrationBegin, MigrationPage } from "../../../shared/activity-sync.ts";
import { parseContentDocument } from "../../../shared/activity-content.ts";
import { contentScope, contentScopeHash, readContentScope } from "./content-consent.ts";
import { contentDigest, storedChunkSchema, uploadedChunks } from "./content-db.ts";
import type { ContentEnv } from "./content-env.ts";
import { readChunkBytes } from "./content-objects.ts";
import { authorizeMigration, MigrationError } from "./migration-store.ts";
import type { IngestPrincipal } from "./types.ts";

export async function readMigrationPage(
  env: ContentEnv, principal: IngestPrincipal, begin: MigrationBegin, page: MigrationPage,
  readOnly = false,
) {
  const consent = await authorizeMigration(env, principal, begin, readOnly);
  if (page.index >= begin.pageCount) throw new MigrationError("migration_conflict");
  // P5 uploadedChunks intentionally requires ingest. Export must NOT synthesize
  // that scope on a read-only principal; use the same stored-row parser and
  // exact account/device namespace, after the caller's read authorization.
  const stored = readOnly ? z.array(storedChunkSchema).parse((await env.ACTIVITY.prepare(
    `SELECT chunk_index,revision,plaintext_hash,bytes,scope_hash,object_key,key_version,state
     FROM content_uploads WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
       AND batch_id=? ORDER BY chunk_index`,
  ).bind(principal.accountId, principal.generation, principal.deviceId, begin.sourceDomain,
    page.batchId).all()).results) :
    await uploadedChunks(env.ACTIVITY, principal, { ...begin, batchId: page.batchId });
  const scopeHash = await contentScopeHash(begin);
  if (stored.length !== page.chunks.length) throw new MigrationError("migration_content_missing");
  const bytes = new Uint8Array(page.totalBytes);
  let offset = 0;
  for (const [index, part] of page.chunks.entries()) {
    const object = stored[index];
    if (object === undefined || !["stored", "committed"].includes(object.state) ||
        object.scope_hash !== scopeHash || object.chunk_index !== part.index ||
        object.revision !== begin.cut || part.revision !== begin.cut ||
        object.plaintext_hash !== part.plaintextHash || object.bytes !== part.bytes) {
      throw new MigrationError("migration_content_missing");
    }
    const value = await readChunkBytes(env, principal, object);
    bytes.set(value, offset);
    offset += value.length;
  }
  if (offset !== bytes.length || await contentDigest(bytes) !== page.contentHash) {
    throw new MigrationError("migration_conflict");
  }
  const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const scope = contentScope(begin, consent.contentKinds);
  const document = snapshotPageDocumentSchema.parse(
    parseContentDocument(raw, consent, readOnly ? readContentScope(consent, scope) : scope),
  );
  if (document.rows.some(row => row.revision > begin.cut || row.operation !== "upsert")) {
    throw new MigrationError("migration_conflict");
  }
  const summary = await summarizeSnapshot(document.rows);
  if (JSON.stringify(summary.counts) !== JSON.stringify(page.counts)) {
    throw new MigrationError("migration_conflict");
  }
  return document;
}
