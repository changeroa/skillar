import type { UploadScope } from "../../../shared/activity-consent.ts";
import { activeFence } from "./content-db.ts";
import { requireContentConsent } from "./content-consent.ts";
import type { ContentEnv } from "./content-env.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";

/** Provision only a first consented write; an existing closed/old fence is never reopened. */
export async function initializeContentAccount(
  env: ContentEnv, principal: IngestPrincipal, scope: UploadScope,
): Promise<void> {
  const existing = await env.ACTIVITY.prepare("SELECT 1 FROM tenant_fences WHERE account_id=?")
    .bind(principal.accountId).first();
  if (existing !== null) return;
  if (!principal.scopes.includes("activity:ingest") || principal.scopes.includes("device:manage")) {
    throw new ActivityLedgerError("forbidden");
  }
  // This checks current primary account generation, owned non-revoked device,
  // explicit managed-content consent and the exact upload scope before creation.
  await requireContentConsent(env.ACCOUNTS, principal, scope);
  await env.ACTIVITY.prepare(`INSERT INTO tenant_fences(account_id,generation,state)
    VALUES (?,?,'active') ON CONFLICT(account_id) DO NOTHING`)
    .bind(principal.accountId, principal.generation).run();
  // A concurrent close wins even if it races the first initializer.
  await activeFence(env.ACTIVITY, principal);
  await requireContentConsent(env.ACCOUNTS, principal, scope);
}
