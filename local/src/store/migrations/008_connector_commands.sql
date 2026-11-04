-- These receipts are local authority, not replicated source content.
-- Keep them across disconnect/reconnect and source data retention.
CREATE TABLE connector_command_receipts (
  account_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  command_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (account_id, generation, device_id, source_domain, command_id)
);
