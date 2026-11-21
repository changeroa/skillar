-- AGPL-3.0-only. 세션 활동 요약(대시보드 재디자인 2단계). 새 평문 종류는 없다: 승인된 평문
-- (event_facts.session_id/kind/timestamp_ms, session_facts.started_ms/runtime)에서만 파생한다.
-- 세션당 1행. 목록·count·facet은 이 표만 읽어 요청 경로가 event_facts 전체를 훑지 않는다.
-- first_event_ms는 "처음 관측한 이벤트 시각"이며 세션 시작이 아니다. started_ms/runtime은 session_facts에
-- 실제 행이 있을 때만 채우고 없으면 NULL(runtime 'unknown'도 NULL). 값을 지어내지 않는다.
-- 유지 방식: event_facts/session_facts의 트리거가 같은 문장 안에서 증감한다. 그래서 수집(증분), 백필 재생,
-- tombstone 삭제, 범위 삭제, revision 갱신(kind/세션 이동 포함), 동시 재시도가 모두 같은 경로를 탄다.
-- 행이 실제로 바뀔 때만 트리거가 돌므로(ON CONFLICT ... WHERE revision 비교) 같은 이벤트 재시도는 증감하지 않는다.
-- 삭제/이동 시 first/last는 (scope, session_id, timestamp_ms) 인덱스의 양 끝 한 행씩만 읽어 다시 구한다.
CREATE TABLE session_activity (
  account_id TEXT NOT NULL, generation INTEGER NOT NULL, device_id TEXT NOT NULL,
  source_domain TEXT NOT NULL, session_id TEXT NOT NULL,
  first_event_ms INTEGER NOT NULL, last_event_ms INTEGER NOT NULL,
  events INTEGER NOT NULL, reads INTEGER NOT NULL, searches INTEGER NOT NULL,
  started_ms INTEGER, runtime TEXT,
  PRIMARY KEY (account_id, generation, device_id, source_domain, session_id)
);
CREATE INDEX session_activity_recent ON session_activity(
  account_id, generation, device_id, source_domain, last_event_ms DESC, session_id);
-- facet "검색 있음·읽기 없음"(검색 ≥1, 읽기 0)의 count/목록은 부분 인덱스 범위만 읽는다.
CREATE INDEX session_activity_search_no_read ON session_activity(
  account_id, generation, device_id, source_domain, last_event_ms DESC, session_id)
  WHERE searches > 0 AND reads = 0;
CREATE INDEX session_activity_runtime ON session_activity(
  account_id, generation, device_id, source_domain, runtime, last_event_ms DESC, session_id);

-- 기존 행에서 1회 파생(session_id가 아직 없는 행은 제외).
INSERT INTO session_activity
  (account_id,generation,device_id,source_domain,session_id,first_event_ms,last_event_ms,events,reads,searches,started_ms,runtime)
SELECT e.account_id,e.generation,e.device_id,e.source_domain,e.session_id,
  MIN(e.timestamp_ms),MAX(e.timestamp_ms),COUNT(*),SUM(e.kind='load'),SUM(e.kind='search'),
  (SELECT s.started_ms FROM session_facts s WHERE s.account_id=e.account_id AND s.generation=e.generation
     AND s.device_id=e.device_id AND s.source_domain=e.source_domain AND s.entity_key=e.session_id),
  (SELECT NULLIF(s.runtime,'unknown') FROM session_facts s WHERE s.account_id=e.account_id AND s.generation=e.generation
     AND s.device_id=e.device_id AND s.source_domain=e.source_domain AND s.entity_key=e.session_id)
FROM event_facts e WHERE e.session_id IS NOT NULL
GROUP BY e.account_id,e.generation,e.device_id,e.source_domain,e.session_id;

CREATE TRIGGER event_facts_activity_insert AFTER INSERT ON event_facts WHEN NEW.session_id IS NOT NULL
BEGIN
  INSERT INTO session_activity
    (account_id,generation,device_id,source_domain,session_id,first_event_ms,last_event_ms,events,reads,searches,started_ms,runtime)
  VALUES (NEW.account_id,NEW.generation,NEW.device_id,NEW.source_domain,NEW.session_id,
    NEW.timestamp_ms,NEW.timestamp_ms,1,NEW.kind IS 'load',NEW.kind IS 'search',
    (SELECT s.started_ms FROM session_facts s WHERE s.account_id=NEW.account_id AND s.generation=NEW.generation
       AND s.device_id=NEW.device_id AND s.source_domain=NEW.source_domain AND s.entity_key=NEW.session_id),
    (SELECT NULLIF(s.runtime,'unknown') FROM session_facts s WHERE s.account_id=NEW.account_id AND s.generation=NEW.generation
       AND s.device_id=NEW.device_id AND s.source_domain=NEW.source_domain AND s.entity_key=NEW.session_id))
  ON CONFLICT(account_id,generation,device_id,source_domain,session_id) DO UPDATE SET
    first_event_ms=MIN(first_event_ms,excluded.first_event_ms),
    last_event_ms=MAX(last_event_ms,excluded.last_event_ms),
    events=events+1, reads=reads+excluded.reads, searches=searches+excluded.searches;
END;

