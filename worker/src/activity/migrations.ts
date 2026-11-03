import { z } from "zod";
import {
  MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_CHUNKS, migrationBeginSchema, migrationPageSchema, migrationReferenceSchema,
  migrationStatusSchema,
  summarizeSnapshot,
} from "../../../shared/activity-sync.ts";
import type {
  MigrationExport, MigrationPageResult, MigrationStatus,
} from "../../../shared/activity-sync.ts";
import type { ContentRow } from "../../../shared/activity-content.ts";
import { contentKinds } from "../../../shared/activity-schema.ts";
import { contentScope } from "./content-consent.ts";
import { initializeContentAccount } from "./content-account.ts";
import { contentDigest } from "./content-db.ts";
import type { ContentEnv } from "./content-env.ts";
import { readMigrationPage } from "./migration-pages.ts";
import {
  authorizeMigration, loadMigration, migrationIdentity, migrationPages, migrationWrite, MigrationError,
} from "./migration-store.ts";
import type { IngestPrincipal } from "./types.ts";

export { MigrationError } from "./migration-store.ts";
const hash = (value: unknown) => contentDigest(new TextEncoder().encode(JSON.stringify(value)));
const reference = (value: { readonly deviceId: string; readonly sourceDomain: string;
  readonly generation: number; readonly snapshotId: string }) => ({
  deviceId: value.deviceId, sourceDomain: value.sourceDomain,
  generation: value.generation, snapshotId: value.snapshotId,
});

/**
 * All functions take an INTERNAL verified P2 principal, never payload identity headers.
 * Parent owns HTTP authentication, feature flag, bounded request body and error mapping.
 * Errors retain existing content/consent/crypto codes; MigrationError is always 409.
 * Initial baselines establish a cursor. Explicit historical backfills add a
 * separate immutable snapshot and never reset or advance the live stream.
 */
export async function beginMigration(env: ContentEnv, principal: IngestPrincipal, input: unknown): Promise<MigrationStatus> {
  const begin = migrationBeginSchema.parse(input);
  const identity = migrationIdentity(principal, begin, true);
  await initializeContentAccount(env, principal, contentScope(begin, begin.backfill === null ? [] : contentKinds));
  await authorizeMigration(env, principal, begin);
  const digest = await hash(begin);
  await migrationWrite(() => env.ACTIVITY.prepare(`INSERT INTO migration_runs
    (account_id,generation,device_id,source_domain,snapshot_id,begin_json,begin_hash,cut,
      page_count,snapshot_hash,purpose,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,'staging')
    ON CONFLICT(account_id,generation,device_id,source_domain,snapshot_id) DO NOTHING`)
    .bind(...identity, JSON.stringify(begin), digest, begin.cut, begin.pageCount,
      begin.snapshotHash, begin.purpose).run());
  return migrationStatusInternal(env, principal, reference(begin), true);
}

async function migrationStatusInternal(
  env: ContentEnv, principal: IngestPrincipal, input: unknown, write: boolean,
): Promise<MigrationStatus> {
  const { identity, run, begin } = await loadMigration(env, principal, input, write);
  const pages = await migrationPages(env, identity);
  await authorizeMigration(env, principal, begin, !write);
  return migrationStatusSchema.parse({
    migration: begin, state: run.state, rollbackRequested: run.rollback_requested === 1,
    stagedPages: pages, accepted: run.state === "complete",
    cursor: run.state === "complete" ? {
      sequence: run.cursor_sequence, journalThrough: run.cursor_through, changeSeq: run.change_seq,
    } : null,
  });
}

export async function migrationStatus(env: ContentEnv, principal: IngestPrincipal, input: unknown): Promise<MigrationStatus> {
  return migrationStatusInternal(env, principal, input, false);
}

/** Upload P5 chunks first, with this run's fixed scope and chunk revision=cut. */
export async function stageMigrationPage(env: ContentEnv, principal: IngestPrincipal, input: unknown): Promise<MigrationPageResult> {
  const page = migrationPageSchema.parse(input);
  const { identity, run, begin } = await loadMigration(env, principal, reference(page), true);
  const digest = await hash(page);
  const previous = await env.ACTIVITY.prepare(`SELECT page_hash FROM migration_pages
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND snapshot_id=? AND page_index=?`)
    .bind(...identity, page.index).first();
  if (previous !== null) {
    if (z.object({ page_hash: z.string() }).parse(previous).page_hash !== digest) {
      throw new MigrationError("migration_conflict");
    }
    if (run.state === "abandoned") throw new MigrationError("migration_closed");
    return { staged: true, page };
  }
  if (run.state !== "staging") throw new MigrationError("migration_closed");
  await readMigrationPage(env, principal, begin, page);
  await authorizeMigration(env, principal, begin);
  await migrationWrite(() => env.ACTIVITY.prepare(`INSERT INTO migration_pages
    (account_id,generation,device_id,source_domain,snapshot_id,page_index,batch_id,page_json,page_hash)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(account_id,generation,device_id,source_domain,snapshot_id,page_index) DO NOTHING`)
    .bind(...identity, page.index, page.batchId, JSON.stringify(page), digest).run());
  return { staged: true, page };
}

