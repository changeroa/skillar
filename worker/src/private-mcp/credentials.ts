// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { mcpClaimsSchema, mcpScopeSchema } from "../../../shared/mcp-auth.ts";
import type { McpConnectionId } from "../../../shared/mcp-auth.ts";
import { sha256 } from "./hash.ts";
import type { McpAuthEnv } from "./contracts.ts";

const credentialSchema = mcpClaimsSchema.unwrap().extend({
  kind: z.enum(["access", "refresh"]), clientId: z.string(),
  scopesJson: z.string(), expiresAt: z.number(), revokedAt: z.number().nullable(),
  connectionActive: z.union([z.literal(0), z.literal(1)]),
}).readonly();
export type McpCredential = z.infer<typeof credentialSchema>;
export const credentialScopesSchema = z.array(mcpScopeSchema).readonly();

export async function credentialRecord(env: McpAuthEnv, tokenHash: string): Promise<McpCredential | null> {
  const now = Math.floor(Date.now() / 1000);
  const value = await env.ACCOUNTS.prepare(`SELECT t.kind,c.connection_id AS connectionId,
    c.account_id AS accountId,c.auth_generation AS generation,c.client_id AS clientId,
    t.scopes_json AS scopesJson,t.expires_at AS expiresAt,t.revoked_at AS revokedAt,
    CASE WHEN a.state='active' AND a.auth_generation=c.auth_generation
      AND c.revoked_at IS NULL AND c.expires_at>? AND d.revoked_at IS NULL
      THEN 1 ELSE 0 END AS connectionActive
    FROM mcp_credentials t JOIN mcp_connections c ON c.connection_id=t.connection_id
    JOIN accounts a ON a.account_id=c.account_id
    JOIN devices d ON d.account_id=c.account_id AND d.device_id=c.device_id
    WHERE t.token_hash=? AND c.kind='oauth'`).bind(now, tokenHash).first();
  return value === null ? null : credentialSchema.parse(value);
}
export function liveCredential(
  value: McpCredential | null, kind: "access" | "refresh",
): value is McpCredential {
  return value !== null && value.kind === kind && value.connectionActive === 1 &&
    value.revokedAt === null && value.expiresAt > Math.floor(Date.now() / 1000);
}

type CredentialIssue = {
  readonly connectionId: McpConnectionId;
  readonly accessToken: string;
  readonly accessExpiresAt: number;
  readonly connectionExpiresAt: number;
  readonly scopes: readonly string[];
  readonly refreshToken?: string;
  readonly previousRefreshToken?: string;
};
export async function storeCredentials(env: McpAuthEnv, issue: CredentialIssue): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const scopes = JSON.stringify(credentialScopesSchema.parse(issue.scopes));
  const accessHash = await sha256(issue.accessToken);
  const statements = [
    env.ACCOUNTS.prepare(`INSERT INTO mcp_credentials
      (token_hash,connection_id,kind,scopes_json,created_at,expires_at)
      VALUES(?,?,'access',?,?,?)`)
      .bind(accessHash, issue.connectionId, scopes, now,
        Math.min(issue.accessExpiresAt, issue.connectionExpiresAt)),
  ];
  if (issue.refreshToken !== undefined) {
    statements.push(env.ACCOUNTS.prepare(`INSERT INTO mcp_credentials
      (token_hash,connection_id,kind,scopes_json,created_at,expires_at)
      VALUES(?,?,'refresh',?,?,?) ON CONFLICT(token_hash) DO UPDATE SET
      expires_at=excluded.expires_at`)
      .bind(await sha256(issue.refreshToken), issue.connectionId, scopes, now, issue.connectionExpiresAt));
  }
  if (issue.previousRefreshToken !== undefined && issue.previousRefreshToken !== issue.refreshToken) {
    statements.push(env.ACCOUNTS.prepare(`UPDATE mcp_credentials SET revoked_at=COALESCE(revoked_at,?)
      WHERE connection_id=? AND token_hash=? AND kind='refresh'`)
      .bind(now, issue.connectionId, await sha256(issue.previousRefreshToken)));
  }
  await env.ACCOUNTS.batch(statements);
}

/** Called only after the provider authenticated this client's revocation request. */
export async function revokeCredential(
  env: McpAuthEnv, input: { readonly token: string; readonly clientId: string },
): Promise<void> {
  const hash = await sha256(input.token), row = await credentialRecord(env, hash);
  if (row === null || row.clientId !== input.clientId) return;
  const now = Math.floor(Date.now() / 1000);
  switch (row.kind) {
    case "access":
      await env.ACCOUNTS.prepare(`UPDATE mcp_credentials SET revoked_at=COALESCE(revoked_at,?)
        WHERE token_hash=?`).bind(now, hash).run();
      return;
    case "refresh":
      await env.ACCOUNTS.batch([
        env.ACCOUNTS.prepare(`UPDATE mcp_connections SET revoked_at=COALESCE(revoked_at,?)
          WHERE connection_id=?`).bind(now, row.connectionId),
        env.ACCOUNTS.prepare(`UPDATE devices SET revoked_at=COALESCE(revoked_at,?)
          WHERE account_id=? AND device_id=(SELECT device_id FROM mcp_connections WHERE connection_id=?)`)
          .bind(now, row.accountId, row.connectionId),
        env.ACCOUNTS.prepare(`UPDATE mcp_credentials SET revoked_at=COALESCE(revoked_at,?)
          WHERE connection_id=?`).bind(now, row.connectionId),
      ]);
      return;
    default: {
      const exhaustive: never = row.kind;
      return exhaustive;
    }
  }
}
