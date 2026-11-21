// 출처 여러 개의 세션 색인을 하나로 합친다(출처 전체 보기). 각 출처 목록은 (last_event_ms DESC, session_id ASC)로
// 정렬돼 있고 keyset cursor({lastEventMs, sessionId})를 쓰므로, 출처별로 같은 필터·limit N을 받아
// (last_event_ms DESC, source, session_id) 순으로 정확히 k-way 병합한다. 합친 cursor는 출처별 "마지막으로
// 소비한 항목" 묶음이라, 덜 소비한 출처는 그 자리에서 다시 시작하고 항목은 빠지거나 겹치지 않는다.
// 한 출처라도 실패하면 결과에 failed로 표시한다(전체인 척하지 않는다).
import type {
  SessionIndexApi, SessionIndexCount, SessionIndexEvents, SessionIndexFilter, SessionIndexFilterOptions, SessionIndexList,
} from "./cloud";

export type SourceIndex = { readonly key: string; readonly label: string; readonly index: SessionIndexApi };
type KeyCursor = NonNullable<SessionIndexList["nextCursor"]>;
/** 출처 키 → 마지막 소비 항목. "done"은 그 출처가 끝까지 소비됨. 키 없음은 처음부터. */
export type MergedCursor = Readonly<Record<string, KeyCursor | "done">>;
export type MergedRow = SessionIndexList["sessions"][number] & { readonly source: string };
export type Failure = { readonly source: string; readonly error: unknown };
export type MergedList = { readonly sessions: MergedRow[]; readonly nextCursor: MergedCursor | null; readonly failed: Failure[]; readonly rowsRead: number | null };
export type MergedCount = { readonly total: number; readonly bySource: Record<string, number>; readonly failed: Failure[]; readonly rowsRead: number | null };
export type MergedOptions = {
  readonly runtimes: { runtime: string | null; sessions: number }[]; readonly failed: Failure[]; readonly rowsRead: number | null;
};

const sumRows = (values: (number | null)[]): number | null =>
  values.some(v => v === null) ? null : values.reduce<number>((a, v) => a + (v as number), 0);
/** 합친 순서: 최근 활동 내림차순, 같으면 출처 키, 같으면 세션 ID. */
export function compareMerged(a: MergedRow, b: MergedRow): number {
  if (a.lastEventMs !== b.lastEventMs) return b.lastEventMs - a.lastEventMs;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
}

export function createMergedSessionIndex(sources: readonly SourceIndex[]) {
  const settle = async <T,>(call: (s: SourceIndex) => Promise<T>, which: readonly SourceIndex[] = sources) => {
    const results = await Promise.allSettled(which.map(call));
    const ok: { s: SourceIndex; value: T }[] = []; const failed: Failure[] = [];
    results.forEach((r, i) => r.status === "fulfilled" ? ok.push({ s: which[i]!, value: r.value }) : failed.push({ source: which[i]!.key, error: r.reason }));
    return { ok, failed };
  };
  return {
    sources,
    async list(filter: SessionIndexFilter, page: { limit?: number; cursor?: MergedCursor | null } = {}, signal?: AbortSignal): Promise<MergedList> {
      const limit = page.limit ?? 50;
      const cursor = page.cursor ?? {};
      const active = sources.filter(s => cursor[s.key] !== "done");
      const { ok, failed } = await settle(s => {
        const at = cursor[s.key];
        return s.index.list(filter, { limit, cursor: at === undefined || at === "done" ? null : at }, signal);
      }, active);
      const heads = ok.map(({ s, value }) => ({ s, rows: value.sessions.map(r => ({ ...r, source: s.key }) as MergedRow), more: value.nextCursor !== null, taken: 0 }));
      const merged: MergedRow[] = [];
      while (merged.length < limit) {
        let best: (typeof heads)[number] | undefined;
        for (const h of heads) {
          const row = h.rows[h.taken]; if (row === undefined) continue;
          if (best === undefined || compareMerged(row, best.rows[best.taken]!) < 0) best = h;
        }
        if (best === undefined) break;
        merged.push(best.rows[best.taken++]!);
      }
      const next: Record<string, KeyCursor | "done"> = { ...cursor };
      let remaining = false;
      for (const h of heads) {
        const last = h.taken > 0 ? h.rows[h.taken - 1]! : undefined;
        if (last !== undefined) next[h.s.key] = { lastEventMs: last.lastEventMs, sessionId: last.sessionId };
        const left = h.taken < h.rows.length || h.more;
        if (!left) next[h.s.key] = "done";
        if (left) remaining = true;
      }
      // 실패한 출처는 쪽 넘김을 붙잡지 않는다(다음 쪽이 영원히 비어 있게 됨). 호출자는 failed를 보고 "일부 출처 제외"로
      // 표시하고, 다시 시도하면 처음부터 읽는다.
      return { sessions: merged, nextCursor: remaining ? next : null, failed, rowsRead: sumRows(ok.map(o => o.value.rowsRead)) };
    },
    async count(filter: SessionIndexFilter, signal?: AbortSignal): Promise<MergedCount> {
      const { ok, failed } = await settle(s => s.index.count(filter, signal));
      const bySource: Record<string, number> = {};
      for (const { s, value } of ok) bySource[s.key] = (value as SessionIndexCount).total;
      return { total: Object.values(bySource).reduce((a, v) => a + v, 0), bySource, failed, rowsRead: sumRows(ok.map(o => o.value.rowsRead)) };
    },
    async filterOptions(signal?: AbortSignal): Promise<MergedOptions> {
      const { ok, failed } = await settle(s => s.index.filterOptions(signal));
      const byRuntime = new Map<string | null, number>();
      for (const { value } of ok) for (const r of (value as SessionIndexFilterOptions).runtimes) byRuntime.set(r.runtime, (byRuntime.get(r.runtime) ?? 0) + r.sessions);
      const runtimes = [...byRuntime].map(([runtime, sessions]) => ({ runtime, sessions }))
        .sort((a, b) => b.sessions - a.sessions || String(a.runtime).localeCompare(String(b.runtime)));
      return { runtimes, failed, rowsRead: sumRows(ok.map(o => o.value.rowsRead)) };
    },
    events(source: string, sessionId: string, page?: Parameters<SessionIndexApi["events"]>[1], signal?: AbortSignal): Promise<SessionIndexEvents> {
      const s = sources.find(x => x.key === source);
      if (s === undefined) return Promise.reject(new Error("unknown source"));
      return s.index.events(sessionId, page, signal);
    },
  };
}
export type MergedSessionIndex = ReturnType<typeof createMergedSessionIndex>;
