import { z } from "zod";
import {
  accountIdSchema, deviceIdSchema,
} from "../../shared/dist/activity-schema.js";
import type { DeviceId } from "../../shared/dist/activity-schema.js";
import { configSchema, randomToken, readSession } from "./auth.ts";
import type { Config } from "./auth.ts";

export interface ActivityEnv extends Config {
  readonly ACCOUNTS: D1Database;
  readonly ACTIVITY_ENABLED?: string;
}
export const activityScopes = ["activity:read", "activity:ingest", "device:manage"] as const;
export const activityScopeSchema = z.enum(activityScopes);
export type ActivityScope = z.infer<typeof activityScopeSchema>;
const base = {
  accountId: accountIdSchema,
  generation: z.number().int().positive(),
  shardId: z.literal("activity-00"),
  issuer: z.string().url(),
  scopes: z.array(activityScopeSchema).readonly(),
};
export const browserPrincipalSchema = z.strictObject({
  ...base, kind: z.literal("browser"), sessionId: z.string().min(32), deviceId: z.null(),
}).readonly();
export const devicePrincipalSchema = z.strictObject({
  ...base, kind: z.literal("device"), sessionId: z.null(), deviceId: deviceIdSchema,
}).readonly();
export const principalSchema = z.discriminatedUnion("kind", [
  browserPrincipalSchema.unwrap(), devicePrincipalSchema.unwrap(),
]).readonly();
export type ActivityPrincipal = z.infer<typeof principalSchema>;
export type BrowserPrincipal = Extract<ActivityPrincipal, { readonly kind: "browser" }>;
export type DevicePrincipal = Extract<ActivityPrincipal, { readonly kind: "device" }>;
export const ACTIVITY_AUDIENCE = "skillar:activity";
export const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function activityError(status: number, code: string): Response {
  return Response.json({ error: code }, { status, headers: noStore });
}

export function activityConfig(request: Request, env: ActivityEnv): Config | null {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) return null;
  const origin = new URL(request.url).origin;
  if (origin !== parsed.data.PUBLIC_ORIGIN &&
      !(parsed.data.PUBLIC_ORIGIN === "https://skillar.sh" && origin === "https://skillar-site.pages.dev")) return null;
  return { ...parsed.data, PUBLIC_ORIGIN: origin };
}

export function validActivityOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === new URL(request.url).origin;
  return request.method === "GET" || request.method === "HEAD" ||
    request.headers.has("authorization");
}

export async function browserPrincipal(request: Request, env: ActivityEnv): Promise<BrowserPrincipal | null> {
  const config = activityConfig(request, env);
  if (config === null || !validActivityOrigin(request)) return null;
  if (request.method !== "GET" && request.method !== "HEAD" &&
      request.headers.get("origin") !== config.PUBLIC_ORIGIN) return null;
  const now = Math.floor(Date.now() / 1000);
  const session = await readSession(request, config, now);
  if (session === null) return null;
  // Lazy account provisioning is guarded by the still-live Google session.
  await env.ACCOUNTS.prepare(`INSERT OR IGNORE INTO accounts(account_id,user_sub)
    SELECT ?, user_sub FROM sessions WHERE id=? AND user_sub=? AND expires_at>?`)
    .bind(randomToken(), session.sid, session.sub, now).run();
  const row = await env.ACCOUNTS.prepare(`SELECT a.account_id AS accountId,
    a.auth_generation AS generation, a.shard_id AS shardId FROM accounts a
    JOIN sessions s ON s.user_sub=a.user_sub
    WHERE s.id=? AND s.user_sub=? AND s.expires_at>? AND a.state='active'`)
    .bind(session.sid, session.sub, now).first();
  if (row === null) return null;
  return browserPrincipalSchema.parse({
    ...row, kind: "browser", sessionId: session.sid, deviceId: null,
    issuer: config.PUBLIC_ORIGIN, scopes: ["activity:read", "device:manage"],
  });
}

export async function sourceNamespace(
  principal: ActivityPrincipal,
  source: { readonly deviceId: DeviceId; readonly sourceDomain: string; readonly sourceId: string },
  db: D1Database,
): Promise<string | null> {
  if (principal.kind === "device" && principal.deviceId !== source.deviceId) return null;
  const row = await db.prepare(`SELECT d.device_id FROM devices d
    JOIN accounts a ON a.account_id=d.account_id
    WHERE d.account_id=? AND d.device_id=? AND d.revoked_at IS NULL
      AND a.state='active' AND a.auth_generation=?`)
    .bind(principal.accountId, source.deviceId, principal.generation).first();
  return row === null ? null : JSON.stringify([
    principal.accountId, source.deviceId, source.sourceDomain, source.sourceId,
  ]);
}
