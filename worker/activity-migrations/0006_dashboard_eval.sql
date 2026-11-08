-- Cloud-owned cases are separate from local-authoritative snapshot eval_cases.
-- Raw query, URI and trace values live only in encrypted R2.
CREATE TABLE dashboard_eval_cases (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, request_id TEXT NOT NULL, case_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL, bytes INTEGER NOT NULL, object_key TEXT NOT NULL UNIQUE,
  key_version INTEGER NOT NULL, consent_version INTEGER NOT NULL,
  requires_path INTEGER NOT NULL CHECK(requires_path IN (0,1)),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('writing','stored','purging','purged')),
  purge_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,generation,device_id,source_domain,request_id)
);
CREATE TRIGGER dashboard_eval_insert_fence BEFORE INSERT ON dashboard_eval_cases BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
END;
CREATE TRIGGER dashboard_eval_store_fence BEFORE UPDATE OF state ON dashboard_eval_cases
WHEN NEW.state='stored' BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_fences WHERE account_id=NEW.account_id
      AND generation=NEW.generation AND state='active'
  ) THEN RAISE(ABORT,'tenant_fenced') END;
END;
