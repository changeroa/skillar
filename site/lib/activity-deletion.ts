import { z } from "zod";
import {
  DELETION_BACKUP_HORIZON_MS, deletionRequestSchema, deletionServicePath,
  deletionStateSchema, deletionStatusSchema,
} from "../../shared/dist/activity-deletion.js";
import { accountIdSchema } from "../../shared/dist/activity-schema.js";
import { readSession } from "./auth.ts";
import { activityConfig, activityError, noStore } from "./activity-auth.ts";
import type { ActivityEnv } from "./activity-auth.ts";
import { readBody } from "./activity-body.ts";

const ownerSchema = z.object({
  account_id: accountIdSchema, auth_generation: z.number().int().positive().safe(),
  state: z.enum(["active", "revoked"]),
});
const statusRowSchema = z.object({
  generation: z.number().int().positive().safe(), state: deletionStateSchema,
  requested_at_ms: z.number().int(), access_revoked_at_ms: z.number().int().nullable(),
  live_purge_at_ms: z.number().int().nullable(), backup_expires_at_ms: z.number().int(),
});

/** Google identity stays usable to inspect/retry deletion of remote data. */
export async function activityDeletionRequest(request: Request, env: ActivityEnv): Promise<Response> {
  if (env.ACTIVITY_ENABLED !== "true") return activityError(404, "not_found");
  const config = activityConfig(request, env);
  if (config === null) return activityError(403, "invalid_host");
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== config.PUBLIC_ORIGIN ||
      request.method === "POST" && origin !== config.PUBLIC_ORIGIN) {
    return activityError(403, "invalid_origin");
  }
  if (request.method !== "GET" && request.method !== "POST") return activityError(405, "method_not_allowed");
  const now = Date.now(), seconds = Math.floor(now / 1000);
  const session = await readSession(request, config, seconds);
  if (session === null) return activityError(401, "unauthorized");
  const found = await env.ACCOUNTS.prepare(`SELECT a.account_id,a.auth_generation,a.state
    FROM accounts a JOIN sessions s ON s.user_sub=a.user_sub
    WHERE s.id=? AND s.user_sub=? AND s.expires_at>?`)
    .bind(session.sid, session.sub, seconds).first();
  if (found === null) return activityError(404, "not_found");
  const owner = ownerSchema.parse(found);
  if (request.method === "POST") {
    const input = deletionRequestSchema.parse(await readBody(request, 1024));
    if (owner.state === "active" && input.generation !== owner.auth_generation ||
        owner.state === "revoked" && input.generation >= owner.auth_generation) {
      return activityError(409, "generation_conflict");
    }
    const identity = [owner.account_id, input.generation] as const;
    const exists = `EXISTS(SELECT 1 FROM activity_deletions WHERE account_id=? AND generation=?)`;
    await env.ACCOUNTS.batch([
      env.ACCOUNTS.prepare(`INSERT INTO activity_deletions
        (account_id,generation,requested_at_ms,last_copy_at_ms,backup_expires_at_ms,state)
        SELECT account_id,auth_generation,?,?,?,'requested' FROM accounts
        WHERE account_id=? AND auth_generation=? AND state='active'
          AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_sub=accounts.user_sub AND expires_at>?)
        ON CONFLICT(account_id,generation) DO NOTHING`)
        .bind(now, now, now + DELETION_BACKUP_HORIZON_MS, ...identity, session.sid, seconds),
      env.ACCOUNTS.prepare(`UPDATE accounts SET state='revoked',auth_generation=auth_generation+1
        WHERE account_id=? AND auth_generation=? AND ${exists}`).bind(...identity, ...identity),
      env.ACCOUNTS.prepare(`UPDATE api_tokens SET revoked_at=COALESCE(revoked_at,?)
        WHERE account_id=? AND auth_generation<=? AND ${exists}`)
        .bind(seconds, ...identity, ...identity),
      env.ACCOUNTS.prepare(`DELETE FROM device_grants WHERE account_id=? AND auth_generation<=? AND ${exists}`)
        .bind(...identity, ...identity),
      env.ACCOUNTS.prepare(`UPDATE devices SET revoked_at=COALESCE(revoked_at,?)
        WHERE account_id=? AND ${exists}`).bind(seconds, owner.account_id, ...identity),
      env.ACCOUNTS.prepare(`UPDATE mcp_connections SET revoked_at=COALESCE(revoked_at,?),
        oauth_cleanup_pending=CASE WHEN kind='oauth' THEN 1 ELSE oauth_cleanup_pending END,name=''
        WHERE account_id=? AND auth_generation<=? AND ${exists}`).bind(seconds, ...identity, ...identity),
      env.ACCOUNTS.prepare(`UPDATE mcp_credentials SET revoked_at=COALESCE(revoked_at,?)
        WHERE connection_id IN(SELECT connection_id FROM mcp_connections
          WHERE account_id=? AND auth_generation<=?) AND ${exists}`)
        .bind(seconds, ...identity, ...identity),
      env.ACCOUNTS.prepare(`DELETE FROM mcp_consents WHERE account_id=? AND auth_generation<=? AND ${exists}`)
        .bind(...identity, ...identity),
      env.ACCOUNTS.prepare(`DELETE FROM device_consents WHERE account_id=? AND generation<=? AND ${exists}`)
        .bind(...identity, ...identity),
      env.ACCOUNTS.prepare(`DELETE FROM account_control_outbox WHERE account_id=? AND generation<=? AND ${exists}`)
        .bind(...identity, ...identity),
    ]);
    if (env.ACTIVITY_SERVICE !== undefined) {
      const response = await env.ACTIVITY_SERVICE.fetch(`https://activity.internal${deletionServicePath}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: owner.account_id, generation: input.generation }),
      });
      if (!response.ok) return activityError(503, "deletion_pending");
    }
  }
  const row = await env.ACCOUNTS.prepare(`SELECT * FROM activity_deletions
    WHERE account_id=? ORDER BY generation DESC LIMIT 1`).bind(owner.account_id).first();
  if (row === null) return Response.json({ deletion: null }, { headers: noStore });
  const saved = statusRowSchema.parse(row);
  const deletion = deletionStatusSchema.parse({
    generation: saved.generation, state: saved.state, requestedAtMs: saved.requested_at_ms,
    accessRevokedAtMs: saved.access_revoked_at_ms, livePurgeAtMs: saved.live_purge_at_ms,
    backupExpiresAtMs: saved.backup_expires_at_ms, physicalPending: saved.state !== "backup_expired",
    localCopies: "not_deleted", externalCopies: "not_controlled",
  });
  return Response.json({ deletion }, {
    status: request.method === "POST" ? 202 : 200, headers: noStore,
  });
}
