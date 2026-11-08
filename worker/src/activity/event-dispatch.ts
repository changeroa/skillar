// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { sweepAccountChanges } from "./event-replay.ts";

const pendingSchema = z.array(z.object({
  account_id: z.string(), generation: z.number().int().positive().safe(),
  seq: z.number().int().positive().safe(),
}));

/** Wakeups are best effort here; durable intent and Cron own retry, not the writer. */
export async function dispatchAccountEvents(env: {
  readonly ACTIVITY: D1Database;
  readonly ACCOUNT_HUB: DurableObjectNamespace;
}): Promise<void> {
  // Post-commit boundary: even D1 preparation/retention failure must not turn a
  // published report into a failed calculation. No exception bytes enter logs.
  try {
    await sweepAccountChanges(env.ACTIVITY);
    const pending = await env.ACTIVITY.prepare(`SELECT account_id,generation,max(seq) AS seq
      FROM account_event_outbox GROUP BY account_id,generation
      ORDER BY min(created_at),account_id,generation LIMIT 100`).all();
    for (const row of pendingSchema.parse(pending.results)) {
      // A lost response or ACK produces a duplicate wakeup; only the selected
      // high-water mark may be acknowledged.
      try {
        const stub = env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(row.account_id));
        const response = await stub.fetch("https://hub.internal/notify", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: row.account_id, generation: row.generation }),
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        if (!response.ok) continue;
        await env.ACTIVITY.prepare(`DELETE FROM account_event_outbox
          WHERE account_id=? AND generation=? AND seq<=?`)
          .bind(row.account_id, row.generation, row.seq).run();
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        console.warn("account_event_notification_retry");
      }
    }
  } catch { // no-excuse-ok: catch -- terminal best-effort dispatch boundary
    console.warn("account_event_dispatch_retry");
  }
}
