// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  DELETION_BACKUP_HORIZON_MS, deletionTargetSchema,
} from "../../../shared/activity-deletion.ts";
import type { DeletionTarget } from "../../../shared/activity-deletion.ts";
import type { ContentEnv } from "./content-env.ts";
import { reapplyPrimaryDeletion, storedDeletion } from "./deletion-store.ts";
import { sweepPrivateSkills } from "../private-skills/retention.ts";

// Ordered children before parents. Opaque late-PUT targets live outside this set.
const contentTables = [
  "report_objects", "report_jobs", "migration_pages", "migration_runs",
  "runtime_contexts", "content_manifests", "content_uploads", "account_content_keys",
  "dashboard_eval_cases", "private_pack_versions", "private_pack_heads", "private_pack_jobs",
  "connector_commands", "dispatch_outbox", "jobs", "ingest_receipts",
  "session_facts", "event_facts", "span_facts", "entity_tombstones", "device_streams",
  "account_event_outbox", "account_control_receipts", "account_changes", "account_heads",
] as const;
const objectTables = [
  "content_uploads", "report_objects", "dashboard_eval_cases",
  "private_pack_jobs", "private_pack_versions", "connector_commands",
] as const;
const optionsSchema = z.object({
  now: z.number().int().nonnegative().safe().default(() => Date.now()),
  objectLimit: z.number().int().min(1).max(100).default(50),
  rowLimit: z.number().int().min(1).max(1000).default(1000),
});
export class DeletionError extends Error {
  constructor(readonly code: "deletion_not_authorized" | "deletion_unavailable", readonly status: 403 | 503) {
    super(code);
    this.name = "DeletionError";
  }
}

async function rememberObjects(db: D1Database, target: DeletionTarget, keys: readonly string[]) {
  if (keys.length === 0) return;
  await db.prepare(`INSERT INTO deletion_objects(account_id,generation,object_key)
    SELECT ?,?,value FROM json_each(?) WHERE 1 ON CONFLICT DO NOTHING`)
    .bind(target.accountId, target.generation, JSON.stringify(keys)).run();
}

