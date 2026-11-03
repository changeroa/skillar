import { z } from "zod";
import { AuthenticationError, pkceChallenge, randomToken } from "./auth.ts";
import {
  ACTIVITY_AUDIENCE, activityConfig, activityScopeSchema, browserPrincipalSchema,
  devicePrincipalSchema, validActivityOrigin,
} from "./activity-auth.ts";
import type { ActivityEnv, BrowserPrincipal, DevicePrincipal } from "./activity-auth.ts";

const deviceScopes = z.array(activityScopeSchema.exclude(["device:manage"])).min(1).readonly();
const credentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const exchangeRowSchema = devicePrincipalSchema.unwrap().pick({ deviceId: true }).extend({
  expiresAt: z.number().int().positive(),
});
const liveBrowser = `SELECT 1 FROM accounts a JOIN sessions s ON s.user_sub=a.user_sub
  WHERE a.account_id=? AND a.auth_generation=? AND a.state='active'
  AND s.id=? AND s.expires_at>?`;
// Reject malformed JSON and management scopes inside the atomic exchange too.
const grantScopes = `json_valid(g.scopes_json)
  AND json_type(CASE WHEN json_valid(g.scopes_json) THEN g.scopes_json ELSE 'null' END)='array'
  AND json_array_length(CASE WHEN json_valid(g.scopes_json) THEN g.scopes_json ELSE '[]' END)>0
  AND NOT EXISTS (SELECT 1 FROM json_each(
    CASE WHEN json_valid(g.scopes_json) THEN g.scopes_json ELSE '[]' END)
    WHERE type!='text' OR value NOT IN ('activity:read','activity:ingest'))`;

function managementPrincipal(principal: BrowserPrincipal): BrowserPrincipal {
  const parsed = browserPrincipalSchema.safeParse(principal);
  if (!parsed.success || !parsed.data.scopes.includes("device:manage")) throw new AuthenticationError();
  return parsed.data;
}

export async function issueDeviceGrant(
  principal: BrowserPrincipal,
  scopes: readonly ("activity:read" | "activity:ingest")[],
  env: ActivityEnv,
): Promise<{ grant: string; deviceId: string; expiresAt: number }> {
  const browser = managementPrincipal(principal);
  const allowed = deviceScopes.parse(scopes);
  const grant = randomToken();
  const deviceId = randomToken();
  const hash = await pkceChallenge(grant);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 600;
  const live = [browser.accountId, browser.generation, browser.sessionId, now];
  const results = await env.ACCOUNTS.batch([
    env.ACCOUNTS.prepare(`INSERT INTO devices(account_id,device_id,created_at)
      SELECT ?,?,? WHERE EXISTS (${liveBrowser})`)
      .bind(browser.accountId, deviceId, now, ...live),
    env.ACCOUNTS.prepare(`INSERT INTO device_grants
      (grant_hash,account_id,device_id,session_id,scopes_json,issuer,audience,auth_generation,expires_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (${liveBrowser})
      AND EXISTS (SELECT 1 FROM devices WHERE account_id=? AND device_id=? AND revoked_at IS NULL)`)
      .bind(hash, browser.accountId, deviceId, browser.sessionId, JSON.stringify(allowed),
        browser.issuer, ACTIVITY_AUDIENCE, browser.generation, expiresAt,
        ...live, browser.accountId, deviceId),
  ]);
  if (results[1]?.meta.changes !== 1) throw new AuthenticationError();
  return { grant, deviceId, expiresAt };
}