-- 삭제와 갱신의 "빼기" 절반. 갱신 때는 이미 새 값이 적용된 상태에서 돈다(같은 세션이면 새 행도 MIN/MAX에 포함).
CREATE TRIGGER event_facts_activity_delete AFTER DELETE ON event_facts WHEN OLD.session_id IS NOT NULL
BEGIN
  UPDATE session_activity SET events=events-1, reads=reads-(OLD.kind IS 'load'), searches=searches-(OLD.kind IS 'search'),
    first_event_ms=COALESCE((SELECT MIN(timestamp_ms) FROM event_facts WHERE account_id=OLD.account_id
      AND generation=OLD.generation AND device_id=OLD.device_id AND source_domain=OLD.source_domain
      AND session_id=OLD.session_id), first_event_ms),
    last_event_ms=COALESCE((SELECT MAX(timestamp_ms) FROM event_facts WHERE account_id=OLD.account_id
      AND generation=OLD.generation AND device_id=OLD.device_id AND source_domain=OLD.source_domain
      AND session_id=OLD.session_id), last_event_ms)
  WHERE account_id=OLD.account_id AND generation=OLD.generation AND device_id=OLD.device_id
    AND source_domain=OLD.source_domain AND session_id=OLD.session_id;
  DELETE FROM session_activity WHERE account_id=OLD.account_id AND generation=OLD.generation
    AND device_id=OLD.device_id AND source_domain=OLD.source_domain AND session_id=OLD.session_id AND events<=0;
END;

CREATE TRIGGER event_facts_activity_update_remove AFTER UPDATE OF session_id, kind, timestamp_ms ON event_facts
  WHEN OLD.session_id IS NOT NULL
BEGIN
  UPDATE session_activity SET events=events-1, reads=reads-(OLD.kind IS 'load'), searches=searches-(OLD.kind IS 'search'),
    first_event_ms=COALESCE((SELECT MIN(timestamp_ms) FROM event_facts WHERE account_id=OLD.account_id
      AND generation=OLD.generation AND device_id=OLD.device_id AND source_domain=OLD.source_domain
      AND session_id=OLD.session_id), first_event_ms),
    last_event_ms=COALESCE((SELECT MAX(timestamp_ms) FROM event_facts WHERE account_id=OLD.account_id
      AND generation=OLD.generation AND device_id=OLD.device_id AND source_domain=OLD.source_domain
      AND session_id=OLD.session_id), last_event_ms)
  WHERE account_id=OLD.account_id AND generation=OLD.generation AND device_id=OLD.device_id
    AND source_domain=OLD.source_domain AND session_id=OLD.session_id;
  DELETE FROM session_activity WHERE account_id=OLD.account_id AND generation=OLD.generation
    AND device_id=OLD.device_id AND source_domain=OLD.source_domain AND session_id=OLD.session_id AND events<=0;
END;

CREATE TRIGGER event_facts_activity_update_add AFTER UPDATE OF session_id, kind, timestamp_ms ON event_facts
  WHEN NEW.session_id IS NOT NULL
BEGIN
  INSERT INTO session_activity
    (account_id,generation,device_id,source_domain,session_id,first_event_ms,last_event_ms,events,reads,searches,started_ms,runtime)
  VALUES (NEW.account_id,NEW.generation,NEW.device_id,NEW.source_domain,NEW.session_id,
    NEW.timestamp_ms,NEW.timestamp_ms,1,NEW.kind IS 'load',NEW.kind IS 'search',
    (SELECT s.started_ms FROM session_facts s WHERE s.account_id=NEW.account_id AND s.generation=NEW.generation
       AND s.device_id=NEW.device_id AND s.source_domain=NEW.source_domain AND s.entity_key=NEW.session_id),
    (SELECT NULLIF(s.runtime,'unknown') FROM session_facts s WHERE s.account_id=NEW.account_id AND s.generation=NEW.generation
       AND s.device_id=NEW.device_id AND s.source_domain=NEW.source_domain AND s.entity_key=NEW.session_id))
  ON CONFLICT(account_id,generation,device_id,source_domain,session_id) DO UPDATE SET
    first_event_ms=MIN(first_event_ms,excluded.first_event_ms),
    last_event_ms=MAX(last_event_ms,excluded.last_event_ms),
    events=events+1, reads=reads+excluded.reads, searches=searches+excluded.searches;
END;

-- 시작 시각/runtime은 session_facts 행이 생기거나 바뀌거나 사라질 때 따라간다(이벤트가 있는 세션만 행이 있다).
CREATE TRIGGER session_facts_activity_upsert AFTER INSERT ON session_facts
BEGIN
  UPDATE session_activity SET started_ms=NEW.started_ms, runtime=NULLIF(NEW.runtime,'unknown')
  WHERE account_id=NEW.account_id AND generation=NEW.generation AND device_id=NEW.device_id
    AND source_domain=NEW.source_domain AND session_id=NEW.entity_key;
END;
CREATE TRIGGER session_facts_activity_update AFTER UPDATE OF started_ms, runtime ON session_facts
BEGIN
  UPDATE session_activity SET started_ms=NEW.started_ms, runtime=NULLIF(NEW.runtime,'unknown')
  WHERE account_id=NEW.account_id AND generation=NEW.generation AND device_id=NEW.device_id
    AND source_domain=NEW.source_domain AND session_id=NEW.entity_key;
END;
CREATE TRIGGER session_facts_activity_delete AFTER DELETE ON session_facts
BEGIN
  UPDATE session_activity SET started_ms=NULL, runtime=NULL
  WHERE account_id=OLD.account_id AND generation=OLD.generation AND device_id=OLD.device_id
    AND source_domain=OLD.source_domain AND session_id=OLD.entity_key;
END;
