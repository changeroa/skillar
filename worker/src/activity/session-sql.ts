// AGPL-3.0-only. 세션 읽기 API의 SQL 빌더(의존성 없음: 테스트가 노드에서 직접 불러 EXPLAIN을 확인한다).
export type SessionFilter = { activeFromMs?: number; activeToMs?: number; runtimes?: string[]; searchWithoutRead?: boolean };
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


/** 목록 한 쪽(세션 id ≤100)의 스킬 칩. 수집 경로 표와 백필 표를 합친다(일별 집계 readSkillUsage와 같은 UNION ALL:
 *  두 표는 영수증으로 서로 다른 배치만 세므로 겹치지 않는다). digest ''는 모름이라 응답에서 null이다. */
export const chipsSql = (count: number) => {
  const ids = Array.from({ length: count }, () => "?").join(",");
  const part = (table: string) => `SELECT session_id, skill_id, digest, first_read_ms, reads FROM ${table}
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND session_id IN (${ids})`;
  return `SELECT session_id AS sessionId, skill_id AS skillId, digest, MIN(first_read_ms) AS firstReadMs, SUM(reads) AS reads
    FROM (${part("session_skill_reads")} UNION ALL ${part("session_skill_reads_backfill")})
    GROUP BY session_id, skill_id, digest ORDER BY session_id, firstReadMs, skill_id, digest`;
};
