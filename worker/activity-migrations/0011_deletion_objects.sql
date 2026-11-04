-- Durable opaque targets survive removal of content-bearing manifests and jobs.
-- Keep revisiting them: an old timed-out PUT can finish after a successful DELETE.
CREATE TABLE deletion_objects (
  account_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  checked_at_ms INTEGER,
  purge_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,object_key)
);
CREATE INDEX deletion_objects_sweep
  ON deletion_objects(purge_order,account_id,generation);
