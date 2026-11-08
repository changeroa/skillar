-- User-approved device/project/root/content scope, separate from local capture.
CREATE TABLE device_consents (
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  consent_json TEXT NOT NULL CHECK (json_valid(consent_json)),
  granted_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, device_id, version),
  FOREIGN KEY (account_id, device_id) REFERENCES devices(account_id, device_id)
);
