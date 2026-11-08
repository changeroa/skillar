import { z } from "zod";
import type { ContentEnv } from "./content-env.ts";

/** Keep intents after deletion: timed-out PUTs can complete after this sweep. */
export async function sweepPrivatePacks(env: Pick<ContentEnv, "ACTIVITY" | "ACTIVITY_RAW">, limit = 100) {
  const bounded = z.number().int().min(1).max(1000).parse(limit);
  const rows = await env.ACTIVITY.prepare(`SELECT j.account_id,j.generation,j.request_id,j.object_key
    FROM private_pack_jobs j LEFT JOIN tenant_fences f ON f.account_id=j.account_id
    LEFT JOIN private_pack_heads h ON h.account_id=j.account_id AND h.generation=j.generation AND h.name=j.name
    WHERE f.account_id IS NULL OR f.generation<>j.generation OR f.state<>'active' OR h.tombstoned=1
    ORDER BY j.purge_order,j.object_key LIMIT ?`).bind(bounded).all();
  const jobs = z.array(z.object({
    account_id: z.string(), generation: z.number().int(), request_id: z.string(), object_key: z.string(),
  })).parse(rows.results);
  for (const job of jobs) {
    await env.ACTIVITY_RAW.delete(job.object_key);
    await env.ACTIVITY.prepare(`UPDATE private_pack_jobs SET
      purge_order=(SELECT COALESCE(MAX(purge_order),0)+1 FROM private_pack_jobs)
      WHERE account_id=? AND generation=? AND request_id=?`)
      .bind(job.account_id, job.generation, job.request_id).run();
  }
  return { deleted: jobs.length };
}
