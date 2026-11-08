-- AGPL-3.0-only. Raw rows and source keys remain exclusively in encrypted R2.
CREATE TABLE migration_runs (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, snapshot_id TEXT NOT NULL,
  begin_json TEXT NOT NULL, begin_hash TEXT NOT NULL, cut INTEGER NOT NULL,
  page_count INTEGER NOT NULL, snapshot_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'initial' CHECK (purpose IN ('initial','backfill')),
  state TEXT NOT NULL CHECK (state IN ('staging','complete','abandoned')),
  rollback_requested INTEGER NOT NULL DEFAULT 0,
  change_seq INTEGER,
  cursor_sequence INTEGER, cursor_through INTEGER,
  PRIMARY KEY (account_id,generation,device_id,source_domain,snapshot_id)
);
CREATE TABLE migration_pages (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, snapshot_id TEXT NOT NULL, page_index INTEGER NOT NULL,
  batch_id TEXT NOT NULL, page_json TEXT NOT NULL, page_hash TEXT NOT NULL,
  PRIMARY KEY (account_id,generation,device_id,source_domain,snapshot_id,page_index),
  UNIQUE (account_id,generation,device_id,source_domain,batch_id),
  FOREIGN KEY (account_id,generation,device_id,source_domain,snapshot_id)
    REFERENCES migration_runs(account_id,generation,device_id,source_domain,snapshot_id)
);
CREATE VIEW migration_snapshots AS
  SELECT * FROM migration_runs WHERE state='complete';

CREATE TRIGGER migration_begin_fence BEFORE INSERT ON migration_runs BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM migration_runs WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
      AND snapshot_id=NEW.snapshot_id AND begin_hash<>NEW.begin_hash
  ) THEN RAISE(ABORT,'migration_conflict') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM migration_runs WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND snapshot_id=NEW.snapshot_id
  ) AND NEW.purpose='initial' AND EXISTS (
    SELECT 1 FROM device_streams WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
  ) THEN RAISE(ABORT,'migration_epoch_required') END;
  SELECT CASE WHEN NEW.purpose='backfill' AND NOT EXISTS (
    SELECT 1 FROM device_streams WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
  ) THEN RAISE(ABORT,'migration_epoch_required') END;
END;

CREATE TRIGGER migration_page_fence BEFORE INSERT ON migration_pages BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM migration_pages WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
      AND snapshot_id=NEW.snapshot_id AND page_index=NEW.page_index AND page_hash<>NEW.page_hash
  ) THEN RAISE(ABORT,'migration_conflict') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM migration_runs WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND snapshot_id=NEW.snapshot_id
      AND state='staging' AND NEW.page_index>=0 AND NEW.page_index<page_count
  ) THEN RAISE(ABORT,'migration_closed') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM ingest_receipts WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
  ) THEN RAISE(ABORT,'migration_conflict') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM content_uploads u WHERE u.account_id=NEW.account_id AND u.generation=NEW.generation
      AND u.device_id=NEW.device_id AND u.source_domain=NEW.source_domain AND u.batch_id=NEW.batch_id
  )<>json_array_length(NEW.page_json,'$.chunks') THEN RAISE(ABORT,'migration_content_missing') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.page_json,'$.chunks') part WHERE NOT EXISTS (
      SELECT 1 FROM content_uploads u WHERE u.account_id=NEW.account_id AND u.generation=NEW.generation
        AND u.device_id=NEW.device_id AND u.source_domain=NEW.source_domain AND u.batch_id=NEW.batch_id
        AND u.chunk_index=json_extract(part.value,'$.index')
        AND u.plaintext_hash=json_extract(part.value,'$.plaintextHash')
        AND u.bytes=json_extract(part.value,'$.bytes')
        AND u.revision=json_extract(part.value,'$.revision')
        AND u.state IN ('stored','committed')
    )
  ) THEN RAISE(ABORT,'migration_content_missing') END;
END;

CREATE TRIGGER migration_upload_sealed BEFORE INSERT ON content_uploads
WHEN EXISTS (
  SELECT 1 FROM migration_pages p WHERE p.account_id=NEW.account_id AND p.generation=NEW.generation
    AND p.device_id=NEW.device_id AND p.source_domain=NEW.source_domain AND p.batch_id=NEW.batch_id
) AND NOT EXISTS (
  SELECT 1 FROM content_uploads u WHERE u.account_id=NEW.account_id AND u.generation=NEW.generation
    AND u.device_id=NEW.device_id AND u.source_domain=NEW.source_domain AND u.batch_id=NEW.batch_id
    AND u.chunk_index=NEW.chunk_index
) BEGIN
  SELECT RAISE(ABORT,'batch_conflict');
END;

-- "committed" pins transport bytes, not a device ACK. Staged pages already have
-- a durable reference. Exclude them from the sweeper's candidate LIMIT so they
-- cannot starve unrelated orphan cleanup; the claim guard below covers a sweep
-- that selected candidates immediately before the page was staged.
CREATE TRIGGER migration_page_pin AFTER INSERT ON migration_pages BEGIN
  UPDATE content_uploads SET state='committed'
    WHERE account_id=NEW.account_id AND generation=NEW.generation AND device_id=NEW.device_id
      AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id;
END;
CREATE TRIGGER migration_abandon_unpin AFTER UPDATE OF state ON migration_runs
WHEN OLD.state='staging' AND NEW.state='abandoned' BEGIN
  UPDATE content_uploads SET state='stored'
    WHERE account_id=NEW.account_id AND generation=NEW.generation AND device_id=NEW.device_id
      AND source_domain=NEW.source_domain AND state='committed' AND batch_id IN (
        SELECT batch_id FROM migration_pages WHERE account_id=NEW.account_id AND generation=NEW.generation
          AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND snapshot_id=NEW.snapshot_id
      );
