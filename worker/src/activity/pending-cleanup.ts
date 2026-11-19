import {
  PENDING_CODE_RETENTION_SECONDS, SWEEP_PENDING_CODES_SQL,
} from "../../../shared/activity-pending.ts";
import type { ContentEnv } from "./content-env.ts";

// Housekeeping for the pending device-approval codes (site migration 0009).
// Registered as its own waitUntil in the every-minute cron so a failure here
// never skips the other sweeps and theirs never skips this one. Expired rows
// stay unusable through TTL checks on every read path; a delayed sweep only
// delays deletion, so failures are logged, not retried loudly.
export async function sweepPendingCodes(env: ContentEnv): Promise<void> {
  try {
    await env.ACCOUNTS.prepare(SWEEP_PENDING_CODES_SQL)
      .bind(Math.floor(Date.now() / 1000) - PENDING_CODE_RETENTION_SECONDS).run();
  } catch (error) {
    console.error("pending code sweep failed", error);
  }
}
