-- AGPL-3.0-only. Raw operations/results/errors exist only in encrypted R2.
-- Keep descriptors after purge: timed-out PUTs may arrive after a DELETE.
CREATE TABLE connector_commands (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, command_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL, base_revision INTEGER NOT NULL CHECK(base_revision>=0),
  object_key TEXT NOT NULL UNIQUE, bytes INTEGER NOT NULL, key_version INTEGER NOT NULL,
  consent_version INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('writing','pending','acking','applied','conflict','rejected','purging','purged')),
  outcome TEXT CHECK(outcome IN ('applied','conflict','rejected')),
  source_revision INTEGER, result_hash TEXT, result_bytes INTEGER, result_object_key TEXT UNIQUE,
  acknowledged_at INTEGER, purge_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,generation,device_id,source_domain,command_id)
);
CREATE UNIQUE INDEX connector_commands_pending ON connector_commands(
  account_id,generation,device_id,source_domain
) WHERE state IN ('writing','pending','acking');
CREATE INDEX connector_commands_sweep ON connector_commands(purge_order,object_key);
CREATE TRIGGER connector_commands_insert BEFORE INSERT ON connector_commands BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM connector_commands WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND command_id=NEW.command_id
      AND payload_hash<>NEW.payload_hash
  ) THEN RAISE(ABORT,'command_conflict') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM connector_commands WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND command_id=NEW.command_id
  ) AND (
    NOT EXISTS (SELECT 1 FROM device_streams WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND device_id=NEW.device_id AND source_domain=NEW.source_domain)
    OR NEW.base_revision<>MAX(
      COALESCE((SELECT journal_through FROM device_streams WHERE account_id=NEW.account_id
        AND generation=NEW.generation AND device_id=NEW.device_id AND source_domain=NEW.source_domain),0),
      COALESCE((SELECT MAX(source_revision) FROM connector_commands WHERE account_id=NEW.account_id
        AND generation=NEW.generation AND device_id=NEW.device_id AND source_domain=NEW.source_domain
        AND outcome='applied' AND acknowledged_at IS NOT NULL),0)
    )
  ) THEN RAISE(ABORT,'command_conflict') END;
END;
CREATE TRIGGER connector_commands_update_fence BEFORE UPDATE ON connector_commands
WHEN NEW.state NOT IN ('purging','purged') BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN OLD.state IN ('purging','purged')
    THEN RAISE(ABORT,'command_expired') END;
END;
