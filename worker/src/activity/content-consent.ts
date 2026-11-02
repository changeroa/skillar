import { z } from "zod";
import { authorizeUpload, consentSchema } from "../../../shared/activity-consent.ts";
import type { Consent, UploadScope } from "../../../shared/activity-consent.ts";
import type { ContentKind } from "../../../shared/activity-schema.ts";
import { contentDigest } from "./content-db.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";

export class ContentConsentError extends Error {
  readonly status = 403;
  readonly code = "consent_required";
  constructor() {
    super("consent_required");
    this.name = "ContentConsentError";
  }
}

/** Current primary D1 consent, never a caller's serialized grant or stale KV. */
export type GrantedContentConsent = Extract<Consent, { readonly mode: "managed-content" }>;
export type ContentScopeInput = {
  readonly deviceId: string; readonly projectId: string; readonly rootId: string | null;
  readonly consentVersion: number;
  readonly range: { readonly fromMs: number; readonly toMs: number };
  readonly backfill: UploadScope["backfill"];
};
export function contentScope(
  input: ContentScopeInput, kinds: readonly ContentKind[] = [],
): UploadScope {
  return {
    deviceId: input.deviceId, projectId: input.projectId, rootId: input.rootId,
    consentVersion: input.consentVersion, fromMs: input.range.fromMs,
    toMs: input.range.toMs, backfill: input.backfill, contentKinds: kinds,
  };
}
export async function contentScopeHash(input: ContentScopeInput): Promise<string> {
  return contentDigest(new TextEncoder().encode(JSON.stringify(contentScope(input))));
}

export async function requireContentConsent(
  accounts: D1Database, principal: IngestPrincipal, scope: UploadScope,
): Promise<GrantedContentConsent> {
  if (principal.deviceId !== scope.deviceId) throw new ActivityLedgerError("forbidden");
  const row = await accounts.prepare(`SELECT c.version,c.consent_json
    FROM device_consents c JOIN accounts a ON a.account_id=c.account_id
    JOIN devices d ON d.account_id=c.account_id AND d.device_id=c.device_id
    WHERE c.account_id=? AND c.device_id=? AND c.generation=?
      AND a.state='active' AND a.auth_generation=? AND d.revoked_at IS NULL
    ORDER BY c.version DESC LIMIT 1`)
    .bind(principal.accountId, principal.deviceId, principal.generation, principal.generation).first();
  if (row === null) throw new ContentConsentError();
  const stored = z.object({ version: z.number().int(), consent_json: z.string() }).parse(row);
  if (stored.version !== scope.consentVersion) throw new ContentConsentError();
  const consent = consentSchema.parse(JSON.parse(stored.consent_json));
  if (consent.mode !== "managed-content") throw new ContentConsentError();
  authorizeUpload(consent, scope);
  return consent;
}
