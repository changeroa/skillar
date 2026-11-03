import { z } from "zod";
import { EVENT_RETENTION_MS } from "../../../shared/activity-events.ts";

const rowSchema = z.object({
  control_id: z.number().int().positive().safe(),
  account_id: z.string(), generation: z.number().int().positive().safe(),
  invalidation_kind: z.enum(["consent", "skills"]).default("consent"),
});

/** Cross-D1 delivery is at-least-once; the shard receipt makes its change exactly-once. */
export async function dispatchAccountControls(
  env: { readonly ACCOUNTS: D1Database; readonly ACTIVITY: D1Database },
): Promise<void> {
  await env.ACCOUNTS.prepare("DELETE FROM account_control_outbox WHERE created_at_ms<=?")
    .bind(Date.now() - EVENT_RETENTION_MS).run();
  const result = await env.ACCOUNTS.prepare(`SELECT *
    FROM account_control_outbox ORDER BY control_id LIMIT 100`).all();
  for (const row of z.array(rowSchema).parse(result.results)) {
    const active = await env.ACCOUNTS.prepare(`SELECT 1 FROM accounts
      WHERE account_id=? AND auth_generation=? AND state='active'`)
      .bind(row.account_id, row.generation).first();
    if (active !== null) {
      if (row.invalidation_kind === "skills") {
        // Browser-only private catalogs need their first event fence. Conflict
        // ignore never reopens a closed fence or replaces an older generation.
        await env.ACTIVITY.prepare(`INSERT INTO tenant_fences(account_id,generation,state)
          VALUES(?,?,'active') ON CONFLICT(account_id) DO NOTHING`)
          .bind(row.account_id, row.generation).run();
      }
      // No active shard fence means there is no cloud content to invalidate.
      const columns = row.invalidation_kind === "skills" ? ",invalidation_kind" : "";
      const kind = row.invalidation_kind === "skills" ? ",'skills'" : "";
      await env.ACTIVITY.prepare(`INSERT INTO account_control_receipts(account_id,generation,control_id${columns})
        SELECT ?,?,?${kind} WHERE EXISTS(SELECT 1 FROM tenant_fences
          WHERE account_id=? AND generation=? AND state='active')
        ON CONFLICT(account_id,generation,control_id) DO NOTHING`)
        .bind(row.account_id, row.generation, row.control_id, row.account_id, row.generation).run();
    }
    // A failure before this ACK leaves the primary row pending, including when
    // the shard committed but its response was lost.
    await env.ACCOUNTS.prepare("DELETE FROM account_control_outbox WHERE control_id=?")
      .bind(row.control_id).run();
  }
}