/**
 * Re-read ACTUAL encrypted R2 for every page, including resumed pages. No durable
 * receipt or CDC cursor exists until the final same-shard transaction publishes.
 * Pages are immutable and SQL pins exclude the P5 sweeper while verification runs.
 */
export async function completeMigration(env: ContentEnv, principal: IngestPrincipal, input: unknown): Promise<MigrationStatus> {
  const { identity, run, begin } = await loadMigration(env, principal, input, true);
  if (run.state === "complete") return migrationStatusInternal(env, principal, input, true);
  if (run.state !== "staging") throw new MigrationError("migration_closed");
  const pages = await migrationPages(env, identity);
  if (pages.length !== begin.pageCount || pages.some((page, index) => page.index !== index)) {
    throw new MigrationError("migration_incomplete");
  }
  if (pages.reduce((sum, page) => sum + page.totalBytes, 0) > MAX_SNAPSHOT_BYTES ||
      pages.reduce((sum, page) => sum + page.chunks.length, 0) > MAX_SNAPSHOT_CHUNKS) {
    throw new MigrationError("migration_conflict");
  }
  const rows: ContentRow[] = [];
  for (const page of pages) {
    rows.push(...(await readMigrationPage(env, principal, begin, page)).rows);
  }
  const verified = await summarizeSnapshot(rows);
  if (verified.snapshotHash !== begin.snapshotHash ||
      JSON.stringify(verified.counts) !== JSON.stringify(begin.counts)) {
    throw new MigrationError("migration_conflict");
  }
  await authorizeMigration(env, principal, begin);
  await migrationWrite(() => env.ACTIVITY.batch([
    env.ACTIVITY.prepare(`UPDATE migration_runs SET state='complete'
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND snapshot_id=?
        AND state='staging'`).bind(...identity),
  ]));
  const result = await migrationStatusInternal(env, principal, input, true);
  if (!result.accepted) throw new MigrationError("migration_closed");
  return result;
}

const exportSchema = migrationReferenceSchema.unwrap().extend({
  page: z.number().int().min(0).optional(),
}).readonly();
/**
 * Same-device, current full consent + activity:read only. No cross-device grants
 * are invented. Without page: original complete manifest. With page: original
 * verified document plus manifest. These are snapshot rows, never local spool/ACK.
 * Later CDC batches are separately exported by P5, not mislabeled as this cut.
 */
export async function exportMigration(env: ContentEnv, principal: IngestPrincipal, input: unknown): Promise<MigrationExport> {
  const request = exportSchema.parse(input);
  const ref = reference(request);
  const result = await migrationStatusInternal(env, principal, ref, false);
  if (!result.accepted) throw new MigrationError("migration_incomplete");
  if (request.page === undefined) return { ...result, document: null };
  const page = result.stagedPages[request.page];
  if (page === undefined) throw new MigrationError("migration_missing");
  const document = await readMigrationPage(env, principal, result.migration, page, true);
  await authorizeMigration(env, principal, result.migration, true);
  return { ...result, document };
}

/**
 * Abandon unaccepted staging (unpins it for P5 GC). An accepted baseline and its
 * CDC cursor remain intact and exportable; rollbackRequested records intent only.
 * Parent separately pauses local outbox/revokes tokens/changes the cloud flag.
 */
export async function rollbackMigration(env: ContentEnv, principal: IngestPrincipal, input: unknown): Promise<MigrationStatus> {
  const { identity } = await loadMigration(env, principal, input, true);
  await migrationWrite(() => env.ACTIVITY.prepare(`UPDATE migration_runs
    SET rollback_requested=1,state=CASE WHEN state='staging' THEN 'abandoned' ELSE state END
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND snapshot_id=?`)
    .bind(...identity).run());
  return migrationStatusInternal(env, principal, input, true);
}
