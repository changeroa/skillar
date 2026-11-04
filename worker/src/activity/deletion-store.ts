// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { accountIdSchema } from "../../../shared/activity-schema.ts";
import { deletionStateSchema } from "../../../shared/activity-deletion.ts";
import type { DeletionTarget } from "../../../shared/activity-deletion.ts";

export const deletionRowSchema = z.object({
  account_id: accountIdSchema,
  generation: z.number().int().positive().safe(),
  requested_at_ms: z.number().int(),
  access_revoked_at_ms: z.number().int().nullable(),
  live_purge_at_ms: z.number().int().nullable(),
  last_copy_at_ms: z.number().int(),
  backup_expires_at_ms: z.number().int(),
  state: deletionStateSchema,
});
export type DeletionRow = z.infer<typeof deletionRowSchema>;

/** A closed generation, not a serialized caller principal, authorizes cleanup. */
export async function storedDeletion(
  accounts: D1Database, target: DeletionTarget,
): Promise<DeletionRow | null> {
  const row = await accounts.prepare(`SELECT l.* FROM activity_deletions l
    WHERE l.account_id=? AND l.generation=? AND NOT EXISTS(
      SELECT 1 FROM accounts a WHERE a.account_id=l.account_id
        AND (a.state!='revoked' OR a.auth_generation<=l.generation))`)
    .bind(target.accountId, target.generation).first();
  return row === null ? null : deletionRowSchema.parse(row);
}

/** Reapply the current ledger before reopening a restored primary/shard. */
export async function reapplyPrimaryDeletion(
  accounts: D1Database, target: DeletionTarget, nowMs: number,
): Promise<void> {
  const exists = await accounts.prepare(`SELECT 1 FROM activity_deletions
    WHERE account_id=? AND generation=?`).bind(target.accountId, target.generation).first();
  if (exists === null) return;
  const seconds = Math.floor(nowMs / 1000);
  const args = [target.accountId, target.generation] as const;
  await accounts.batch([
    accounts.prepare(`UPDATE accounts SET state='revoked',auth_generation=MAX(auth_generation,?)
      WHERE account_id=?`).bind(target.generation + 1, target.accountId),
    accounts.prepare(`UPDATE api_tokens SET revoked_at=COALESCE(revoked_at,?)
      WHERE account_id=? AND auth_generation<=?`).bind(seconds, ...args),
    accounts.prepare(`UPDATE devices SET revoked_at=COALESCE(revoked_at,?)
      WHERE account_id=?`).bind(seconds, target.accountId),
    accounts.prepare(`DELETE FROM device_grants WHERE account_id=? AND auth_generation<=?`).bind(...args),
    accounts.prepare(`DELETE FROM device_consents WHERE account_id=? AND generation<=?`).bind(...args),
    accounts.prepare(`DELETE FROM mcp_consents WHERE account_id=? AND auth_generation<=?`).bind(...args),
    accounts.prepare(`UPDATE mcp_connections SET revoked_at=COALESCE(revoked_at,?),name='',
      oauth_cleanup_pending=CASE WHEN kind='oauth' THEN 1 ELSE oauth_cleanup_pending END
      WHERE account_id=? AND auth_generation<=?`).bind(seconds, ...args),
    accounts.prepare(`UPDATE mcp_credentials SET revoked_at=COALESCE(revoked_at,?)
      WHERE connection_id IN(SELECT connection_id FROM mcp_connections
        WHERE account_id=? AND auth_generation<=?)`).bind(seconds, ...args),
  ]);
}
