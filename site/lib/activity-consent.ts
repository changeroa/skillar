import { z } from "zod";
import { consentSchema, defaultConsent } from "../../shared/dist/activity-consent.js";
import { deviceIdSchema, revisionSchema } from "../../shared/dist/activity-schema.js";
import { activityError, noStore } from "./activity-auth.ts";
import type { ActivityEnv, BrowserPrincipal } from "./activity-auth.ts";

export const consentRequestSchema = z.strictObject({
  baseVersion: revisionSchema,
  consent: consentSchema,
}).readonly();

export async function currentDeviceConsent(
  env: ActivityEnv,
  identity: { readonly accountId: string; readonly generation: number; readonly deviceId: string },
) {
  const row = await env.ACCOUNTS.prepare(`SELECT version, consent_json FROM device_consents
    WHERE account_id=? AND device_id=? AND generation=? ORDER BY version DESC LIMIT 1`)
    .bind(identity.accountId, identity.deviceId, identity.generation).first();
  if (row === null) return { version: 0, consent: defaultConsent };
  const saved = z.object({ version: revisionSchema, consent_json: z.string() }).parse(row);
  return { version: saved.version, consent: consentSchema.parse(JSON.parse(saved.consent_json)) };
}

export async function readDeviceConsent(
  principal: BrowserPrincipal, deviceId: string, env: ActivityEnv,
): Promise<Response> {
  const device = deviceIdSchema.parse(deviceId);
  const owned = await env.ACCOUNTS.prepare(`SELECT 1 FROM devices
    WHERE account_id=? AND device_id=? AND revoked_at IS NULL`)
    .bind(principal.accountId, device).first();
  if (owned === null) return activityError(404, "not_found");
  return Response.json(await currentDeviceConsent(env, {
    accountId: principal.accountId, deviceId: device, generation: principal.generation,
  }), { headers: noStore });
}

export async function setDeviceConsent(
  principal: BrowserPrincipal, deviceId: string, input: unknown, env: ActivityEnv,
): Promise<Response> {
  const device = deviceIdSchema.parse(deviceId);
  const request = consentRequestSchema.parse(input);
  const version = revisionSchema.min(1).parse(request.baseVersion + 1);
  const nowMs = Date.now();
  const consent = request.consent.mode === "local-only" ? request.consent :
    { ...request.consent, grantedAtMs: nowMs };
  if (consent.mode !== "local-only" &&
      (consent.scope.deviceId !== device || consent.version !== version)) {
    return activityError(400, "invalid_consent");
  }
  const result = await env.ACCOUNTS.prepare(`INSERT INTO device_consents
    (account_id,device_id,generation,version,consent_json,granted_at_ms)
    SELECT ?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM accounts a JOIN devices d ON d.account_id=a.account_id
      JOIN sessions s ON s.user_sub=a.user_sub
      WHERE a.account_id=? AND a.auth_generation=? AND a.state='active'
      AND d.device_id=? AND d.revoked_at IS NULL AND s.id=? AND s.expires_at>?
    ) AND COALESCE((SELECT MAX(version) FROM device_consents
      WHERE account_id=? AND device_id=?),0)=?`)
    .bind(principal.accountId, device, principal.generation, version,
      JSON.stringify(consent), nowMs, principal.accountId, principal.generation,
      device, principal.sessionId, Math.floor(nowMs / 1000),
      principal.accountId, device, request.baseVersion).run();
  if (result.meta.changes !== 1) return activityError(409, "consent_conflict");
  return Response.json({ version, consent }, { headers: noStore });
}