export async function exchangeDeviceGrant(
  grant: string, env: ActivityEnv, issuer: string,
): Promise<{ token: string; deviceId: string; expiresAt: number } | null> {
  if (!credentialSchema.safeParse(grant).success || !z.url().safeParse(issuer).success) return null;
  const config = activityConfig(new Request(issuer), env);
  if (config === null || config.PUBLIC_ORIGIN !== issuer) return null;
  const token = randomToken();
  const tokenHash = await pkceChallenge(token);
  const grantHash = await pkceChallenge(grant);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 30 * 24 * 60 * 60;
  const results = await env.ACCOUNTS.batch([
    env.ACCOUNTS.prepare(`INSERT INTO api_tokens
      (token_hash,account_id,device_id,scopes_json,issuer,audience,auth_generation,expires_at)
      SELECT ?,g.account_id,g.device_id,g.scopes_json,g.issuer,g.audience,g.auth_generation,?
      FROM device_grants g JOIN accounts a ON a.account_id=g.account_id
      JOIN sessions s ON s.id=g.session_id AND s.user_sub=a.user_sub
      JOIN devices d ON d.account_id=g.account_id AND d.device_id=g.device_id
      WHERE g.grant_hash=? AND g.consumed_at IS NULL AND g.expires_at>?
      AND s.expires_at>? AND a.state='active' AND a.auth_generation=g.auth_generation
      AND d.revoked_at IS NULL AND g.issuer=? AND g.audience=? AND ${grantScopes}
      RETURNING device_id AS deviceId, expires_at AS expiresAt`)
      .bind(tokenHash, expiresAt, grantHash, now, now, issuer, ACTIVITY_AUDIENCE),
    env.ACCOUNTS.prepare(`UPDATE device_grants SET consumed_at=?
      WHERE grant_hash=? AND consumed_at IS NULL
      AND EXISTS (SELECT 1 FROM api_tokens WHERE token_hash=?)`)
      .bind(now, grantHash, tokenHash),
  ]);
  const inserted = results[0];
  if (inserted?.meta.changes !== 1) return null;
  const row = exchangeRowSchema.parse(inserted.results[0]);
  return { token, ...row };
}

export async function readDevicePrincipal(
  request: Request, env: ActivityEnv,
): Promise<DevicePrincipal | null> {
  const config = activityConfig(request, env);
  if (config === null || !validActivityOrigin(request)) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1];
  if (token === undefined) return null;
  const hash = await pkceChallenge(token);
  const row = await env.ACCOUNTS.prepare(`SELECT t.account_id AS accountId,
    t.device_id AS deviceId, t.auth_generation AS generation, a.shard_id AS shardId,
    t.issuer, t.scopes_json AS scopesJson FROM api_tokens t
    JOIN accounts a ON a.account_id=t.account_id
    JOIN devices d ON d.account_id=t.account_id AND d.device_id=t.device_id
    WHERE t.token_hash=? AND t.expires_at>? AND t.revoked_at IS NULL
    AND d.revoked_at IS NULL AND a.state='active' AND a.auth_generation=t.auth_generation
    AND t.issuer=? AND t.audience=?`)
    .bind(hash, Math.floor(Date.now() / 1000), config.PUBLIC_ORIGIN, ACTIVITY_AUDIENCE).first();
  if (row === null) return null;
  const parsed = devicePrincipalSchema.unwrap().omit({
    kind: true, sessionId: true, scopes: true,
  }).extend({ scopesJson: z.string() }).safeParse(row);
  if (!parsed.success) return null;
  let scopes: unknown;
  try {
    scopes = JSON.parse(parsed.data.scopesJson);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const allowed = deviceScopes.safeParse(scopes);
  if (!allowed.success) return null;
  const { scopesJson, ...identity } = parsed.data;
  return devicePrincipalSchema.parse({ ...identity, kind: "device", sessionId: null, scopes: allowed.data });
}

export async function revokeDevice(
  principal: BrowserPrincipal, deviceId: string, env: ActivityEnv,
): Promise<boolean> {
  const browser = managementPrincipal(principal);
  const now = Math.floor(Date.now() / 1000);
  const live = [browser.accountId, browser.generation, browser.sessionId, now];
  const results = await env.ACCOUNTS.batch([
    env.ACCOUNTS.prepare(`UPDATE devices SET revoked_at=? WHERE account_id=? AND device_id=?
      AND revoked_at IS NULL AND EXISTS (${liveBrowser})`)
      .bind(now, browser.accountId, deviceId, ...live),
    env.ACCOUNTS.prepare(`UPDATE api_tokens SET revoked_at=? WHERE account_id=? AND device_id=?
      AND revoked_at IS NULL AND EXISTS (${liveBrowser})
      AND EXISTS (SELECT 1 FROM devices WHERE account_id=? AND device_id=? AND revoked_at IS NOT NULL)`)
      .bind(now, browser.accountId, deviceId, ...live, browser.accountId, deviceId),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}
