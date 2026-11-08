-- The primary account DB owns consent/revocation commits. Relay only opaque
-- invalidations through a transactional outbox; never copy consent bodies.
CREATE TABLE account_control_outbox (
  control_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX account_control_pending ON account_control_outbox(created_at_ms);
CREATE TRIGGER consent_account_event AFTER INSERT ON device_consents BEGIN
  INSERT INTO account_control_outbox(account_id,generation)
    VALUES (NEW.account_id,NEW.generation);
END;
CREATE TRIGGER device_revoke_account_event AFTER UPDATE OF revoked_at ON devices
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
  INSERT INTO account_control_outbox(account_id,generation)
    SELECT account_id,auth_generation FROM accounts WHERE account_id=NEW.account_id;
END;