/** Only a durable, independently revoked generation can enter this pipeline. */
export async function reconcileDeletion(
  env: ContentEnv, target: DeletionTarget,
  options: { readonly now?: number; readonly objectLimit?: number; readonly rowLimit?: number } = {},
) {
  const { now, objectLimit, rowLimit } = optionsSchema.parse(options);
  await reapplyPrimaryDeletion(env.ACCOUNTS, target, now);
  const ledger = await storedDeletion(env.ACCOUNTS, target);
  if (ledger === null) throw new DeletionError("deletion_not_authorized", 403);
  const args = [target.accountId, target.generation] as const;
  await env.ACTIVITY.batch([
    env.ACTIVITY.prepare(`INSERT INTO tenant_fences(account_id,generation,state) VALUES(?,?,'closed')
      ON CONFLICT(account_id) DO UPDATE SET state='closed'
      WHERE tenant_fences.generation<=excluded.generation`).bind(...args),
    ...objectTables.map(table => env.ACTIVITY.prepare(`INSERT INTO deletion_objects
      (account_id,generation,object_key) SELECT account_id,generation,object_key FROM ${table}
      WHERE account_id=? AND generation<=? ORDER BY rowid LIMIT ?
      ON CONFLICT DO NOTHING`).bind(...args, rowLimit)),
    env.ACTIVITY.prepare(`INSERT INTO deletion_objects(account_id,generation,object_key)
      SELECT account_id,generation,result_object_key FROM connector_commands
      WHERE account_id=? AND generation<=? AND result_object_key IS NOT NULL
      ORDER BY rowid LIMIT ? ON CONFLICT DO NOTHING`).bind(...args, rowLimit),
  ]);

  // Actor serialization drains in-flight catalog operations and closes every
  // account stream before access_revoked can be acknowledged.
  if (env.ACCOUNT_HUB === undefined || env.PRIVATE_SKILL_CATALOG === undefined) {
    throw new DeletionError("deletion_unavailable", 503);
  }
  for (const [namespace, url] of [
    [env.ACCOUNT_HUB, "https://hub.internal/purge"],
    [env.PRIVATE_SKILL_CATALOG, "https://activity.internal/v1/private-skills/purge"],
  ] as const) {
    const response = await namespace.get(namespace.idFromName(target.accountId)).fetch(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target),
    });
    if (!response.ok) throw new DeletionError("deletion_unavailable", 503);
  }
  await env.ACCOUNTS.prepare(`UPDATE activity_deletions SET
    access_revoked_at_ms=COALESCE(access_revoked_at_ms,?),
    state=CASE WHEN state='requested' THEN 'access_revoked' ELSE state END
    WHERE account_id=? AND generation=?`).bind(now, ...args).run();

  // These are the only raw/private namespaces, with an exact account delimiter.
  // Discovery also captures an unreferenced object restored from an old backup.
  const prefixes = [
    `activity/${encodeURIComponent(target.accountId)}/`,
    `private-skills/${encodeURIComponent(target.accountId)}/`,
  ];
  let observedCopy = false;
  for (const prefix of prefixes) {
    const page = await env.ACTIVITY_RAW.list({ prefix, limit: objectLimit });
    observedCopy ||= page.objects.length !== 0;
    await rememberObjects(env.ACTIVITY, target, page.objects.map(object => object.key));
  }
  const removed = await env.ACTIVITY.batch(contentTables.map(table => {
    const child = table === "report_jobs" ? { table: "report_objects", key: "job_id" } :
      table === "migration_runs" ? { table: "migration_pages", key: "snapshot_id" } :
      table === "ingest_receipts" ? { table: "content_manifests", key: "batch_id" } : null;
    const guard = child === null ? "" : `AND NOT EXISTS(SELECT 1 FROM ${child.table} c
      WHERE c.account_id=${table}.account_id AND c.generation=${table}.generation
        AND c.device_id=${table}.device_id AND c.source_domain=${table}.source_domain
        AND c.${child.key}=${table}.${child.key})`;
    return env.ACTIVITY.prepare(`DELETE FROM ${table} WHERE rowid IN(
      SELECT rowid FROM ${table} WHERE account_id=? AND generation<=? ${guard}
      ORDER BY rowid LIMIT ?)`).bind(...args, rowLimit);
  }));
  observedCopy ||= removed.some(result => result.meta.changes > 0);

  // Finish old generations too; account erasure is not just a current-head delete.
  const privateGeneration = await env.ACCOUNTS.prepare(`SELECT generation FROM (
    SELECT generation FROM private_skill_versions WHERE account_id=? AND generation<=?
    UNION SELECT generation FROM private_skill_uploads WHERE account_id=? AND generation<=?
    UNION SELECT generation FROM private_skills WHERE account_id=? AND generation<=?
      AND (name!='' OR description!='' OR tombstoned=0 OR purge_complete=0)
    ) ORDER BY generation LIMIT 1`).bind(...args, ...args, ...args).first("generation");
  const nextGeneration = privateGeneration === null
    ? await env.ACCOUNTS.prepare(`SELECT generation FROM private_skill_purges
        WHERE account_id=? AND generation<=? GROUP BY generation
        ORDER BY MIN(sweep_order),generation LIMIT 1`).bind(...args).first("generation")
    : privateGeneration;
  if (nextGeneration !== null) {
    const swept = await sweepPrivateSkills(env, {
      identity: { accountId: target.accountId, generation: z.number().int().positive().parse(nextGeneration) },
      now, limit: 10, objectLimit,
    });
    observedCopy ||= swept.claimed > 0 || swept.scrubbed > 0;
  }
  const objects = z.array(z.object({ object_key: z.string() })).parse((await env.ACTIVITY.prepare(
    `SELECT object_key FROM deletion_objects WHERE account_id=? AND generation<=?
      ORDER BY purge_order,object_key LIMIT ?`,
  ).bind(...args, objectLimit).all()).results);
  let pending = false;
  for (const object of objects) {
    await env.ACTIVITY_RAW.delete(object.object_key);
    const remains = await env.ACTIVITY_RAW.head(object.object_key) !== null;
    pending ||= remains;
    observedCopy ||= remains;
    await env.ACTIVITY.prepare(`UPDATE deletion_objects SET checked_at_ms=?,
      purge_order=(SELECT COALESCE(MAX(purge_order),0)+1 FROM deletion_objects)
      WHERE account_id=? AND object_key=?`).bind(now, target.accountId, object.object_key).run();
  }
  for (const prefix of prefixes) {
    const page = await env.ACTIVITY_RAW.list({ prefix, limit: 1 });
    pending ||= page.objects.length !== 0 || page.truncated;
  }
  const activityRemaining = await env.ACTIVITY.prepare(`SELECT (
    ${contentTables.map(table => `EXISTS(SELECT 1 FROM ${table}
      WHERE account_id=? AND generation<=?)`).join(" OR ")}
    OR EXISTS(SELECT 1 FROM deletion_objects
      WHERE account_id=? AND generation<=? AND checked_at_ms IS NULL)) AS pending`)
    .bind(...contentTables.flatMap(() => args), ...args).first("pending");
  const privateRemaining = await env.ACCOUNTS.prepare(`SELECT (
    EXISTS(SELECT 1 FROM private_skill_versions WHERE account_id=? AND generation<=?)
    OR EXISTS(SELECT 1 FROM private_skill_uploads WHERE account_id=? AND generation<=?)
    OR EXISTS(SELECT 1 FROM private_skills WHERE account_id=? AND generation<=?
      AND (name!='' OR description!='' OR tombstoned=0 OR purge_complete=0))) AS pending`)
    .bind(...args, ...args, ...args).first("pending");
  pending ||= z.number().parse(activityRemaining) !== 0 || z.number().parse(privateRemaining) !== 0;
  const fresh = observedCopy || ledger.live_purge_at_ms === null;
  const deadline = fresh ? now + DELETION_BACKUP_HORIZON_MS : ledger.backup_expires_at_ms;
  await env.ACCOUNTS.prepare(`UPDATE activity_deletions SET
    state=CASE WHEN ? THEN 'access_revoked'
      WHEN ?>=MAX(backup_expires_at_ms,?) THEN 'backup_expired' ELSE 'live_purge_complete' END,
    live_purge_at_ms=CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE live_purge_at_ms END,
    last_copy_at_ms=MAX(last_copy_at_ms,?),
    backup_expires_at_ms=MAX(backup_expires_at_ms,?)
    WHERE account_id=? AND generation=?`)
    .bind(pending ? 1 : 0, now, deadline, pending ? 1 : 0, fresh ? 1 : 0, now,
      observedCopy ? now : ledger.last_copy_at_ms, deadline, ...args).run();
  return { pending, visitedObjects: objects.length };
}

/** Every row, including a completed one, remains a fair late-write/restore scan. */
export async function sweepDeletions(env: ContentEnv) {
  const row = await env.ACCOUNTS.prepare(`SELECT account_id AS accountId,generation
    FROM activity_deletions ORDER BY reconcile_order,account_id,generation LIMIT 1`).first();
  if (row === null) return { visited: 0 };
  const target = deletionTargetSchema.parse(row);
  await env.ACCOUNTS.prepare(`UPDATE activity_deletions SET
    reconcile_order=(SELECT COALESCE(MAX(reconcile_order),0)+1 FROM activity_deletions)
    WHERE account_id=? AND generation=?`).bind(target.accountId, target.generation).run();
  await reconcileDeletion(env, target);
  return { visited: 1 };
}
