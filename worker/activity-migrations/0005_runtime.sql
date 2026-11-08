-- AGPL-3.0-only. Runtime values live only in encrypted P5 R2 chunks.
CREATE TABLE runtime_contexts (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, sequence INTEGER NOT NULL, batch_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL, content_hash TEXT NOT NULL,
  source_sequence INTEGER NOT NULL, source_cut INTEGER NOT NULL,
  captured_at_ms INTEGER NOT NULL, received_at_ms INTEGER NOT NULL,
  commit_json TEXT NOT NULL, chunks_json TEXT NOT NULL,
  PRIMARY KEY (account_id,generation,device_id,source_domain,sequence),
  UNIQUE (account_id,generation,device_id,source_domain,batch_id)
);
CREATE TRIGGER runtime_acceptance BEFORE INSERT ON runtime_contexts BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM runtime_contexts WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
      AND (sequence=NEW.sequence OR batch_id=NEW.batch_id)
      AND (payload_hash<>NEW.payload_hash OR sequence<>NEW.sequence OR batch_id<>NEW.batch_id)
  ) THEN RAISE(ABORT,'batch_conflict') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM runtime_contexts WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND sequence=NEW.sequence
  ) AND NEW.sequence<>COALESCE((
    SELECT MAX(sequence) FROM runtime_contexts WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND device_id=NEW.device_id AND source_domain=NEW.source_domain
  ),0)+1 THEN RAISE(ABORT,'sequence_gap') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM device_streams WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
      AND journal_through=NEW.source_cut AND sequence=NEW.source_sequence
    UNION ALL
    SELECT 1 FROM ingest_receipts WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND state='projected'
      AND projected_through=NEW.source_cut AND sequence=NEW.source_sequence
    UNION ALL
    SELECT 1 FROM migration_runs WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
      AND state='complete' AND purpose='initial' AND cut=NEW.source_cut AND NEW.source_sequence=0
  ) THEN RAISE(ABORT,'runtime_source_cut') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM ingest_receipts WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
    UNION ALL
    SELECT 1 FROM migration_pages WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
  ) THEN RAISE(ABORT,'batch_conflict') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM content_uploads WHERE account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
  )<>json_array_length(NEW.chunks_json) OR EXISTS (
    SELECT 1 FROM json_each(NEW.chunks_json) part WHERE NOT EXISTS (
      SELECT 1 FROM content_uploads u WHERE u.account_id=NEW.account_id AND u.generation=NEW.generation
        AND u.device_id=NEW.device_id AND u.source_domain=NEW.source_domain AND u.batch_id=NEW.batch_id
        AND u.object_key=json_extract(part.value,'$.object_key')
        AND u.plaintext_hash=json_extract(part.value,'$.plaintext_hash')
        AND u.bytes=json_extract(part.value,'$.bytes') AND u.revision=NEW.source_cut
        AND u.state IN ('stored','committed')
    )
  ) THEN RAISE(ABORT,'runtime_content_missing') END;
END;
CREATE TRIGGER runtime_pin AFTER INSERT ON runtime_contexts BEGIN
  UPDATE content_uploads SET state='committed'
    WHERE account_id=NEW.account_id AND generation=NEW.generation AND device_id=NEW.device_id
      AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
END;
CREATE TRIGGER runtime_immutable BEFORE UPDATE ON runtime_contexts BEGIN
  SELECT RAISE(ABORT,'batch_conflict');
END;
CREATE TRIGGER runtime_upload_pin BEFORE UPDATE OF state ON content_uploads
WHEN NEW.state='purging' AND EXISTS (
  SELECT 1 FROM tenant_fences WHERE account_id=OLD.account_id
    AND generation=OLD.generation AND state='active'
) AND EXISTS (
  SELECT 1 FROM runtime_contexts WHERE account_id=OLD.account_id AND generation=OLD.generation
    AND device_id=OLD.device_id AND source_domain=OLD.source_domain AND batch_id=OLD.batch_id
) BEGIN
  SELECT RAISE(IGNORE);
END;
CREATE TRIGGER runtime_upload_sealed BEFORE INSERT ON content_uploads
WHEN EXISTS (
  SELECT 1 FROM runtime_contexts WHERE account_id=NEW.account_id AND generation=NEW.generation
    AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
) AND NOT EXISTS (
  SELECT 1 FROM content_uploads WHERE account_id=NEW.account_id AND generation=NEW.generation
    AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
    AND chunk_index=NEW.chunk_index
) BEGIN
  SELECT RAISE(ABORT,'batch_conflict');
END;
CREATE TRIGGER runtime_no_cdc BEFORE INSERT ON ingest_receipts
WHEN EXISTS (
  SELECT 1 FROM runtime_contexts WHERE account_id=NEW.account_id AND generation=NEW.generation
    AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
) BEGIN
  SELECT RAISE(ABORT,'batch_conflict');
END;
CREATE TRIGGER runtime_no_content BEFORE INSERT ON content_manifests
WHEN EXISTS (
  SELECT 1 FROM runtime_contexts WHERE account_id=NEW.account_id AND generation=NEW.generation
    AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
) BEGIN
  SELECT RAISE(ABORT,'batch_conflict');
END;
CREATE TRIGGER runtime_no_migration BEFORE INSERT ON migration_pages
WHEN EXISTS (
  SELECT 1 FROM runtime_contexts WHERE account_id=NEW.account_id AND generation=NEW.generation
    AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
) BEGIN
  SELECT RAISE(ABORT,'batch_conflict');
END;
