import { z } from "zod";
import { accountIdSchema, ActivityContractError, deviceIdSchema } from "../../../shared/activity-schema.ts";
import { ContentConsentError } from "./content-consent.ts";
import type { ContentEnv } from "./content-env.ts";
import { ActivityLedgerError } from "./types.ts";
import { CommandError, commandGrant, commandRowSchema } from "./commands-store.ts";

/**
 * Bounded P14 hook. Rotate every inspected descriptor, including retained ones.
 * Never delete the D1 row: a timed-out R2 PUT can arrive after an earlier purge,
 * and successful source cuts must survive content expiry.
 */
export async function sweepCommands(env: ContentEnv, options: { readonly limit?: number; readonly now?: number } = {}) {
  const limit = z.number().int().min(1).max(1000).parse(options.limit ?? 100);
  const now = z.number().int().parse(options.now ?? Date.now());
  const rows = z.array(commandRowSchema).parse((await env.ACTIVITY.prepare(
    "SELECT * FROM connector_commands ORDER BY purge_order,object_key LIMIT ?",
  ).bind(limit).all()).results);
  let deleted = 0;
  for (const row of rows) {
    let retained = true;
    try {
      await commandGrant(env, {
        kind: "device", accountId: accountIdSchema.parse(row.account_id), generation: row.generation,
        deviceId: deviceIdSchema.parse(row.device_id), shardId: "activity-00", scopes: ["activity:read"],
      }, row, now);
    } catch (error) {
      if (error instanceof ContentConsentError || error instanceof ActivityContractError ||
          error instanceof ActivityLedgerError ||
          error instanceof CommandError && error.code === "command_expired") {
        retained = false;
      } else { throw error; }
    }
    if (!retained) {
      // Claim before R2 DELETE; publishers can never transition out of purging.
      await env.ACTIVITY.prepare("UPDATE connector_commands SET state='purging' WHERE object_key=?")
        .bind(row.object_key).run();
      await env.ACTIVITY_RAW.delete(row.result_object_key === null
        ? [row.object_key] : [row.object_key, row.result_object_key]);
      await env.ACTIVITY.prepare("UPDATE connector_commands SET state='purged' WHERE object_key=?")
        .bind(row.object_key).run();
      deleted++;
    }
    await env.ACTIVITY.prepare(`UPDATE connector_commands
      SET purge_order=(SELECT COALESCE(MAX(purge_order),0)+1 FROM connector_commands) WHERE object_key=?`)
      .bind(row.object_key).run();
  }
  return { inspected: rows.length, deleted };
}
