// AGPL-3.0-only. 세션 읽기 API의 SQL 빌더(의존성 없음: 테스트가 노드에서 직접 불러 EXPLAIN을 확인한다).
export type SessionFilter = { activeFromMs?: number; activeToMs?: number; runtimes?: string[]; searchWithoutRead?: boolean; skillId?: string };
const WHERE_SCOPE = "account_id=? AND generation=? AND device_id=? AND source_domain=?";
export function filterSql(f: SessionFilter) {
  const clauses: string[] = [];
  const args: (number | string)[] = [];
  if (f.activeFromMs !== undefined) { clauses.push("last_event_ms>=?"); args.push(f.activeFromMs); }
  if (f.activeToMs !== undefined) { clauses.push("last_event_ms<=?"); args.push(f.activeToMs); }
  if (f.runtimes !== undefined && f.runtimes.length > 0) {
    clauses.push(`runtime IN (${f.runtimes.map(() => "?").join(",")})`); args.push(...f.runtimes);
  }
  // 부분 인덱스(session_activity_search_no_read)와 같은 술어여야 플래너가 쓴다.
  if (f.searchWithoutRead === true) clauses.push("searches > 0 AND reads = 0");
  // 스킬 필터: 세션이 이 스킬(skill:// 와 skillar:// 두 저장 URI 형태)을 읽은 적이 있는가. 수집 표와 백필 표 어느 쪽이든 된다.
  // 두 표의 기본키 앞부분(스코프+session_id)으로 찾고 skill_id 접두 범위로 거른다.
  if (f.skillId !== undefined) {
    const reads = (table: string) => `EXISTS (SELECT 1 FROM ${table} r WHERE r.account_id=session_activity.account_id
      AND r.generation=session_activity.generation AND r.device_id=session_activity.device_id
      AND r.source_domain=session_activity.source_domain AND r.session_id=session_activity.session_id
      AND ((r.skill_id>=? AND r.skill_id<?) OR (r.skill_id>=? AND r.skill_id<?)))`;
    clauses.push(`(${reads("session_skill_reads")} OR ${reads("session_skill_reads_backfill")})`);
    for (let i = 0; i < 2; i++) {
      args.push(`skill://private/${f.skillId}/`, `skill://private/${f.skillId}0`, `skillar://private/${f.skillId}/`, `skillar://private/${f.skillId}0`);
    }
  }
  return { sql: clauses.length === 0 ? "" : ` AND ${clauses.join(" AND ")}`, args };
}
export const sessionListSql = (f: SessionFilter, withCursor: boolean) =>
  `SELECT session_id AS sessionId, started_ms AS startedMs, first_event_ms AS firstEventMs,
     last_event_ms AS lastEventMs, events, reads, searches, runtime
   FROM session_activity ${f.searchWithoutRead === true ? "INDEXED BY session_activity_search_no_read" : ""}
   WHERE ${WHERE_SCOPE}${filterSql(f).sql}
     ${withCursor ? "AND (last_event_ms<? OR (last_event_ms=? AND session_id>?))" : ""}
   ORDER BY last_event_ms DESC, session_id LIMIT ?`;
export const sessionCountSql = (f: SessionFilter) =>
  `SELECT COUNT(*) AS total FROM session_activity ${f.searchWithoutRead === true ? "INDEXED BY session_activity_search_no_read" : ""}
   WHERE ${WHERE_SCOPE}${filterSql(f).sql}`;
export const filterOptionsSql =
  `SELECT runtime, COUNT(*) AS sessions FROM session_activity WHERE ${WHERE_SCOPE} GROUP BY runtime ORDER BY runtime`;


export const metricsSql = (count: number) =>
  `SELECT session_id AS sessionId, COUNT(*) AS events,
     SUM(kind='load') AS reads, SUM(kind='search') AS searches,
     MIN(timestamp_ms) AS firstEventMs, MAX(timestamp_ms) AS lastEventMs
   FROM event_facts
   WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
     AND session_id IN (${Array.from({ length: count }, () => "?").join(",")})
   GROUP BY session_id`;
export const eventsSql = (withCursor: boolean) =>
  `SELECT entity_key AS entityKey, kind, timestamp_ms AS timestampMs FROM event_facts
   WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND session_id=?
     ${withCursor ? "AND (timestamp_ms>? OR (timestamp_ms=? AND entity_key>?))" : ""}
   ORDER BY timestamp_ms, entity_key LIMIT ?`;


/** D1은 질의당 바인딩 변수를 100개로 제한한다(https://developers.cloudflare.com/d1/platform/limits/).
 *  칩 질의는 스코프 4개 + 세션 id N개이므로 표마다 따로, N≤CHIP_ID_CHUNK씩 나눠 보낸다. */
export const D1_MAX_BOUND_PARAMETERS = 100;
export const CHIP_ID_CHUNK = 90;
export const chipTables = ["session_skill_reads", "session_skill_reads_backfill"] as const;
/** 목록 한 쪽의 스킬 칩(한 표, 세션 id ≤CHIP_ID_CHUNK). 수집 표와 백필 표는 호출 쪽에서 합친다
 *  (일별 집계 readSkillUsage와 같은 UNION ALL 의미: 두 표는 영수증으로 서로 다른 배치만 센다).
 *  digest ''는 모름이라 응답에서 null이다. */
export const chipsSql = (table: (typeof chipTables)[number], count: number) =>
  `SELECT session_id AS sessionId, skill_id AS skillId, digest, first_read_ms AS firstReadMs, reads
   FROM ${table} WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
     AND session_id IN (${Array.from({ length: count }, () => "?").join(",")})`;
