-- Dedicated synthetic probe database only. Safe to rerun without changing inputs.
CREATE VIRTUAL TABLE IF NOT EXISTS parity_fts USING fts5(
  uri UNINDEXED, name, description, when_to_use, examples, aliases_ko, body_head,
  tokenize = 'trigram'
);
INSERT INTO parity_fts(rowid, uri, name, description, when_to_use, examples, aliases_ko, body_head)
SELECT 1, 'skill://probe/name', 'workflow', '', '', '', '메시지 작성', ''
WHERE NOT EXISTS (SELECT 1 FROM parity_fts WHERE rowid = 1);
INSERT INTO parity_fts(rowid, uri, name, description, when_to_use, examples, aliases_ko, body_head)
SELECT 2, 'skill://probe/body', '', '', '', '', '', 'workflow'
WHERE NOT EXISTS (SELECT 1 FROM parity_fts WHERE rowid = 2);
CREATE TABLE IF NOT EXISTS parity_json (
  id INTEGER PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS parity_audit (id INTEGER PRIMARY KEY, revision INTEGER);
CREATE TRIGGER IF NOT EXISTS parity_revision AFTER UPDATE ON parity_json
BEGIN
  INSERT OR REPLACE INTO parity_audit VALUES (NEW.id, NEW.revision);
END;
INSERT OR IGNORE INTO parity_json VALUES (1, '{"unknown":null,"zero":0,"text":"İSTANBUL"}', 1);
UPDATE parity_json SET revision = 2 WHERE id = 1;
SELECT uri, bm25(parity_fts, 0, 8, 2, 3, 5, 6, 1) AS score
FROM parity_fts WHERE parity_fts MATCH '"workflow"' ORDER BY score;
SELECT uri FROM parity_fts WHERE parity_fts MATCH '"메시지"';
SELECT json_extract(value, '$.unknown') AS unknown,
  json_extract(value, '$.zero') AS zero, lower(json_extract(value, '$.text')) AS sql_lower
FROM parity_json;
SELECT revision FROM parity_audit WHERE id = 1;
CREATE INDEX IF NOT EXISTS parity_json_revision ON parity_json(revision);
SELECT COUNT(*) AS indexed_rows FROM parity_json INDEXED BY parity_json_revision WHERE revision = 2;
