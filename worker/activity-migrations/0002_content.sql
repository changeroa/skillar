-- AGPL-3.0-only. Private managed content remains in R2, never receipt JSON.
CREATE TABLE account_content_keys (
  account_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  key_version TEXT NOT NULL,
  wrapped_key_json TEXT NOT NULL,
  PRIMARY KEY (account_id,generation,key_version)
);
CREATE TRIGGER account_content_key_fence BEFORE INSERT ON account_content_keys BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
END;
CREATE TABLE content_uploads (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL,
  device_id TEXT NOT NULL, source_domain TEXT NOT NULL, batch_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL, revision INTEGER NOT NULL,
  plaintext_hash TEXT NOT NULL, bytes INTEGER NOT NULL,
  scope_hash TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
  key_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('writing','stored','committed','purging','purged')),
  created_at INTEGER NOT NULL,
  purge_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id,generation,device_id,source_domain,batch_id,chunk_index)
);
CREATE TRIGGER content_upload_acceptance BEFORE INSERT ON content_uploads BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM content_uploads WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND device_id=NEW.device_id
      AND source_domain=NEW.source_domain AND batch_id=NEW.batch_id
      AND chunk_index=NEW.chunk_index
      AND (plaintext_hash<>NEW.plaintext_hash OR bytes<>NEW.bytes
        OR revision<>NEW.revision OR scope_hash<>NEW.scope_hash)
  ) THEN RAISE(ABORT,'batch_conflict') END;
END;
CREATE TABLE content_manifests (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL,
  device_id TEXT NOT NULL, source_domain TEXT NOT NULL, batch_id TEXT NOT NULL,
  content_hash TEXT NOT NULL, total_bytes INTEGER NOT NULL,
  manifest_json TEXT NOT NULL, commit_id TEXT NOT NULL,
  PRIMARY KEY (account_id,generation,device_id,source_domain,batch_id),
  FOREIGN KEY (account_id,generation,device_id,source_domain,batch_id)
    REFERENCES ingest_receipts(account_id,generation,device_id,source_domain,batch_id)
);
CREATE TRIGGER content_manifest_fence BEFORE INSERT ON content_manifests BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM ingest_receipts WHERE commit_id=NEW.commit_id
      AND account_id=NEW.account_id AND generation=NEW.generation
      AND device_id=NEW.device_id AND source_domain=NEW.source_domain
      AND batch_id=NEW.batch_id AND state='projecting'
  ) THEN RAISE(ABORT,'content_receipt_required') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.manifest_json,'$.chunks') part
    WHERE NOT EXISTS (
      SELECT 1 FROM content_uploads u WHERE u.account_id=NEW.account_id
        AND u.generation=NEW.generation AND u.device_id=NEW.device_id
        AND u.source_domain=NEW.source_domain AND u.batch_id=NEW.batch_id
        AND u.object_key=json_extract(part.value,'$.objectKey')
        AND u.state IN ('stored','committed')
    )
  ) THEN RAISE(ABORT,'content_not_stored') END;
END;
