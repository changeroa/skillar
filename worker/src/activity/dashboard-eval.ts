import { z } from "zod";
import { dashboardEvalRequestSchema, dashboardEvalReceiptSchema } from "../../../shared/activity-dashboard.ts";
import { consentSchema } from "../../../shared/activity-consent.ts";
import type { ContentEnv } from "./content-env.ts";
import type { IngestPrincipal } from "./types.ts";
import { ActivityLedgerError } from "./types.ts";
import { activeFence, contentDigest } from "./content-db.ts";
import { ContentConsentError, requireContentConsent } from "./content-consent.ts";
import { readContentKey, writeContentKey } from "./content-keys.ts";
import { decryptContent, encryptContent } from "./crypto.ts";
import { reportWrite } from "./report-store.ts";

export class DashboardEvalError extends Error {
  constructor(readonly code: "eval_conflict" | "eval_expired" | "eval_integrity",
    readonly status: 409 | 410 = 409) {
    super(code);
    this.name = "DashboardEvalError";
  }
}
const storedSchema = z.object({
  case_id: z.string(), payload_hash: z.string(), bytes: z.number().int().positive(),
  object_key: z.string(), key_version: z.number().int().positive(),
  consent_version: z.number().int().positive(), created_at: z.number().int(), expires_at: z.number().int(),
  state: z.enum(["writing", "stored", "purging", "purged"]),
});
type StoredCase = z.infer<typeof storedSchema>;

async function grant(env: ContentEnv, principal: IngestPrincipal, request: z.infer<typeof dashboardEvalRequestSchema>,
  record?: StoredCase) {
  if (!principal.scopes.includes("activity:read") || principal.scopes.includes("device:manage") ||
      principal.shardId !== "activity-00" || principal.deviceId !== request.profile.deviceId) {
    throw new ActivityLedgerError("forbidden");
  }
  await activeFence(env.ACTIVITY, principal);
  const row = await env.ACCOUNTS.prepare(`SELECT c.version,c.consent_json FROM device_consents c
    JOIN accounts a ON a.account_id=c.account_id
    JOIN devices d ON d.account_id=c.account_id AND d.device_id=c.device_id
    WHERE c.account_id=? AND c.device_id=? AND c.generation=? AND a.state='active'
      AND a.auth_generation=? AND d.revoked_at IS NULL ORDER BY c.version DESC LIMIT 1`)
    .bind(principal.accountId, principal.deviceId, principal.generation, principal.generation).first();
  if (row === null) throw new ContentConsentError();
  const saved = z.object({ version: z.number().int(), consent_json: z.string() }).parse(row);
  const consent = consentSchema.parse(JSON.parse(saved.consent_json));
  if (consent.mode !== "managed-content" || consent.version !== saved.version ||
      record !== undefined && record.consent_version !== saved.version) throw new ContentConsentError();
  const now = record?.created_at ?? Date.now();
  await requireContentConsent(env.ACCOUNTS, principal, {
    deviceId: principal.deviceId, projectId: `device:${principal.deviceId}`, rootId: null,
    consentVersion: saved.version, fromMs: now, toMs: now + 1, backfill: null,
    contentKinds: request.input.expectedUri === undefined ? ["query"] : ["query", "path"],
  });
  if (record !== undefined && (record.expires_at <= Date.now() ||
      record.created_at + consent.retention.contentDays * 86_400_000 <= Date.now() ||
      record.state === "purging" || record.state === "purged")) {
    throw new DashboardEvalError("eval_expired", 410);
  }
  return consent;
}

/** Explicit browser writes create cloud-owned bytes, never mutate the source snapshot. */
export async function storeDashboardEvalCase(env: ContentEnv, principal: IngestPrincipal, input: unknown) {
  const request = dashboardEvalRequestSchema.parse(input);
  const consent = await grant(env, principal, request);
  const identity = [principal.accountId, principal.generation, principal.deviceId,
    request.profile.sourceDomain, request.requestId] as const;
  const bytes = new TextEncoder().encode(JSON.stringify(request.input));
  const hash = await contentDigest(bytes);
  const managed = await writeContentKey(env.ACTIVITY, principal, env.CONTENT_KEYRING);
  const namespace = await contentDigest(new TextEncoder().encode(JSON.stringify(identity)));
  const objectKey = `activity/${encodeURIComponent(principal.accountId)}/${principal.generation}/eval/${namespace}`;
  const now = Date.now(), expires = Math.min(8_640_000_000_000_000,
    now + consent.retention.contentDays * 86_400_000);
  await reportWrite(() => env.ACTIVITY.prepare(`INSERT INTO dashboard_eval_cases
    (account_id,generation,device_id,source_domain,request_id,case_id,payload_hash,bytes,object_key,
      key_version,consent_version,requires_path,created_at,expires_at,state)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'writing')
    ON CONFLICT(account_id,generation,device_id,source_domain,request_id) DO NOTHING`)
    .bind(...identity, crypto.randomUUID(), hash, bytes.length, objectKey, managed.version,
      consent.version, request.input.expectedUri === undefined ? 0 : 1, now, expires).run());
  const record = storedSchema.parse(await env.ACTIVITY.prepare(`SELECT * FROM dashboard_eval_cases
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND request_id=?`)
    .bind(...identity).first());
  await grant(env, principal, request, record);
  if (record.payload_hash !== hash || record.bytes !== bytes.length) throw new DashboardEvalError("eval_conflict");
  const key = record.key_version === managed.version ? managed.key :
    await readContentKey(env.ACTIVITY, principal, env.CONTENT_KEYRING, record.key_version);
  const context = { accountId: principal.accountId, generation: principal.generation,
    objectKey: record.object_key, revision: 0, schemaVersion: 1 };
  if (record.state === "writing") {
    const envelope = await encryptContent(key, context, bytes);
    await env.ACTIVITY_RAW.put(record.object_key, JSON.stringify(envelope), {
      onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" },
    });
  }
  const object = await env.ACTIVITY_RAW.get(record.object_key);
  if (object === null) throw new DashboardEvalError("eval_integrity");
  const plaintext = await decryptContent(key, context, await object.json());
  if (plaintext.length !== record.bytes || await contentDigest(plaintext) !== hash) {
    throw new DashboardEvalError("eval_integrity");
  }
  await grant(env, principal, request, record);
  const result = await reportWrite(() => env.ACTIVITY.prepare(`UPDATE dashboard_eval_cases SET state='stored'
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND request_id=?
      AND state IN ('writing','stored') AND expires_at>?`)
    .bind(...identity, Date.now()).run());
  if (result.meta.changes !== 1) throw new DashboardEvalError("eval_expired", 410);
  await grant(env, principal, request, record);
  return dashboardEvalReceiptSchema.parse({ caseId: record.case_id, state: "stored", retainedUntilMs: record.expires_at });
}
