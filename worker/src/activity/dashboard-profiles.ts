import { z } from "zod";
import { accountIdSchema, contentKinds } from "../../../shared/activity-schema.ts";
import { consentSchema, defaultConsent } from "../../../shared/activity-consent.ts";
import { dashboardProfilesSchema, dashboardSourceHeadSchema } from "../../../shared/activity-dashboard.ts";
import type { DashboardProfile } from "../../../shared/activity-dashboard.ts";
import type { ContentEnv } from "./content-env.ts";
import { ActivityLedgerError } from "./types.ts";

const browserSchema = z.strictObject({
  kind: z.literal("browser"), accountId: accountIdSchema, deviceId: z.null(),
  generation: z.number().int().positive(), shardId: z.literal("activity-00"),
  issuer: z.enum(["https://skillar.sh", "https://site.example.test"]),
  sessionId: z.string().min(32),
  scopes: z.array(z.enum(["activity:read", "device:manage"])).min(1).max(2).readonly(),
}).readonly();
type BrowserPrincipal = z.infer<typeof browserSchema>;
const deviceSchema = z.object({
  device_id: z.string(), created_at: z.number().int(), revoked_at: z.number().int().nullable(),
  version: z.number().int().nullable(), consent_json: z.string().nullable(),
});

async function browserFence(env: ContentEnv, principal: BrowserPrincipal) {
  if (!principal.scopes.includes("activity:read")) throw new ActivityLedgerError("forbidden");
  const row = await env.ACCOUNTS.prepare(`SELECT 1 FROM accounts a
    JOIN sessions s ON s.user_sub=a.user_sub
    WHERE a.account_id=? AND a.auth_generation=? AND a.shard_id=?
      AND a.state='active' AND s.id=? AND s.expires_at>?`)
    .bind(principal.accountId, principal.generation, principal.shardId, principal.sessionId,
      Math.floor(Date.now() / 1000)).first();
  if (row === null) throw new ActivityLedgerError("forbidden");
}

/** Only the private Pages binding supplies the browser principal, never request JSON. */
export async function dashboardProfiles(env: ContentEnv, identity: unknown) {
  const principal = browserSchema.parse(identity);
  await browserFence(env, principal);
  const records = z.array(deviceSchema).parse((await env.ACCOUNTS.prepare(`SELECT
    d.device_id,d.created_at,d.revoked_at,c.version,c.consent_json FROM devices d
    LEFT JOIN device_consents c ON c.account_id=d.account_id AND c.device_id=d.device_id
      AND c.generation=? AND c.version=(SELECT max(v.version) FROM device_consents v
        WHERE v.account_id=d.account_id AND v.device_id=d.device_id AND v.generation=?)
    WHERE d.account_id=? ORDER BY d.created_at,d.device_id`)
    .bind(principal.generation, principal.generation, principal.accountId).all()).results);
  const devices = records.map(row => ({
    deviceId: row.device_id, createdAt: row.created_at, revokedAt: row.revoked_at,
    consentVersion: row.version ?? 0,
    consent: row.consent_json === null ? defaultConsent : consentSchema.parse(JSON.parse(row.consent_json)),
  }));
  const sources = z.array(dashboardSourceHeadSchema).parse((await env.ACTIVITY.prepare(`WITH
    sources AS (
      SELECT device_id,source_domain FROM device_streams WHERE account_id=?1 AND generation=?2
      UNION SELECT device_id,source_domain FROM migration_runs WHERE account_id=?1 AND generation=?2
        AND state='complete' AND purpose='initial'
      UNION SELECT device_id,source_domain FROM runtime_contexts WHERE account_id=?1 AND generation=?2
    )
    SELECT s.device_id AS deviceId,s.source_domain AS sourceDomain,
      COALESCE(d.sequence,r.source_sequence,0) AS sourceSequence,
      COALESCE(d.journal_through,(SELECT max(m.cut) FROM migration_runs m
        WHERE m.account_id=?1 AND m.generation=?2 AND m.device_id=s.device_id
          AND m.source_domain=s.source_domain AND m.state='complete' AND m.purpose='initial'),r.source_cut,0) AS journalThrough,
      r.sequence AS runtimeSequence,r.captured_at_ms AS capturedAtMs,r.received_at_ms AS receivedAtMs
    FROM sources s LEFT JOIN device_streams d ON d.account_id=?1 AND d.generation=?2
      AND d.device_id=s.device_id AND d.source_domain=s.source_domain
    LEFT JOIN runtime_contexts r ON r.account_id=?1 AND r.generation=?2
      AND r.device_id=s.device_id AND r.source_domain=s.source_domain AND r.sequence=(
        SELECT max(v.sequence) FROM runtime_contexts v WHERE v.account_id=?1 AND v.generation=?2
          AND v.device_id=s.device_id AND v.source_domain=s.source_domain)
    WHERE EXISTS(SELECT 1 FROM tenant_fences f WHERE f.account_id=?1 AND f.generation=?2 AND f.state='active')
    ORDER BY s.device_id,s.source_domain`).bind(principal.accountId, principal.generation).all()).results);
  const profiles: DashboardProfile[] = [];
  for (const source of sources) {
    const device = devices.find(d => d.deviceId === source.deviceId);
    if (device === undefined) continue;
    const consent = device.consent;
    let availability: DashboardProfile["availability"];
    if (device.revokedAt !== null) availability = "revoked";
    else switch (consent.mode) {
      case "local-only": availability = "local-only"; break;
      case "metadata": availability = "metadata-only"; break;
      case "managed-content":
        availability = consent.version !== device.consentVersion ||
          consent.scope.deviceId !== device.deviceId ||
          !consent.scope.projectIds.includes(`device:${device.deviceId}`) ||
          consent.scope.rootIds.length !== 0 ||
          contentKinds.some(kind => !consent.contentKinds.includes(kind)) ? "partial" :
          source.runtimeSequence === null ? "awaiting-runtime" : "ready";
        break;
      default: { const exhaustive: never = consent; return exhaustive; }
    }
    profiles.push({ ...source, availability });
  }
  await browserFence(env, principal);
  return dashboardProfilesSchema.parse({
    schemaVersion: 1, ingestEnabled: env.ACTIVITY_INGEST_ENABLED === "true", devices, profiles,
  });
}
