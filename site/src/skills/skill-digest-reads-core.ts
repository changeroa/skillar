export type DigestReadsRow = {
  readonly digest: string | null; readonly sessions: number; readonly reads: number; readonly lastFirstReadMs: number;
};
export type DigestReads = { readonly rows: readonly DigestReadsRow[]; readonly totalSessions: number; readonly sources: number };

/** 출처별 응답을 digest로 합친다. 세션 id는 출처(기기·출처 도메인)마다 따로 정해지므로 출처 간 합산이 곧 서로 다른 세션 수다.
 *  digest를 모르는 행(null)은 다른 digest에 합치지 않는다. */
export function mergeDigestReads(results: readonly { readonly rows: readonly DigestReadsRow[]; readonly totalSessions: number }[]): DigestReads {
  const by = new Map<string, { digest: string | null; sessions: number; reads: number; lastFirstReadMs: number }>();
  for (const result of results) for (const row of result.rows) {
    const key = row.digest ?? "";
    const seen = by.get(key);
    by.set(key, seen === undefined ? { ...row } : {
      digest: row.digest, sessions: seen.sessions + row.sessions, reads: seen.reads + row.reads,
      lastFirstReadMs: Math.max(seen.lastFirstReadMs, row.lastFirstReadMs),
    });
  }
  return {
    rows: [...by.values()].sort((a, b) => b.lastFirstReadMs - a.lastFirstReadMs || (a.digest ?? "").localeCompare(b.digest ?? "")),
    totalSessions: results.reduce((sum, result) => sum + result.totalSessions, 0), sources: results.length,
  };
}

