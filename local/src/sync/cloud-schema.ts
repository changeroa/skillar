// P4's immutable outbox/ACK schema is reused in this separate physical spool.
// Foreign-key references make pending request blobs and cursor commits atomic.
export const CLOUD_SCHEMA = `
CREATE TABLE IF NOT EXISTS blobs(
  hash TEXT PRIMARY KEY,bytes BLOB NOT NULL,nbytes INTEGER NOT NULL CHECK(nbytes>=0)
);
CREATE TABLE IF NOT EXISTS lease(
  id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,epoch INTEGER NOT NULL,until_ms INTEGER NOT NULL
);
INSERT OR IGNORE INTO lease VALUES(1,'',0,0);
CREATE TABLE IF NOT EXISTS sync_streams(
  stream_id TEXT PRIMARY KEY,source_domain TEXT NOT NULL,device_id TEXT NOT NULL,
  next_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_sequence BETWEEN 1 AND 9007199254740991),
  ack_sequence INTEGER NOT NULL DEFAULT 0,ack_hash TEXT,ack_cut INTEGER NOT NULL DEFAULT 0,
  CHECK(ack_sequence<next_sequence)
);
CREATE TABLE IF NOT EXISTS sync_outbox(
  stream_id TEXT NOT NULL REFERENCES sync_streams(stream_id),sequence INTEGER NOT NULL,
  batch_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 1 AND 262144),
  journal_from INTEGER NOT NULL,journal_through INTEGER NOT NULL CHECK(journal_through>=journal_from),
  PRIMARY KEY(stream_id,sequence)
);
CREATE TRIGGER IF NOT EXISTS sync_outbox_immutable BEFORE UPDATE ON sync_outbox BEGIN
  SELECT RAISE(ABORT,'sync outbox is immutable');
END;
CREATE TABLE IF NOT EXISTS sync_outbox_blobs(
  stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,hash TEXT NOT NULL REFERENCES blobs(hash),
  PRIMARY KEY(stream_id,sequence,hash),
  FOREIGN KEY(stream_id,sequence) REFERENCES sync_outbox(stream_id,sequence) ON DELETE CASCADE
);
`;
