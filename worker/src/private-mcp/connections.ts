// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { deviceIdSchema } from "../../../shared/activity-schema.ts";
import {
  mcpConnectionIdSchema, mcpConnectionSummarySchema, mcpContextSchema,
  mcpScopeSchema,
} from "../../../shared/mcp-auth.ts";
import type { McpClaims, McpConnectionSummary, McpContext } from "../../../shared/mcp-auth.ts";
import { authority, requireAuthority } from "../private-skills/authority.ts";
import { mcpSourceStatements } from "./telemetry-source.ts";
import { McpAuthError } from "./contracts.ts";
import type { McpAuthEnv, McpBrowserPrincipal } from "./contracts.ts";

const rowSchema = mcpConnectionSummarySchema.unwrap().omit({
  scopes: true, recordActivity: true,
}).extend({
  accountId: z.string(), generation: z.number().int().positive(),
  deviceId: deviceIdSchema, clientId: z.string().nullable(),
  grantId: z.string().nullable(), scopesJson: z.string(),
  recordActivity: z.union([z.literal(0), z.literal(1)]),
}).readonly();
type ConnectionRow = z.infer<typeof rowSchema>;
const columns = `c.connection_id AS connectionId,c.kind,c.name,c.account_id AS accountId,
  c.auth_generation AS generation,c.device_id AS deviceId,c.client_id AS clientId,
  c.oauth_grant_id AS grantId,c.scopes_json AS scopesJson,c.record_activity AS recordActivity,
  c.created_at AS createdAt,c.expires_at AS expiresAt,c.revoked_at AS revokedAt`;
const active = `FROM mcp_connections c JOIN accounts a ON a.account_id=c.account_id
  JOIN devices d ON d.account_id=c.account_id AND d.device_id=c.device_id
  WHERE a.state='active' AND a.auth_generation=c.auth_generation
  AND c.revoked_at IS NULL AND d.revoked_at IS NULL AND c.expires_at>?`;
const scopesSchema = z.array(mcpScopeSchema).min(1).readonly();

export function opaqueMcpToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export function connectionSummary(row: ConnectionRow): McpConnectionSummary {
  return mcpConnectionSummarySchema.parse({
    connectionId: row.connectionId, kind: row.kind, name: row.name,
    scopes: scopesSchema.parse(JSON.parse(row.scopesJson)),
    recordActivity: row.recordActivity === 1, createdAt: row.createdAt,
    expiresAt: row.expiresAt, revokedAt: row.revokedAt,
  });
}
export async function listConnections(env: McpAuthEnv, browser: McpBrowserPrincipal) {
  await requireAuthority(env, browser, "skills:read");
  const result = await env.ACCOUNTS.prepare(`SELECT ${columns} FROM mcp_connections c
    WHERE c.account_id=? ORDER BY c.created_at DESC,c.connection_id`).bind(browser.accountId).all();
  await requireAuthority(env, browser, "skills:read");
  return {
    resource: `${env.PUBLIC_ORIGIN}/mcp`,
    connections: result.results.map(value => connectionSummary(rowSchema.parse(value))),
  };
}

type NewConnection = {
  readonly kind: "oauth"; readonly clientId: string; readonly name: string;
  readonly scopes: readonly z.infer<typeof mcpScopeSchema>[];
  readonly recordActivity: boolean;
} | {
  readonly kind: "pat"; readonly tokenHash: string; readonly name: string;
  readonly expiresInDays: number; readonly recordActivity: boolean;
};
export async function createConnection(
  env: McpAuthEnv, browser: McpBrowserPrincipal, input: NewConnection,
): Promise<McpConnectionSummary> {
  await requireAuthority(env, browser, "skills:read");
  const now = Math.floor(Date.now() / 1000);
  const connectionId = mcpConnectionIdSchema.parse(crypto.randomUUID());
  const deviceId = deviceIdSchema.parse(opaqueMcpToken());
  let scopes: readonly z.infer<typeof mcpScopeSchema>[], days: number;
  let clientId: string | null, tokenHash: string | null;
  switch (input.kind) {
    case "oauth":
      scopes = input.scopes; days = 30; clientId = input.clientId; tokenHash = null;
      break;
    case "pat":
      scopes = ["skills:read", ...(input.recordActivity ? ["activity:record"] as const : [])];
      days = input.expiresInDays; clientId = null; tokenHash = input.tokenHash;
      break;
    default: {
      const exhaustive: never = input;
      return exhaustive;
    }
  }
  const expiresAt = now + days * 86400;
  const fence = authority(browser, "skills:read");
  const results = await env.ACCOUNTS.batch([
    ...mcpSourceStatements(env.ACCOUNTS, {
      accountId: browser.accountId, deviceId, recordActivity: input.recordActivity, now: now * 1000,
    }),
    env.ACCOUNTS.prepare(`INSERT INTO mcp_connections(
      connection_id,account_id,auth_generation,device_id,kind,name,client_id,token_hash,
      scopes_json,record_activity,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(${fence.sql})`)
      .bind(connectionId, browser.accountId, browser.generation, deviceId, input.kind, input.name,
        clientId, tokenHash, JSON.stringify(scopes),
        input.recordActivity ? 1 : 0, now, expiresAt, ...fence.args),
  ]);
  if ((results.at(-1)?.meta.changes ?? 0) === 0) throw new McpAuthError(401, "unauthorized");
  return mcpConnectionSummarySchema.parse({
    connectionId, kind: input.kind, name: input.name, scopes,
    recordActivity: input.recordActivity, createdAt: now, expiresAt, revokedAt: null,
  });
}

