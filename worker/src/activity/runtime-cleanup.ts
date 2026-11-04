import { z } from "zod";
import { accountIdSchema, deviceIdSchema, ActivityContractError } from "../../../shared/activity-schema.ts";
import { ContentConsentError } from "./content-consent.ts";
import type { ContentEnv } from "./content-env.ts";
import { requireRuntimeReadable } from "./runtime-api.ts";
import { runtimeRowSchema, RuntimeError } from "./runtime-store.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";

/**
 * Bounded, rotating scan of committed runtime objects, including terminal intents.
 * Retain immutable runtime receipts (sequence, batch and exact payload hashes) and
 * P5 upload intents forever: they fence retries and rediscover arbitrarily late PUTs.
 * Only encrypted R2 bytes are removed; shared account keys are not runtime-owned.
 */
export async function sweepRuntimeContexts(
  env: ContentEnv, options: { readonly limit?: number; readonly now?: () => number } = {},
): Promise<{ readonly scanned: number; readonly deleted: number }> {
  const limit = z.number().int().min(1).max(1000).parse(options.limit ?? 100);
  const rows = await env.ACTIVITY.prepare(`SELECT r.*,u.object_key,u.state AS upload_state
    FROM content_uploads u JOIN runtime_contexts r
      ON r.account_id=u.account_id AND r.generation=u.generation AND r.device_id=u.device_id
      AND r.source_domain=u.source_domain AND r.batch_id=u.batch_id
    ORDER BY u.purge_order,u.object_key LIMIT ?`).bind(limit).all();
  const candidates = z.array(runtimeRowSchema.extend({
    account_id: accountIdSchema, device_id: deviceIdSchema, generation: z.number().int().positive(),
    object_key: z.string(), upload_state: z.string(),
  })).parse(rows.results);
  let deleted = 0;
  for (const row of candidates) {
    const principal: IngestPrincipal = {
      kind: "device", accountId: row.account_id, deviceId: row.device_id,
      generation: row.generation, shardId: "activity-00", scopes: ["activity:read"],
    };
    let remove = row.upload_state === "purged" || row.upload_state === "purging";
    if (!remove) {
      try {
        await requireRuntimeReadable(env, principal, row, options.now?.() ?? Date.now());
      } catch (error) {
        if (error instanceof ContentConsentError || error instanceof ActivityContractError ||
            (error instanceof ActivityLedgerError && error.code === "tenant_fenced") ||
            (error instanceof RuntimeError && error.code === "runtime_missing")) remove = true;
        else throw error;
      }
    }
    if (remove) {
      // Direct terminal transition is intentional: runtime_upload_pin prevents
      // P5 orphan claims, not retirement by the runtime retention owner.
      await env.ACTIVITY.prepare("UPDATE content_uploads SET state='purged' WHERE object_key=?")
        .bind(row.object_key).run();
      await env.ACTIVITY_RAW.delete(row.object_key);
      deleted++;
    }
    // Rotate live rows too, so a bounded scan cannot starve another source or
    // device. Failed DELETEs keep their position and are retried on the next run.
    await env.ACTIVITY.prepare(`UPDATE content_uploads
      SET purge_order=(SELECT COALESCE(MAX(purge_order),0)+1 FROM content_uploads)
      WHERE object_key=?`).bind(row.object_key).run();
  }
  return { scanned: candidates.length, deleted };
}
