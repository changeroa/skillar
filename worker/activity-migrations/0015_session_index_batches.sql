-- AGPL-3.0-only. Session index receipts (recovery of 0014 replay).
-- skill_usage_batches는 일별 집계 증분의 영수증이다. 0014 이전에 수집된 배치도 그 영수증을 가지므로,
-- 세션 인덱스(읽음 관계)의 "이미 증분 반영됨" 판단에 재사용하면 그 배치들이 영영 복구되지 않는다.
-- 이 영수증은 session_skill_reads 증분과 같은 커밋에서만 쓴다. 영수증이 없는 보관 배치만 백필이
-- session_skill_reads_backfill로 다시 계산한다(이중 계산 금지). 평문 범위는 늘지 않는다(배치 ID만).
CREATE TABLE session_index_batches (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, batch_id TEXT NOT NULL, applied_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, batch_id)
);
CREATE INDEX session_index_batches_scope ON session_index_batches(
  account_id, generation, device_id, source_domain);
