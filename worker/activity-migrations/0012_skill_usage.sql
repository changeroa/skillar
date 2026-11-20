-- 스킬 탭 활동 필터용 평문 일별 집계 (v3 거친 집계).
-- 행 = (account_id, generation, device_id, source_domain, day, skill_id, agent) + reads/exposures.
-- day는 KST(UTC+9) 일자 'YYYY-MM-DD'(이벤트 ts 기준). 세션 ID·초 단위 시각·이벤트 원장은
-- 저장하지 않는다. 평문 저장 자체는 기존 승인(스킬 이름·읽힘 집계의 서버 DB 평문 저장) 범위이며,
-- 일별 롤업 세밀도로의 축소는 리드의 설계 결정이다(새 사용자 승인을 주장하지 않는다).
CREATE TABLE skill_daily_usage (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, day TEXT NOT NULL, skill_id TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT '',
  reads INTEGER NOT NULL DEFAULT 0, exposures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,generation,device_id,source_domain,day,skill_id,agent)
);
-- 백필이 스냅샷에서 재계산한 행은 별도 테이블에 두어 재백필이 수집 경로의 증분을 지우지 않게 한다.
CREATE TABLE skill_daily_usage_backfill (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, day TEXT NOT NULL, skill_id TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT '',
  reads INTEGER NOT NULL DEFAULT 0, exposures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,generation,device_id,source_domain,day,skill_id,agent)
);
-- 배치 단위 멱등 영수증: 같은 batch_id의 행을 두 번 반영하지 않는다(이벤트 원장은 두지 않는다).
CREATE TABLE skill_usage_batches (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, batch_id TEXT NOT NULL, applied_at INTEGER NOT NULL,
  PRIMARY KEY(account_id,batch_id)
);
-- 백필 완료 표식: 조회 API가 coverage(pending_backfill)를 구분하는 근거.
CREATE TABLE skill_usage_backfills (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, snapshot_cut INTEGER NOT NULL, backfilled_at INTEGER NOT NULL,
  PRIMARY KEY(account_id,generation,device_id,source_domain)
);
