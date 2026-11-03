// SPDX-License-Identifier: AGPL-3.0-only
import { privateSkillPrincipalSchema } from "../../../shared/private-skills.ts";
import type { PrivateSkillPrincipal } from "../../../shared/private-skills.ts";
import { isDeploymentOrigin } from "../../../shared/deployment-origin.ts";
import { PrivateSkillError } from "./contracts.ts";
import type { PrivateSkillsEnv } from "./contracts.ts";

export type PrivateScope = "skills:read" | "skills:write";
export function requestPrincipal(request: Request, env: PrivateSkillsEnv): PrivateSkillPrincipal {
  const url = new URL(request.url);
  if (url.origin !== "https://activity.internal" || url.username || url.password) {
    throw new PrivateSkillError(404, "not_found");
  }
  const raw = request.headers.get("x-skillar-principal");
  if (raw === null) throw new PrivateSkillError(401, "unauthorized");
  const principal = privateSkillPrincipalSchema.parse(JSON.parse(raw));
  if (!isDeploymentOrigin(principal.issuer, env)) throw new PrivateSkillError(403, "invalid_issuer");
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== principal.issuer) throw new PrivateSkillError(403, "invalid_origin");
  return principal;
}

/** This predicate also runs inside the final primary mutation transaction. */
export function authority(principal: PrivateSkillPrincipal, scope: PrivateScope) {
  if (!principal.scopes.includes(scope)) throw new PrivateSkillError(403, "insufficient_scope");
  const account = `SELECT 1 FROM accounts a WHERE a.account_id=? AND a.auth_generation=?
    AND a.shard_id=? AND a.state='active'`;
  const args = [principal.accountId, principal.generation, principal.shardId] as const;
  switch (principal.kind) {
    case "browser":
      return {
        sql: `${account} AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_sub=a.user_sub
          AND s.id=? AND s.expires_at>?)`,
        args: [...args, principal.sessionId, Date.now() / 1000],
      };
    case "device":
      return {
        sql: `${account} AND EXISTS(SELECT 1 FROM api_tokens t JOIN devices d
          ON d.account_id=t.account_id AND d.device_id=t.device_id
          WHERE t.account_id=a.account_id AND t.auth_generation=a.auth_generation
          AND t.device_id=? AND t.token_hash=? AND t.issuer=? AND t.audience='skillar:activity'
          AND t.expires_at>? AND t.revoked_at IS NULL AND d.revoked_at IS NULL
          AND json_type(CASE WHEN json_valid(t.scopes_json) THEN t.scopes_json ELSE 'null' END)='array'
          AND EXISTS(SELECT 1 FROM json_each(
            CASE WHEN json_valid(t.scopes_json) THEN t.scopes_json ELSE '[]' END)
            WHERE type='text' AND value=?)
          AND NOT EXISTS(SELECT 1 FROM json_each(
            CASE WHEN json_valid(t.scopes_json) THEN t.scopes_json ELSE '[]' END)
            WHERE type!='text' OR value NOT IN ('activity:read','activity:ingest','skills:read','skills:write')))`,
        args: [...args, principal.deviceId, principal.tokenHash, principal.issuer, Date.now() / 1000, scope],
      };
    case "mcp":
      return {
        sql: `${account} AND EXISTS(SELECT 1 FROM mcp_connections c JOIN devices d
          ON d.account_id=c.account_id AND d.device_id=c.device_id
          WHERE c.account_id=a.account_id AND c.auth_generation=a.auth_generation
          AND c.connection_id=? AND c.device_id=? AND c.revoked_at IS NULL
          AND c.expires_at>? AND d.revoked_at IS NULL
          AND ((c.kind='pat' AND c.token_hash=?) OR
            (c.kind='oauth' AND EXISTS(SELECT 1 FROM mcp_credentials t
              WHERE t.connection_id=c.connection_id AND t.token_hash=?
              AND t.kind='access' AND t.revoked_at IS NULL AND t.expires_at>?
              AND EXISTS(SELECT 1 FROM json_each(t.scopes_json) WHERE type='text' AND value=?))))
          AND json_type(c.scopes_json)='array'
          AND EXISTS(SELECT 1 FROM json_each(c.scopes_json) WHERE type='text' AND value=?)
          AND NOT EXISTS(SELECT 1 FROM json_each(c.scopes_json)
            WHERE type!='text' OR value NOT IN ('skills:read','activity:record','offline_access')))`,
        args: [...args, principal.connectionId, principal.deviceId, Date.now() / 1000,
          principal.tokenHash, principal.tokenHash, Date.now() / 1000, scope, scope],
      };
    default: {
      const exhaustive: never = principal;
      return exhaustive;
    }
  }
}
export async function requireAuthority(
  env: Pick<PrivateSkillsEnv, "ACCOUNTS">, principal: PrivateSkillPrincipal, scope: PrivateScope,
): Promise<void> {
  const fence = authority(principal, scope);
  if (await env.ACCOUNTS.prepare(fence.sql).bind(...fence.args).first() === null) {
    throw new PrivateSkillError(401, "unauthorized");
  }
}
