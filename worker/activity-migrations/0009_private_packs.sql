-- Private pack definitions are encrypted R2 objects; D1 is the fenced directory.
CREATE TABLE private_pack_jobs (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL, name TEXT NOT NULL, digest TEXT NOT NULL,
  expected_digest TEXT, operation TEXT NOT NULL CHECK(operation IN ('create','update')),
  object_key TEXT NOT NULL UNIQUE, key_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('accepted','published','failed')),
  content_ready INTEGER NOT NULL DEFAULT 0 CHECK(content_ready IN (0,1)),
  unchanged INTEGER NOT NULL DEFAULT 0 CHECK(unchanged IN (0,1)),
  revision INTEGER, error TEXT, created_at INTEGER NOT NULL, purge_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,generation,request_id)
);
CREATE TABLE private_pack_heads (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, name TEXT NOT NULL,
  digest TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
  request_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  tombstoned INTEGER NOT NULL DEFAULT 0 CHECK(tombstoned IN (0,1)),
  PRIMARY KEY(account_id,generation,name)
);
CREATE TABLE private_pack_versions (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, name TEXT NOT NULL, digest TEXT NOT NULL,
  object_key TEXT NOT NULL, key_version INTEGER NOT NULL, created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY(account_id,generation,name,digest)
);
CREATE TRIGGER private_pack_job_insert BEFORE INSERT ON private_pack_jobs BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
    AND generation=NEW.generation AND state='active') THEN RAISE(ABORT,'tenant_fenced') END;
END;
CREATE TRIGGER private_pack_job_publish BEFORE UPDATE OF state ON private_pack_jobs
WHEN NEW.state='published' BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
    AND generation=NEW.generation AND state='active') THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_pack_heads h JOIN private_pack_versions v
    USING(account_id,generation,name,digest) WHERE h.account_id=NEW.account_id
    AND h.generation=NEW.generation AND h.name=NEW.name AND h.digest=NEW.digest
    AND h.revision=NEW.revision AND h.tombstoned=0) OR NEW.content_ready<>1
    THEN RAISE(ABORT,'pack_not_searchable') END;
END;
CREATE TRIGGER private_pack_head_insert BEFORE INSERT ON private_pack_heads BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
    AND generation=NEW.generation AND state='active') THEN RAISE(ABORT,'tenant_fenced') END;
END;
CREATE TRIGGER private_pack_head_update BEFORE UPDATE ON private_pack_heads BEGIN
  SELECT CASE WHEN OLD.tombstoned=1 AND NEW.tombstoned=0 THEN RAISE(ABORT,'pack_tombstoned') END;
  SELECT CASE WHEN NEW.tombstoned=0 AND NOT EXISTS(SELECT 1 FROM tenant_fences
    WHERE account_id=NEW.account_id AND generation=NEW.generation AND state='active')
    THEN RAISE(ABORT,'tenant_fenced') END;
END;
CREATE TRIGGER private_pack_version_insert BEFORE INSERT ON private_pack_versions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
    AND generation=NEW.generation AND state='active') THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM private_pack_heads WHERE account_id=NEW.account_id
    AND generation=NEW.generation AND name=NEW.name AND tombstoned=1)
    THEN RAISE(ABORT,'pack_tombstoned') END;
END;
