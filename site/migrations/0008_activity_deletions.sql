-- Independent of ACTIVITY restores. Never rewind this ledger with an old shard.
-- Opaque identifiers and lifecycle timestamps only; no content, keys or tokens.
CREATE TABLE activity_deletions (
  account_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation>0),
  requested_at_ms INTEGER NOT NULL,
  access_revoked_at_ms INTEGER,
  live_purge_at_ms INTEGER,
  last_copy_at_ms INTEGER NOT NULL,
  backup_expires_at_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN (
    'requested','access_revoked','live_purge_complete','backup_expired'
  )),
  reconcile_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,generation)
);
CREATE INDEX activity_deletions_reconcile
  ON activity_deletions(reconcile_order,account_id,generation);
