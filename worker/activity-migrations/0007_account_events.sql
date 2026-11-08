-- AGPL-3.0-only. Account notifications are independent of processing jobs.
ALTER TABLE account_changes ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
UPDATE account_changes SET created_at=unixepoch()*1000;
CREATE INDEX account_changes_retention ON account_changes(created_at);
CREATE TABLE account_event_outbox (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id,generation,seq)
);
CREATE INDEX account_event_outbox_retention ON account_event_outbox(created_at);
INSERT INTO account_event_outbox(account_id,generation,seq,created_at)
  SELECT account_id,generation,seq,created_at FROM account_changes;
-- Timestamp and notification intent commit or roll back with every writer.
CREATE TRIGGER account_change_notification AFTER INSERT ON account_changes BEGIN
  UPDATE account_changes SET created_at=unixepoch()*1000
    WHERE account_id=NEW.account_id AND generation=NEW.generation AND seq=NEW.seq;
  INSERT INTO account_event_outbox(account_id,generation,seq,created_at)
    VALUES(NEW.account_id,NEW.generation,NEW.seq,unixepoch()*1000);
END;
-- Cross-D1 control delivery may lose its primary ACK. Retain its identity for
-- seven days, matching the primary control outbox's maximum retry lifetime.
CREATE TABLE account_control_receipts (
  account_id TEXT, generation INTEGER, control_id INTEGER,
  created_at_ms INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  PRIMARY KEY (account_id,generation,control_id)
);
CREATE INDEX account_control_receipts_retention ON account_control_receipts(created_at_ms);
CREATE TRIGGER account_control_change AFTER INSERT ON account_control_receipts
WHEN EXISTS (
  SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
    AND generation=NEW.generation AND state='active'
) BEGIN
  INSERT INTO account_heads(account_id,generation,head_seq)
    VALUES(NEW.account_id,NEW.generation,0)
    ON CONFLICT(account_id,generation) DO NOTHING;
  UPDATE account_heads SET head_seq=head_seq+1
    WHERE account_id=NEW.account_id AND generation=NEW.generation;
  INSERT INTO account_changes(account_id,generation,seq,invalidation_kind)
    SELECT account_id,generation,head_seq,'consent' FROM account_heads
      WHERE account_id=NEW.account_id AND generation=NEW.generation;
END;
-- Runtime is immutable; conflict-ignore retries never enter this trigger.
CREATE TRIGGER runtime_account_change AFTER INSERT ON runtime_contexts BEGIN
  INSERT INTO account_heads(account_id,generation,head_seq)
    VALUES(NEW.account_id,NEW.generation,0)
    ON CONFLICT(account_id,generation) DO NOTHING;
  UPDATE account_heads SET head_seq=head_seq+1
    WHERE account_id=NEW.account_id AND generation=NEW.generation;
  INSERT INTO account_changes(account_id,generation,seq,invalidation_kind)
    SELECT account_id,generation,head_seq,'runtime' FROM account_heads
      WHERE account_id=NEW.account_id AND generation=NEW.generation;
END;
