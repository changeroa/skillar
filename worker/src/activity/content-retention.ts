// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { consentSchema } from "../../../shared/activity-consent.ts";
import type { ContentEnv } from "./content-env.ts";
import { ContentStorageError } from "./content-keys.ts";
import type { IngestPrincipal } from "./types.ts";
import { ActivityLedgerError } from "./types.ts";

type SourceIdentity = {
  readonly account_id: string; readonly generation: number; readonly device_id: string;
  readonly source_domain: string; readonly batch_id: string;
};
const identityArgs = (row: SourceIdentity) =>
  [row.account_id, row.generation, row.device_id, row.source_domain, row.batch_id] as const;
const lineageSchema = z.object({
  consent_version: z.number().int().positive(), pending_mutations: z.number().int().nonnegative(),
});

/** CDC and snapshot pages use upload age, never source timestamps or retry time. */
async function sourceLineage(env: ContentEnv, row: SourceIdentity) {
  const saved = await env.ACTIVITY.prepare(`SELECT
      json_extract(metadata_json,'$.consentVersion') AS consent_version,
      COALESCE(json_array_length(metadata_json,'$.mutations'),0) AS pending_mutations
    FROM ingest_receipts WHERE account_id=? AND generation=? AND device_id=?
      AND source_domain=? AND batch_id=?
    UNION ALL SELECT json_extract(r.begin_json,'$.consentVersion') AS consent_version,0 AS pending_mutations
    FROM migration_pages p JOIN migration_runs r USING
      (account_id,generation,device_id,source_domain,snapshot_id)
    WHERE p.account_id=? AND p.generation=? AND p.device_id=? AND p.source_domain=?
      AND p.batch_id=? LIMIT 1`)
    .bind(...identityArgs(row), ...identityArgs(row)).first();
  return saved === null ? null : lineageSchema.parse(saved);
}

export async function sourceBatchExpiry(
  env: ContentEnv, row: SourceIdentity, consentVersion: number,
): Promise<number> {
  const [grants, uploaded] = await Promise.all([
    env.ACCOUNTS.batch([
    env.ACCOUNTS.prepare(`SELECT consent_json FROM device_consents
      WHERE account_id=? AND generation=? AND device_id=? AND version=?`)
      .bind(row.account_id, row.generation, row.device_id, consentVersion),
    env.ACCOUNTS.prepare(`SELECT consent_json FROM device_consents
      WHERE account_id=? AND generation=? AND device_id=? ORDER BY version DESC LIMIT 1`)
      .bind(row.account_id, row.generation, row.device_id),
    ]),
    env.ACTIVITY.prepare(`SELECT min(created_at) AS created_at FROM content_uploads
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND batch_id=?`)
      .bind(...identityArgs(row)).first(),
  ]);
  return grantExpiry(grants[0]?.results[0] ?? null, grants[1]?.results[0] ?? null,
    z.object({ created_at: z.number().nullable() }).parse(uploaded).created_at);
}

function grantExpiry(original: unknown, current: unknown, created: number | null): number {
  // A removed original grant cannot confer indefinite retention.
  if (original === null) return 0;
  const parseGrant = (saved: unknown) =>
    consentSchema.parse(JSON.parse(z.object({ consent_json: z.string() }).parse(saved).consent_json));
  const grant = parseGrant(original);
  if (grant.mode !== "managed-content") return 0;
  const latest = current === null ? null : parseGrant(current);
  const days = latest?.mode === "managed-content" ?
    Math.min(grant.retention.contentDays, grant.retention.projectionDays,
      latest.retention.contentDays, latest.retention.projectionDays) :
    Math.min(grant.retention.contentDays, grant.retention.projectionDays);
  return created === null ? 0 : Math.min(8_640_000_000_000_000, created + days * 86_400_000);
}

/** Immutable descriptors alone never authorize a read of terminal or expired bytes. */
export async function requireChunkReadable(
  env: ContentEnv, principal: IngestPrincipal, objectKey: string,
): Promise<void> {
  const result = await env.ACTIVITY.batch([
    env.ACTIVITY.prepare(`SELECT 1 FROM tenant_fences
      WHERE account_id=? AND generation=? AND state='active'`)
      .bind(principal.accountId, principal.generation),
    env.ACTIVITY.prepare(`SELECT u.account_id,u.generation,u.device_id,
      u.source_domain,u.batch_id,u.state,
      (SELECT json_extract(r.metadata_json,'$.consentVersion') FROM ingest_receipts r
        WHERE r.account_id=u.account_id AND r.generation=u.generation AND r.device_id=u.device_id
          AND r.source_domain=u.source_domain AND r.batch_id=u.batch_id
        UNION ALL SELECT json_extract(r.begin_json,'$.consentVersion')
        FROM migration_pages p JOIN migration_runs r USING
          (account_id,generation,device_id,source_domain,snapshot_id)
        WHERE p.account_id=u.account_id AND p.generation=u.generation AND p.device_id=u.device_id
          AND p.source_domain=u.source_domain AND p.batch_id=u.batch_id LIMIT 1) AS consent_version,
      (SELECT min(v.created_at) FROM content_uploads v WHERE v.account_id=u.account_id
        AND v.generation=u.generation AND v.device_id=u.device_id
        AND v.source_domain=u.source_domain AND v.batch_id=u.batch_id) AS created_at
      FROM content_uploads u WHERE u.object_key=?
        AND u.account_id=? AND u.generation=? AND u.device_id=?`)
      .bind(objectKey, principal.accountId, principal.generation, principal.deviceId),
  ]);
  if (result[0]?.results.length !== 1) throw new ActivityLedgerError("tenant_fenced");
  const saved = result[1]?.results[0] ?? null;
  if (saved === null) throw new ContentStorageError("content_missing", 409);
  const row = z.object({
    account_id: z.string(), generation: z.number(), device_id: z.string(),
    source_domain: z.string(), batch_id: z.string(), state: z.string(),
    consent_version: z.number().int().positive().nullable(), created_at: z.number().nullable(),
  }).parse(saved);
  if (row.state === "purging" || row.state === "purged") {
    throw new ContentStorageError("content_expired", 409);
  }
  // Unfinalized uploads have no receipt yet. Runtime contexts deliberately retain
  // their independent received_at_ms checks in runtime-api.ts.
  if (row.consent_version !== null) {
    const grants = await env.ACCOUNTS.batch([
      env.ACCOUNTS.prepare(`SELECT consent_json FROM device_consents
        WHERE account_id=? AND generation=? AND device_id=? AND version=?`)
        .bind(row.account_id, row.generation, row.device_id, row.consent_version),
      env.ACCOUNTS.prepare(`SELECT consent_json FROM device_consents
        WHERE account_id=? AND generation=? AND device_id=? ORDER BY version DESC LIMIT 1`)
        .bind(row.account_id, row.generation, row.device_id),
    ]);
    if (grantExpiry(grants[0]?.results[0] ?? null, grants[1]?.results[0] ?? null, row.created_at) <= Date.now()) {
      throw new ContentStorageError("content_expired", 409);
    }
  }
}

