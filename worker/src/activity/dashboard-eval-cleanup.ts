import { z } from "zod";
import { consentSchema } from "../../../shared/activity-consent.ts";
import type { ContentEnv } from "./content-env.ts";

/** Keep purge intents so a timed-out PUT completing after DELETE is swept again. */
export async function sweepDashboardEvalCases(env: ContentEnv, now = Date.now()) {
  const rows = z.array(z.object({
    account_id: z.string(), generation: z.number(), device_id: z.string(), object_key: z.string(),
    consent_version: z.number(), requires_path: z.number(), created_at: z.number(), expires_at: z.number(), active: z.number(),
  })).parse((await env.ACTIVITY.prepare(`SELECT e.*,EXISTS(SELECT 1 FROM tenant_fences f
    WHERE f.account_id=e.account_id AND f.generation=e.generation AND f.state='active') AS active
    FROM dashboard_eval_cases e ORDER BY e.purge_order,e.object_key LIMIT 100`).all()).results);
  let deleted = 0;
  for (const row of rows) {
    const saved = await env.ACCOUNTS.prepare(`SELECT c.version,c.consent_json FROM device_consents c
      JOIN accounts a ON a.account_id=c.account_id
      JOIN devices d ON d.account_id=c.account_id AND d.device_id=c.device_id
      WHERE c.account_id=? AND c.device_id=? AND c.generation=? AND a.state='active'
        AND a.auth_generation=? AND d.revoked_at IS NULL ORDER BY c.version DESC LIMIT 1`)
      .bind(row.account_id, row.device_id, row.generation, row.generation).first();
    let retained = false;
    if (saved !== null) {
      const current = z.object({ version: z.number(), consent_json: z.string() }).parse(saved);
      const consent = consentSchema.parse(JSON.parse(current.consent_json));
      retained = current.version === row.consent_version && consent.mode === "managed-content" &&
        consent.version === current.version && consent.scope.deviceId === row.device_id &&
        consent.scope.projectIds.includes(`device:${row.device_id}`) && consent.contentKinds.includes("query") &&
        (row.requires_path === 0 || consent.contentKinds.includes("path")) &&
        row.created_at + consent.retention.contentDays * 86_400_000 > now;
    }
    // Rotate every visited intent, including retained records, to avoid starving expiry cleanup.
    await env.ACTIVITY.prepare(`UPDATE dashboard_eval_cases
      SET purge_order=(SELECT COALESCE(max(purge_order),0)+1 FROM dashboard_eval_cases) WHERE object_key=?`)
      .bind(row.object_key).run();
    if (retained && row.active === 1 && row.expires_at > now) continue;
    await env.ACTIVITY.prepare("UPDATE dashboard_eval_cases SET state='purging' WHERE object_key=?")
      .bind(row.object_key).run();
    await env.ACTIVITY_RAW.delete(row.object_key);
    await env.ACTIVITY.prepare("UPDATE dashboard_eval_cases SET state='purged' WHERE object_key=?")
      .bind(row.object_key).run();
    deleted++;
  }
  return { deleted };
}
