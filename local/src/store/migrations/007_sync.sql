-- Local raw history is not a cloud payload. Consent is applied before outbox insertion.
CREATE TABLE sync_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  source_domain TEXT NOT NULL UNIQUE
);
INSERT INTO sync_identity SELECT 1, domain FROM recording_clock WHERE singleton = 1;

CREATE TABLE sync_journal (
  seq INTEGER PRIMARY KEY AUTOINCREMENT CHECK (seq <= 9007199254740991),
  table_name TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  source_order INTEGER,
  row_json TEXT,
  before_json TEXT,
  CHECK ((operation = 'delete') = (row_json IS NULL))
);
CREATE INDEX sync_journal_entity ON sync_journal(table_name, entity_key, seq);
-- RAISE(ABORT) must defeat an outer INSERT OR IGNORE on counter exhaustion.
CREATE TRIGGER sync_journal_range BEFORE INSERT ON sync_journal
WHEN COALESCE((SELECT seq FROM sqlite_sequence WHERE name='sync_journal'),0) >= 9007199254740991
BEGIN
  SELECT RAISE(ABORT, 'sync journal exhausted');
END;

CREATE TABLE sync_streams (
  stream_id TEXT PRIMARY KEY,
  source_domain TEXT NOT NULL,
  device_id TEXT NOT NULL,
  next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence BETWEEN 1 AND 9007199254740991),
  ack_sequence INTEGER NOT NULL DEFAULT 0,
  ack_hash TEXT,
  ack_cut INTEGER NOT NULL DEFAULT 0,
  CHECK (ack_sequence < next_sequence)
);
CREATE TABLE sync_outbox (
  stream_id TEXT NOT NULL REFERENCES sync_streams(stream_id),
  sequence INTEGER NOT NULL,
  batch_id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 1 AND 262144),
  journal_from INTEGER NOT NULL,
  journal_through INTEGER NOT NULL CHECK (journal_through >= journal_from),
  PRIMARY KEY (stream_id, sequence)
);
CREATE TRIGGER sync_outbox_immutable BEFORE UPDATE ON sync_outbox BEGIN
  SELECT RAISE(ABORT, 'sync outbox is immutable');
END;