/**
 * Bounded fair scan of source receipts/pages, including permanent terminal intents.
 * Keep manifests, receipt hashes, source/fence high-watermarks and shared keys.
 * Retire only projections no newer than this receipt's mutation revision.
 */
export async function sweepSourceContent(
  env: ContentEnv, options: { readonly limit?: number; readonly now?: () => number } = {},
): Promise<{ readonly scanned: number; readonly deleted: number }> {
  const limit = z.number().int().min(1).max(1000).parse(options.limit ?? 100);
  const result = await env.ACTIVITY.prepare(`SELECT u.account_id,u.generation,u.device_id,
    u.source_domain,u.batch_id,u.object_key,u.state FROM content_uploads u
    WHERE EXISTS (SELECT 1 FROM ingest_receipts r WHERE r.account_id=u.account_id
      AND r.generation=u.generation AND r.device_id=u.device_id
      AND r.source_domain=u.source_domain AND r.batch_id=u.batch_id)
    OR EXISTS (SELECT 1 FROM migration_pages p WHERE p.account_id=u.account_id
      AND p.generation=u.generation AND p.device_id=u.device_id
      AND p.source_domain=u.source_domain AND p.batch_id=u.batch_id)
    ORDER BY u.purge_order,u.object_key LIMIT ?`).bind(limit).all();
  const rows = z.array(z.object({
    account_id: z.string(), generation: z.number(), device_id: z.string(),
    source_domain: z.string(), batch_id: z.string(), object_key: z.string(), state: z.string(),
  })).parse(result.results);
  let deleted = 0;
  for (const row of rows) {
    const lineage = await sourceLineage(env, row);
    if (row.state === "purging" || row.state === "purged" ||
        (lineage !== null &&
          await sourceBatchExpiry(env, row, lineage.consent_version) <= (options.now?.() ?? Date.now()))) {
      // Source retention owns retirement of pinned pages, not orphan GC. As in
      // runtime retention, write a terminal identity BEFORE awaited R2 DELETE.
      await env.ACTIVITY.prepare("UPDATE content_uploads SET state='purged' WHERE object_key=?")
        .bind(row.object_key).run();
      if (lineage !== null && lineage.pending_mutations > 0) {
        const active = `EXISTS (SELECT 1 FROM tenant_fences f
          WHERE f.account_id=?1 AND f.generation=?2 AND f.state='active')`;
        await env.ACTIVITY.batch([
          ...(["session", "event", "span"] as const).map(entity =>
            env.ACTIVITY.prepare(`DELETE FROM ${entity}_facts WHERE rowid IN (
              SELECT t.rowid FROM ingest_receipts r, json_each(r.metadata_json,'$.mutations') m
              JOIN ${entity}_facts t ON t.account_id=r.account_id AND t.generation=r.generation
                AND t.device_id=r.device_id AND t.source_domain=r.source_domain
                AND t.entity_key=json_extract(m.value,'$.key')
              WHERE r.account_id=?1 AND r.generation=?2 AND r.device_id=?3
                AND r.source_domain=?4 AND r.batch_id=?5
                AND json_extract(m.value,'$.entity')='${entity}'
                AND t.revision<=json_extract(m.value,'$.revision'))
              AND ${active}`).bind(...identityArgs(row))),
          env.ACTIVITY.prepare(`UPDATE ingest_receipts
            SET metadata_json=json_set(metadata_json,'$.mutations',json('[]'))
            WHERE account_id=?1 AND generation=?2 AND device_id=?3
              AND source_domain=?4 AND batch_id=?5
              AND json_array_length(metadata_json,'$.mutations')>0
              AND ${active}`).bind(...identityArgs(row)),
        ]);
      }
      await env.ACTIVITY_RAW.delete(row.object_key);
      deleted++;
    }
    // Live rows rotate too. Failed DELETE keeps its place for the next invocation.
    await env.ACTIVITY.prepare(`UPDATE content_uploads
      SET purge_order=(SELECT COALESCE(MAX(purge_order),0)+1 FROM content_uploads)
      WHERE object_key=?`).bind(row.object_key).run();
  }
  return { scanned: rows.length, deleted };
}
