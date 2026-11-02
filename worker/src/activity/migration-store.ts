import { z } from "zod";
import {
  migrationBeginSchema, migrationPageSchema, migrationReferenceSchema,
} from "../../../shared/activity-sync.ts";
import type { MigrationBegin, MigrationReference } from "../../../shared/activity-sync.ts";
import { contentKinds } from "../../../shared/activity-schema.ts";
import { activeFence } from "./content-db.ts";
import { contentScope, requireContentConsent, requireContentReadConsent } from "./content-consent.ts";
import type { ContentEnv } from "./content-env.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";

export class MigrationError extends Error {
  readonly status = 409;
  constructor(readonly code:
    | "migration_missing" | "migration_conflict" | "migration_closed"
    | "migration_content_missing" | "migration_incomplete" | "migration_epoch_required") {
    super(code);
    this.name = "MigrationError";
  }
}
export const migrationRunSchema = z.object({
  begin_json: z.string(), begin_hash: z.string(),
  state: z.enum(["staging", "complete", "abandoned"]),
  rollback_requested: z.number().int(), change_seq: z.number().int().nullable(),
  cursor_sequence: z.number().int().nullable(), cursor_through: z.number().int().nullable(),
}).readonly();
export type MigrationRun = z.infer<typeof migrationRunSchema>;

export function migrationIdentity(principal: IngestPrincipal, ref: MigrationReference, write: boolean) {
  if (principal.kind !== "device" || principal.deviceId !== ref.deviceId ||
      principal.generation !== ref.generation || principal.shardId !== "activity-00" ||
      principal.scopes.includes("device:manage") ||
      !principal.scopes.includes(write ? "activity:ingest" : "activity:read")) {
    throw new ActivityLedgerError("forbidden");
  }
  return [principal.accountId, principal.generation, principal.deviceId, ref.sourceDomain, ref.snapshotId];
}
export async function authorizeMigration(
  env: ContentEnv, principal: IngestPrincipal, begin: MigrationBegin, readOnly = false,
) {
  await activeFence(env.ACTIVITY, principal);
  // Historical full rows need all seven kinds. A live-only empty baseline grants
  // no permission to transmit content that predates the user's explicit opt-in.
  return (readOnly ? requireContentReadConsent : requireContentConsent)(env.ACCOUNTS, principal,
    contentScope(begin, begin.backfill === null ? [] : contentKinds));
}
export async function loadMigration(
  env: ContentEnv, principal: IngestPrincipal, input: unknown, write: boolean,
) {
  const ref = migrationReferenceSchema.parse(input);
  const identity = migrationIdentity(principal, ref, write);
  await activeFence(env.ACTIVITY, principal);
  const row = await env.ACTIVITY.prepare(`SELECT begin_json,begin_hash,state,rollback_requested,change_seq,
    cursor_sequence,cursor_through
    FROM migration_runs WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND snapshot_id=?`)
    .bind(...identity).first();
  if (row === null) throw new MigrationError("migration_missing");
  const run = migrationRunSchema.parse(row);
  const begin = migrationBeginSchema.parse(JSON.parse(run.begin_json));
  await authorizeMigration(env, principal, begin, !write);
  return { ref, identity, run, begin };
}
export async function migrationPages(env: ContentEnv, identity: readonly (string | number)[]) {
  const rows = await env.ACTIVITY.prepare(`SELECT page_json FROM migration_pages
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND snapshot_id=?
    ORDER BY page_index`).bind(...identity).all();
  return z.array(z.object({ page_json: z.string() })).parse(rows.results)
    .map(row => migrationPageSchema.parse(JSON.parse(row.page_json)));
}
export async function migrationWrite(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("tenant_fenced")) throw new ActivityLedgerError("tenant_fenced");
      for (const code of ["migration_conflict", "migration_closed", "migration_content_missing",
        "migration_incomplete", "migration_epoch_required"] as const) {
        if (error.message.includes(code)) throw new MigrationError(code);
      }
      if (error.message.includes("UNIQUE constraint failed")) throw new MigrationError("migration_conflict");
    }
    throw error;
  }
}
