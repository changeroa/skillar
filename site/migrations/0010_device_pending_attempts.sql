-- Additive only: rollback is DROP TABLE device_pending_attempts. No existing rows change.
-- Per-minute approve-attempt counters by account and by client IP (hashed).
-- Fixed-grid one-minute buckets; rows older than one hour are swept by the activity worker cron.
CREATE TABLE device_pending_attempts (
  subject TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, window_start)
);