export async function activeConnection(
  env: McpAuthEnv,
  lookup: { readonly kind: "oauth"; readonly claims: McpClaims } |
    { readonly kind: "pat"; readonly tokenHash: string },
): Promise<ConnectionRow | null> {
  const now = Math.floor(Date.now() / 1000);
  let row: unknown;
  switch (lookup.kind) {
    case "oauth":
      row = await env.ACCOUNTS.prepare(`SELECT ${columns} ${active}
        AND c.kind='oauth' AND c.connection_id=? AND c.account_id=? AND c.auth_generation=?`)
        .bind(now, lookup.claims.connectionId, lookup.claims.accountId, lookup.claims.generation).first();
      break;
    case "pat":
      row = await env.ACCOUNTS.prepare(`SELECT ${columns} ${active}
        AND c.kind='pat' AND c.token_hash=?`).bind(now, lookup.tokenHash).first();
      break;
    default: {
      const exhaustive: never = lookup;
      return exhaustive;
    }
  }
  return row === null ? null : rowSchema.parse(row);
}
export function connectionContext(
  env: McpAuthEnv, row: ConnectionRow,
  credential: { readonly scopes: readonly string[]; readonly tokenHash: string },
): McpContext {
  const allowed = scopesSchema.parse(JSON.parse(row.scopesJson));
  const scopes = allowed.filter(scope => credential.scopes.includes(scope));
  return mcpContextSchema.parse({
    principal: {
      kind: "mcp", accountId: row.accountId, generation: row.generation,
      shardId: "activity-00", issuer: env.PUBLIC_ORIGIN,
      scopes: scopes.filter(scope => scope === "skills:read"),
      deviceId: row.deviceId, sessionId: null, tokenHash: credential.tokenHash, connectionId: row.connectionId,
    },
    clientName: row.name,
    recordActivity: row.recordActivity === 1 && scopes.includes("activity:record"),
  });
}
export async function revokeConnection(
  env: McpAuthEnv, browser: McpBrowserPrincipal, connectionId: string,
): Promise<{ readonly grantId: string | null }> {
  await requireAuthority(env, browser, "skills:read");
  const row = await env.ACCOUNTS.prepare(`SELECT ${columns} FROM mcp_connections c
    WHERE c.account_id=? AND c.connection_id=?`).bind(browser.accountId, connectionId).first();
  if (row === null) throw new McpAuthError(404, "not_found");
  const connection = rowSchema.parse(row), now = Math.floor(Date.now() / 1000);
  const fence = authority(browser, "skills:read");
  const results = await env.ACCOUNTS.batch([
    env.ACCOUNTS.prepare(`UPDATE mcp_connections SET revoked_at=COALESCE(revoked_at,?),
      oauth_cleanup_pending=CASE WHEN oauth_grant_id IS NULL THEN 0 ELSE 1 END
      WHERE account_id=? AND connection_id=? AND EXISTS(${fence.sql})`)
      .bind(now, browser.accountId, connectionId, ...fence.args),
    env.ACCOUNTS.prepare(`UPDATE devices SET revoked_at=COALESCE(revoked_at,?)
      WHERE account_id=? AND device_id=? AND EXISTS(${fence.sql})`)
      .bind(now, browser.accountId, connection.deviceId, ...fence.args),
    env.ACCOUNTS.prepare(`UPDATE mcp_credentials SET revoked_at=COALESCE(revoked_at,?)
      WHERE connection_id=? AND EXISTS(${fence.sql})`)
      .bind(now, connectionId, ...fence.args),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) throw new McpAuthError(401, "unauthorized");
  return { grantId: connection.grantId };
}
