-- AGPL-3.0-only. Query text and result bodies are encrypted R2 objects, not D1 rows.
CREATE TABLE report_jobs (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, job_id TEXT NOT NULL, request_hash TEXT NOT NULL,
  scope_json TEXT NOT NULL, request_bytes INTEGER NOT NULL, request_chunks INTEGER NOT NULL,
  input_sequence INTEGER NOT NULL, input_cut INTEGER NOT NULL,
  input_runtime_sequence INTEGER NOT NULL, input_runtime_captured_at INTEGER NOT NULL,
  analysis_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('preparing','queued','running','complete','failed')),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  lease_fence INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
  dispatch_order INTEGER NOT NULL DEFAULT 0,
  result_chunks INTEGER, result_bytes INTEGER, result_hash TEXT, error_code TEXT,
  PRIMARY KEY(account_id,generation,device_id,source_domain,job_id)
);
CREATE INDEX report_jobs_dispatch ON report_jobs(state,lease_until,dispatch_order,created_at);
CREATE TABLE report_objects (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, job_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('request','result')),
  part INTEGER NOT NULL, plaintext_hash TEXT NOT NULL, bytes INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE, key_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('writing','stored','committed','purging','purged')),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  purge_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,generation,device_id,source_domain,job_id,role,part),
  FOREIGN KEY(account_id,generation,device_id,source_domain,job_id)
    REFERENCES report_jobs(account_id,generation,device_id,source_domain,job_id)
);
CREATE INDEX report_objects_purge ON report_objects(purge_order,expires_at);
CREATE TRIGGER report_job_insert_fence BEFORE INSERT ON report_jobs BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tenant_fences
    WHERE account_id=NEW.account_id AND generation=NEW.generation AND state='active')
    THEN RAISE(ABORT,'tenant_fenced') END;
END;
CREATE TRIGGER report_job_update_fence BEFORE UPDATE ON report_jobs BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tenant_fences
    WHERE account_id=NEW.account_id AND generation=NEW.generation AND state='active')
    THEN RAISE(ABORT,'tenant_fenced') END;
END;
CREATE TRIGGER report_object_insert_fence BEFORE INSERT ON report_objects BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tenant_fences
    WHERE account_id=NEW.account_id AND generation=NEW.generation AND state='active')
    THEN RAISE(ABORT,'tenant_fenced') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM report_objects
    WHERE account_id=NEW.account_id AND generation=NEW.generation AND device_id=NEW.device_id
      AND source_domain=NEW.source_domain AND job_id=NEW.job_id AND role=NEW.role AND part=NEW.part
      AND (plaintext_hash<>NEW.plaintext_hash OR bytes<>NEW.bytes))
    THEN RAISE(ABORT,'report_conflict') END;
END;
CREATE TRIGGER report_queued BEFORE UPDATE OF state ON report_jobs
WHEN NEW.state='queued' AND OLD.state='preparing' BEGIN
  SELECT CASE WHEN NEW.request_chunks<>(SELECT count(*) FROM report_objects o
    WHERE o.account_id=NEW.account_id AND o.generation=NEW.generation AND o.device_id=NEW.device_id
      AND o.source_domain=NEW.source_domain AND o.job_id=NEW.job_id
      AND o.role='request' AND o.state IN ('stored','committed'))
    OR NEW.request_bytes<>(SELECT COALESCE(sum(bytes),0) FROM report_objects o
    WHERE o.account_id=NEW.account_id AND o.generation=NEW.generation AND o.device_id=NEW.device_id
      AND o.source_domain=NEW.source_domain AND o.job_id=NEW.job_id
      AND o.role='request' AND o.state IN ('stored','committed'))
    THEN RAISE(ABORT,'report_integrity') END;
END;
CREATE TRIGGER report_publication BEFORE UPDATE OF state ON report_jobs
WHEN NEW.state='complete' AND OLD.state<>'complete' BEGIN
  SELECT CASE WHEN NEW.result_chunks IS NULL OR NEW.result_bytes IS NULL OR NEW.result_hash IS NULL
    OR NEW.result_chunks<>(SELECT count(*) FROM report_objects o WHERE o.account_id=NEW.account_id
      AND o.generation=NEW.generation AND o.device_id=NEW.device_id AND o.source_domain=NEW.source_domain
      AND o.job_id=NEW.job_id AND o.role='result' AND o.state IN ('stored','committed'))
    OR NEW.result_bytes<>(SELECT COALESCE(sum(bytes),0) FROM report_objects o WHERE o.account_id=NEW.account_id
      AND o.generation=NEW.generation AND o.device_id=NEW.device_id AND o.source_domain=NEW.source_domain
      AND o.job_id=NEW.job_id AND o.role='result' AND o.state IN ('stored','committed'))
    THEN RAISE(ABORT,'report_integrity') END;
END;
CREATE TRIGGER report_published AFTER UPDATE OF state ON report_jobs
WHEN NEW.state='complete' AND OLD.state<>'complete' BEGIN
  UPDATE report_objects SET state='committed' WHERE account_id=NEW.account_id AND generation=NEW.generation
    AND device_id=NEW.device_id AND source_domain=NEW.source_domain AND job_id=NEW.job_id;
  INSERT INTO account_heads(account_id,generation,head_seq) VALUES(NEW.account_id,NEW.generation,0)
    ON CONFLICT(account_id,generation) DO NOTHING;
  UPDATE account_heads SET head_seq=head_seq+1 WHERE account_id=NEW.account_id AND generation=NEW.generation;
  INSERT INTO account_changes(account_id,generation,seq,invalidation_kind)
    SELECT account_id,generation,head_seq,'report' FROM account_heads
      WHERE account_id=NEW.account_id AND generation=NEW.generation;
END;
