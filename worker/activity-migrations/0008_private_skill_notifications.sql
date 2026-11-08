-- Skills use the existing idempotent primary-control relay, not a second stream.
ALTER TABLE account_control_receipts ADD COLUMN invalidation_kind TEXT NOT NULL
  DEFAULT 'consent' CHECK(invalidation_kind IN ('consent','skills'));
DROP TRIGGER account_control_change;
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
    SELECT account_id,generation,head_seq,NEW.invalidation_kind FROM account_heads
      WHERE account_id=NEW.account_id AND generation=NEW.generation;
END;
