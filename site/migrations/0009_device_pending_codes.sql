-- Additive only: rollback is DROP TABLE device_pending_codes. No existing rows change.
-- Hashes and lifecycle timestamps only; the user code, poll token and api token are never stored.
-- Terminal rows (approved/consumed/expired) are swept by the activity worker cron within ~24h.
CREATE TABLE device_pending_codes (
  code_hash TEXT PRIMARY KEY,
  poll_hash TEXT UNIQUE NOT NULL,
  device_label TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  account_id TEXT,
  session_id TEXT,
  device_id TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  last_poll_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  consumed_at INTEGER
);
CREATE INDEX device_pending_codes_sweep
  ON device_pending_codes(expires_at);
