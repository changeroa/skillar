-- AGPL-3.0-only. Session index (dashboard redesign phase 1).
-- 사용자 승인 범위(Slack #skillar 1795134451.161949, 2026-11-21 "ㄱㄱ", 제안 2026-11-20):
-- 평문으로 늘리는 것은 (1) 세션 시작 시각 인덱스(+automated 표식), (2) 이벤트의 session_id·kind 열과
-- 인덱스, (3) 세션 ↔ 스킬(digest) 읽기 관계(session_skill_reads)뿐이다. 요청문·검색어·인수·오류·
-- 경로는 계속 암호화 콘텐츠에만 있다.
-- 운영 적용은 리드(이연) 소유. 아래 UPDATE 두 개는 기존 행 1회 백필이며 전체 테이블을 한 번 읽는다.
-- 운영에서는 트래픽이 적은 때 한 번만 실행하고, 요청 경로에서는 절대 실행하지 않는다.
ALTER TABLE session_facts ADD COLUMN automated INTEGER;
ALTER TABLE event_facts ADD COLUMN session_id TEXT;
ALTER TABLE event_facts ADD COLUMN kind TEXT;
CREATE INDEX session_facts_started ON session_facts(
  account_id, generation, device_id, source_domain, started_ms DESC, entity_key);
CREATE INDEX event_facts_session ON event_facts(
  account_id, generation, device_id, source_domain, session_id, timestamp_ms);
UPDATE session_facts SET automated=CASE json_extract(facts_json,'$.automated')
  WHEN 1 THEN 1 WHEN 0 THEN 0 ELSE NULL END WHERE automated IS NULL;
UPDATE event_facts SET session_id=json_extract(facts_json,'$.sessionId'),
  kind=json_extract(facts_json,'$.kind') WHERE session_id IS NULL;
-- 수집 경로 증분(읽음만; 검색 노출은 skill_daily_usage가 맡는다). first_read_ms는 MIN, reads는 합.
-- digest: 같은 문서(수집 배치 하나) 안에서 읽음 이벤트의 skill_uri에 든 버전 → 이벤트 load_id의
-- loads.manifest_digest → 같은 세션·스킬에서 엄격히 앞선 증거 있는 load의 digest 순으로 실제 근거만
-- 쓴다. 과거 읽음·미래 load·다른 배치 행으로 추정하지 않는다. 근거가 없으면 digest=''(알 수 없음;
-- PK에 NULL을 둘 수 없어 빈 값으로 표현하고 API는 null로 낸다), digest_source=NULL.
-- digest_source는 근거 구분용 기술 메타데이터('event' | 'session_load' | NULL)다.
CREATE TABLE session_skill_reads (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, session_id TEXT NOT NULL, skill_id TEXT NOT NULL,
  digest TEXT NOT NULL DEFAULT '', first_read_ms INTEGER NOT NULL,
  reads INTEGER NOT NULL DEFAULT 0, digest_source TEXT,
  PRIMARY KEY (account_id, generation, device_id, source_domain, session_id, skill_id, digest)
);
-- 백필이 스냅샷에서 재계산한 행(재백필이 수집 증분을 지우지 않게 분리; skill_daily_usage_backfill과 같은 규칙).
CREATE TABLE session_skill_reads_backfill (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, session_id TEXT NOT NULL, skill_id TEXT NOT NULL,
  digest TEXT NOT NULL DEFAULT '', first_read_ms INTEGER NOT NULL,
  reads INTEGER NOT NULL DEFAULT 0, digest_source TEXT,
  PRIMARY KEY (account_id, generation, device_id, source_domain, session_id, skill_id, digest)
);
CREATE INDEX session_skill_reads_skill ON session_skill_reads(
  account_id, generation, device_id, source_domain, skill_id, first_read_ms);
CREATE INDEX session_skill_reads_backfill_skill ON session_skill_reads_backfill(
  account_id, generation, device_id, source_domain, skill_id, first_read_ms);
