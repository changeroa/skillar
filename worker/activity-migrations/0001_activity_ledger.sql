-- AGPL-3.0-only. Dedicated ACTIVITY shard, never the Google ACCOUNTS database.
CREATE TABLE tenant_fences (
  account_id TEXT PRIMARY KEY, generation INTEGER NOT NULL CHECK (generation > 0),
  state TEXT NOT NULL CHECK (state IN ('active','closed'))
);
CREATE TABLE device_streams (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, sequence INTEGER NOT NULL, journal_through INTEGER NOT NULL,
  PRIMARY KEY (account_id,generation,device_id,source_domain)
);
CREATE TABLE ingest_receipts (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, batch_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  sequence INTEGER NOT NULL, journal_from INTEGER NOT NULL, journal_through INTEGER NOT NULL,
  commit_id TEXT NOT NULL UNIQUE, durable_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('projecting','projected')),
  projected_through INTEGER, change_seq INTEGER,
  PRIMARY KEY (account_id,generation,device_id,source_domain,batch_id),
  UNIQUE (account_id,generation,device_id,source_domain,sequence)
);
CREATE TRIGGER receipt_acceptance BEFORE INSERT ON ingest_receipts BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM ingest_receipts WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
      AND (payload_hash<>NEW.payload_hash OR sequence<>NEW.sequence
        OR journal_from<>NEW.journal_from OR journal_through<>NEW.journal_through)
  ) THEN RAISE(ABORT,'batch_conflict') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM ingest_receipts WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
  ) AND (
    NEW.sequence<>COALESCE((SELECT sequence FROM device_streams WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND device_id=NEW.device_id AND source_domain=NEW.source_domain),0)+1
    OR NEW.journal_from<>COALESCE((SELECT journal_through FROM device_streams WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND device_id=NEW.device_id AND source_domain=NEW.source_domain),0)+1
  ) THEN RAISE(ABORT,'sequence_gap') END;
END;
CREATE TRIGGER receipt_final_fence BEFORE UPDATE ON ingest_receipts BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
END;
CREATE TABLE session_facts (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, entity_key TEXT NOT NULL, revision INTEGER NOT NULL,
  facts_json TEXT NOT NULL, runtime TEXT NOT NULL, started_ms INTEGER NOT NULL, ended_ms INTEGER,
  PRIMARY KEY (account_id,generation,device_id,source_domain,entity_key)
);
CREATE TABLE event_facts (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, entity_key TEXT NOT NULL, revision INTEGER NOT NULL,
  facts_json TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, source_order INTEGER,
  source_key TEXT, recording_orders_json TEXT NOT NULL,
  PRIMARY KEY (account_id,generation,device_id,source_domain,entity_key),
  UNIQUE (account_id,generation,device_id,source_domain,source_key)
);
CREATE INDEX event_facts_order ON event_facts(
  account_id,generation,device_id,source_domain,timestamp_ms,source_order,entity_key
);
CREATE TABLE span_facts (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, entity_key TEXT NOT NULL, revision INTEGER NOT NULL,
  facts_json TEXT NOT NULL, trace_id TEXT NOT NULL, span_id TEXT NOT NULL,
  start_ms INTEGER, end_ms INTEGER, recording_orders_json TEXT NOT NULL,
  PRIMARY KEY (account_id,generation,device_id,source_domain,entity_key),
  UNIQUE (account_id,generation,device_id,source_domain,trace_id,span_id)
);
CREATE TABLE entity_tombstones (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL,
  revision INTEGER NOT NULL, source_key TEXT,
  PRIMARY KEY (account_id,generation,device_id,source_domain,entity_type,entity_key)
);
CREATE TABLE account_heads (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, head_seq INTEGER NOT NULL,
  min_replay_seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id,generation)
);
CREATE TABLE account_changes (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, seq INTEGER NOT NULL,
  invalidation_kind TEXT NOT NULL, PRIMARY KEY (account_id,generation,seq)
);
CREATE TABLE jobs (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, batch_id TEXT NOT NULL, state TEXT NOT NULL,
  input_revision INTEGER NOT NULL, lease_fence INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id,generation,device_id,source_domain,batch_id)
);
CREATE TABLE dispatch_outbox (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, batch_id TEXT NOT NULL, state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id,generation,device_id,source_domain,batch_id)
);
