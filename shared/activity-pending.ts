// Shared between the site (endpoint implementation + tests) and the activity
// worker (scheduled cleanup). Terminal pending rows — consumed, approved or
// expired — are deleted once their terminal timestamp is older than this many
// seconds. The security boundary is the TTL check on every read path; this
// sweep is housekeeping, so a delayed cron only delays deletion, never access.
export const PENDING_CODE_RETENTION_SECONDS = 24 * 60 * 60;

export const SWEEP_PENDING_CODES_SQL = `DELETE FROM device_pending_codes
  WHERE COALESCE(consumed_at, approved_at, expires_at) < ?`;