END;

-- The existing P5 sweeper must claim state=purging before deleting R2.
-- Pin all staged and published pages, but never block closed-generation purge.
-- RAISE(IGNORE) makes its claim report changes=0; it then cannot delete R2.
CREATE TRIGGER migration_upload_pin BEFORE UPDATE OF state ON content_uploads
WHEN NEW.state='purging' AND EXISTS (
  SELECT 1 FROM tenant_fences f WHERE f.account_id=OLD.account_id
    AND f.generation=OLD.generation AND f.state='active'
) AND EXISTS (
  SELECT 1 FROM migration_pages p JOIN migration_runs r USING
    (account_id,generation,device_id,source_domain,snapshot_id)
  WHERE p.account_id=OLD.account_id AND p.generation=OLD.generation AND p.device_id=OLD.device_id
    AND p.source_domain=OLD.source_domain AND p.batch_id=OLD.batch_id
    AND r.state IN ('staging','complete')
) BEGIN
  SELECT RAISE(IGNORE);
END;
CREATE TRIGGER migration_no_cdc_manifest BEFORE INSERT ON content_manifests
WHEN EXISTS (
  SELECT 1 FROM migration_pages p WHERE p.account_id=NEW.account_id AND p.generation=NEW.generation
    AND p.device_id=NEW.device_id AND p.source_domain=NEW.source_domain AND p.batch_id=NEW.batch_id
) BEGIN
  SELECT RAISE(ABORT,'migration_conflict');
END;

CREATE TRIGGER migration_update_fence BEFORE UPDATE ON migration_runs BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
END;
CREATE TRIGGER migration_publication BEFORE UPDATE OF state ON migration_runs
WHEN OLD.state='staging' AND NEW.state='complete' BEGIN
  SELECT CASE WHEN NEW.purpose='initial' AND EXISTS (
    SELECT 1 FROM device_streams WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
  ) THEN RAISE(ABORT,'migration_epoch_required') END;
  SELECT CASE WHEN NEW.purpose='backfill' AND NOT EXISTS (
    SELECT 1 FROM device_streams WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
  ) THEN RAISE(ABORT,'migration_epoch_required') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM migration_pages WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND snapshot_id=NEW.snapshot_id
  )<>NEW.page_count THEN RAISE(ABORT,'migration_incomplete') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM migration_pages p, json_each(p.page_json,'$.chunks') part
    WHERE p.account_id=NEW.account_id AND p.generation=NEW.generation AND p.device_id=NEW.device_id
      AND p.source_domain=NEW.source_domain AND p.snapshot_id=NEW.snapshot_id AND NOT EXISTS (
        SELECT 1 FROM content_uploads u WHERE u.account_id=p.account_id AND u.generation=p.generation
          AND u.device_id=p.device_id AND u.source_domain=p.source_domain AND u.batch_id=p.batch_id
          AND u.chunk_index=json_extract(part.value,'$.index') AND u.state IN ('stored','committed')
      )
  ) THEN RAISE(ABORT,'migration_content_missing') END;
  INSERT INTO device_streams(account_id,generation,device_id,source_domain,sequence,journal_through)
    SELECT NEW.account_id,NEW.generation,NEW.device_id,NEW.source_domain,0,NEW.cut
      WHERE NEW.purpose='initial';
  UPDATE content_uploads SET state='committed' WHERE account_id=NEW.account_id AND generation=NEW.generation
    AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id IN (
      SELECT batch_id FROM migration_pages WHERE account_id=NEW.account_id AND generation=NEW.generation
        AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND snapshot_id=NEW.snapshot_id
    );
  INSERT INTO account_heads(account_id,generation,head_seq) VALUES (NEW.account_id,NEW.generation,0)
    ON CONFLICT(account_id,generation) DO NOTHING;
  UPDATE account_heads SET head_seq=head_seq+1 WHERE account_id=NEW.account_id AND generation=NEW.generation;
  INSERT INTO account_changes(account_id,generation,seq,invalidation_kind)
    SELECT account_id,generation,head_seq,'activity' FROM account_heads
      WHERE account_id=NEW.account_id AND generation=NEW.generation;
  INSERT INTO jobs(account_id,generation,device_id,source_domain,batch_id,state,input_revision)
    VALUES (NEW.account_id,NEW.generation,NEW.device_id,NEW.source_domain,
      'migration:'||NEW.snapshot_id,'pending',NEW.cut);
  INSERT INTO dispatch_outbox(account_id,generation,device_id,source_domain,batch_id,state)
    VALUES (NEW.account_id,NEW.generation,NEW.device_id,NEW.source_domain,
      'migration:'||NEW.snapshot_id,'pending');
END;
-- Last statement in the publication transaction; any fence failure rolls all effects back.
CREATE TRIGGER migration_publication_head AFTER UPDATE OF state ON migration_runs
WHEN OLD.state='staging' AND NEW.state='complete' BEGIN
  UPDATE migration_runs SET cursor_sequence=(
    SELECT sequence FROM device_streams WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
  ),cursor_through=(
    SELECT journal_through FROM device_streams WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
  ),change_seq=(
    SELECT head_seq FROM account_heads WHERE account_id=NEW.account_id AND generation=NEW.generation
  ) WHERE account_id=NEW.account_id AND generation=NEW.generation AND device_id=NEW.device_id
    AND source_domain=NEW.source_domain AND snapshot_id=NEW.snapshot_id;
END;
