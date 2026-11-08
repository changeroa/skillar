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

async function currentContentConsent(
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
  const consent = consentSchema.parse(JSON.parse(stored.consent_json));
  if (consent.mode !== "managed-content" || consent.version !== stored.version) throw new ContentConsentError();
  return consent;
}

export async function requireContentConsent(
  accounts: D1Database, principal: IngestPrincipal, scope: UploadScope,
): Promise<GrantedContentConsent> {
  const consent = await currentContentConsent(accounts, principal, scope);
  authorizeUpload(consent, scope);
  return consent;
}

/** A fresh read grant may reauthorize retained bytes, never a stale write request. */
export function readContentScope(consent: GrantedContentConsent, scope: UploadScope): UploadScope {
  const historical = scope.backfill !== null || scope.fromMs < consent.grantedAtMs;
  if (historical && consent.backfill === undefined) throw new ContentConsentError();
  return {
    ...scope, consentVersion: consent.version,
    backfill: historical && consent.backfill !== undefined ? {
      version: consent.backfill.version, snapshotId: consent.backfill.snapshotId,
      journalCut: consent.backfill.journalCut,
    } : null,
  };
}
export async function requireContentReadConsent(
  accounts: D1Database, principal: IngestPrincipal, scope: UploadScope,
): Promise<GrantedContentConsent> {
  const consent = await currentContentConsent(accounts, principal, scope);
  authorizeUpload(consent, readContentScope(consent, scope));
  return consent;
}
