import { useEffect, useMemo, useState } from "preact/hooks";
import type { RuntimeId } from "../../src/types.js";
import { api, ApiError, type SessionListRow, type Stats } from "../api";
import { installStyles } from "../charts/sankey";
import {
  RUNTIME_IDS, RUNTIME_LABEL,
  buildHash, isEmptyFilter, matchesFilter, serializeFilter, type Route, type ViewProps,
} from "../state";
import { SessionFacets } from "./sessions/facets";
import { SessionHistogram } from "./sessions/histogram";
import { SessionTable } from "./sessions/table";
import { SessionToolbar } from "./sessions/toolbar";
import { readSkills, sortSessions } from "./sessions/model";
import { sessionsStyles } from "./sessions/styles";

const USAGE_CSS = `
.usage { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-1) var(--s-4); margin: 0; color: var(--ink-2); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; }
.usage__item { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-1) var(--s-2); }
.usage__item[data-usage="unattributed"] { flex-direction: column; align-items: flex-start; }
.usage__key { color: var(--ink-3); }
.usage__why { color: var(--ink-3); text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
.usage__why[data-tip]::after { width: min(44ch, calc(100vw - 2 * var(--s-4))); white-space: normal; }
.usage__rate { white-space: nowrap; }
.usage__rate--none { color: var(--ink-3); }
`;

installStyles("sessions-usage", USAGE_CSS);

export const ATTRIBUTION_EXPLAINER =
  "skillar는 실행 환경의 세션 ID, 제공자 메타데이터, 검색 추적 ID 또는 최근 활동 시간으로 MCP 검색·읽기 요청을 세션과 연결합니다. 이 요청들은 연결할 세션을 찾지 못해 저장만 되었으며, 세션 목록에는 포함되지 않습니다.";

/** "-" when the runtime sent no MCP events (no data), otherwise a whole percent (0% means events arrived and none were attributed). */
export function formatRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "-" : `${Math.round(rate * 100)}%`;
}

export function unattributedText(counts: Stats["unattributed"]): string | undefined {
  if (!counts || counts.searches + counts.loads === 0) return undefined;
  return `세션 미연결: 검색 ${counts.searches}건, 읽기 ${counts.loads}건`;
}

/** Runtimes that sent anything or have MCP data, in the canonical runtime order. */
export function attributionRates(stats: Pick<Stats, "attributionRate" | "lastEventByRuntime">): { runtime: RuntimeId; text: string; known: boolean }[] {
  return RUNTIME_IDS
    .filter((id) => (stats.attributionRate[id] ?? null) !== null || stats.lastEventByRuntime[id] !== undefined)
    .map((id) => ({ runtime: id, text: formatRate(stats.attributionRate[id]), known: (stats.attributionRate[id] ?? null) !== null }));
}

function UsageNote({ stats }: { stats: Stats }) {
  const orphan = unattributedText(stats.unattributed);
  const rates = attributionRates(stats);
  if (!orphan && rates.length === 0) return null;
  return (
    <footer class="sessions__foot">
      <p class="usage">
        {orphan && (
          <span class="usage__item" data-usage="unattributed">
            <span>{orphan}</span>
            <span class="usage__why" tabIndex={0} data-tip={ATTRIBUTION_EXPLAINER} aria-label={ATTRIBUTION_EXPLAINER}>세션 연결 방식</span>
          </span>
        )}
        {rates.length > 0 && (
          <span class="usage__item" data-usage="rates" title="실행 환경별 MCP 이벤트 중 세션과 연결된 비율입니다. -는 보낸 MCP 이벤트가 없다는 뜻입니다.">
            <span class="usage__key">MCP 세션 연결률</span>
            {rates.map((r) => (
              <span key={r.runtime} class={r.known ? "usage__rate" : "usage__rate usage__rate--none"}>{RUNTIME_LABEL[r.runtime]} {r.text}</span>
            ))}
          </span>
        )}
      </p>
    </footer>
  );
}

const timeFmt = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const dateFmt = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60e3);
  if (minutes < 1) return "1분 미만";
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

function When({ row }: { row: SessionListRow }) {
  const started = new Date(row.startedAt);
  const dateLabel = isSameLocalDay(started, new Date()) ? "오늘" : dateFmt.format(started);
  return (
    <time class="when" dateTime={started.toISOString()} title={started.toLocaleString("ko-KR")}>
      <span class="when__date">{dateLabel}</span>
      <span class="when__time">{timeFmt.format(started)}</span>
      {row.endedAt !== undefined && <span class="when__dur">{formatDuration(row.endedAt - row.startedAt)}</span>}
    </time>
  );
}

function WaitingEmpty({ stats }: { stats: Stats }) {
  if (api.mode === "cloud") return (
    <section class="empty" aria-live="polite">
      <h2>이 기록에는 활동이 없습니다</h2>
      <p>출처 기기에서 세션을 시작한 뒤 최신 기록을 올리고 출처를 다시 불러오세요.</p>
    </section>
  );
  const { ingest } = stats;
  return (
    <section class="empty" aria-live="polite">
      <h2>첫 이벤트를 기다리고 있습니다</h2>
      <p>
        아직 이벤트를 보낸 실행 환경이 없습니다. 연결된 실행 환경에서 세션을 시작하거나
        {" "}<code class="cmd">skillar doctor</code>로 연결 상태를 확인하세요.
      </p>
      <dl class="checklist">
        {RUNTIME_IDS.filter((id) => id !== "unknown").map((id) => {
          const ts = stats.lastEventByRuntime[id];
          return (
            <>
              <dt key={`${id}-k`}>{RUNTIME_LABEL[id]}</dt>
              <dd key={`${id}-v`} class={ts !== undefined ? "is-ok" : undefined}>{ts !== undefined ? `마지막 이벤트 ${dateTimeFmt.format(ts)}` : "이벤트 없음"}</dd>
            </>
          );
        })}
        <dt>수집</dt>
        <dd class={ingest.rejected || ingest.dropped ? "is-bad" : undefined}>
          수락 {ingest.accepted}건, 거부 {ingest.rejected}건, 누락 {ingest.dropped}건
        </dd>
        {ingest.lastError && (
          <>
            <dt>마지막 오류</dt>
            <dd class="is-bad">{ingest.lastError.code} · {dateTimeFmt.format(ingest.lastError.ts)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function FilteredEmpty({ route, navigate }: { route: Route; navigate: ViewProps["navigate"] }) {
  return (
    <section class="empty">
      <h2>조건에 맞는 세션이 없습니다</h2>
      <p>기간을 늘리거나 필터를 해제하면 더 많은 세션을 볼 수 있습니다.</p>
      <button type="button" class="btn" onClick={() => navigate({ ...route, filter: {} })}>필터 해제</button>
    </section>
  );
}

function NoSessionsEmpty() {
  return (
    <section class="empty">
      <h2>아직 기록된 세션이 없습니다</h2>
      {api.mode === "cloud" ? <p>올린 기록에 이벤트는 있지만 세션은 없습니다. 출처 기기에서 최신 기록을 올리고 출처를 다시 불러오세요.</p> :
        <p>이벤트는 도착했지만 세션을 시작한 이벤트가 없습니다. 연결된 실행 환경에 요청문을 입력하거나 <code class="cmd">skillar doctor</code>를 실행하세요.</p>}
    </section>
  );
}

const LIVE_REFRESH_DEBOUNCE_MS = 300;

export function SessionsView({ route, navigate, live, embedded = false, detail = false, onRows }: ViewProps & {
  readonly detail?: boolean; readonly onRows?: (rows: SessionListRow[]) => void;
}) {
  sessionsStyles();
  const Title = embedded || detail ? "h2" : "h1";
  const Results = embedded ? "div" : "main";
  const filterKey = serializeFilter(route.filter);
  const [rows, setRows] = useState<SessionListRow[]>();
  const [facetRows, setFacetRows] = useState<SessionListRow[]>();
  const [facetsOpen, setFacetsOpen] = useState(false);
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [active, setActive] = useState(route.sessionId);
  useEffect(() => setActive(route.sessionId), [route.sessionId]);
  const ordered = useMemo(() => sortSessions(rows ?? [], route.sort), [rows, route.sort]);
  useEffect(() => { if (rows !== undefined && !detail) onRows?.(ordered); }, [ordered, detail, onRows]);

  useEffect(() => {
    if (live.seq === 0) return;
    const timer = setTimeout(() => setRefresh((n) => n + 1), LIVE_REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [live.seq]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const scope = { from: route.filter.from, to: route.filter.to, automated: route.filter.automated };
    Promise.all([api.sessions(detail ? route.filter : scope), api.stats(route.filter)])
      .then(([nextRows, nextStats]) => {
        if (cancelled) return;
        setFacetRows(nextRows);
        setRows(detail ? nextRows : nextRows.filter(row => matchesFilter(row, route.filter)
          && (!route.filter.skill || readSkills(row).some(uri => route.filter.skill?.includes(uri)))));
        setStats(nextStats);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError && err.status === 403 ? "permission" : "failed");
          if (err instanceof ApiError && err.status === 403) { setRows(undefined); setFacetRows(undefined); setStats(undefined); }
        }
      }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [filterKey, refresh]);

  const failure = error && <div class="notice" role="alert">
    <p>{error === "permission" ? "이 기록을 볼 권한이 없습니다" : "세션을 불러오지 못했습니다"}</p>
    <button type="button" class="btn" onClick={() => { setError(undefined); setRefresh(n => n + 1); }}>다시 시도</button>
  </div>;
  if (detail && error) return <section class="session-picker" role="group" aria-label="세션 목록 다시 시도" tabIndex={0} aria-busy={busy}
    onKeyDown={event => {
      if (event.key !== "Enter") return;
      event.preventDefault(); setError(undefined); setRefresh(n => n + 1);
    }}>
    <p role="alert">{error === "permission" ? "이 기록을 볼 권한이 없습니다" : "세션을 불러오지 못했습니다"}</p>
    <p>엔터 키로 목록을 다시 불러올 수 있습니다.</p>
    <button type="button" class="btn" tabIndex={-1} onClick={() => { setError(undefined); setRefresh(n => n + 1); }}>다시 시도</button>
  </section>;
  if (detail) return <section aria-busy={busy}>
    {failure}
    {busy && <p role="status">세션 불러오는 중…</p>}
    {rows && <div class="session-picker" role="listbox" aria-label="세션 목록" tabIndex={0}
      aria-activedescendant={rows.some(row => row.id === active) ? `session-option-${encodeURIComponent(active ?? "")}` : undefined}
      onKeyDown={event => {
        const index = rows.findIndex(row => row.id === active);
        let next: number;
        switch (event.key) {
          case "ArrowDown": next = Math.min(rows.length - 1, index + 1); break;
          case "ArrowUp": next = Math.max(0, index - 1); break;
          case "Home": next = 0; break;
          case "End": next = rows.length - 1; break;
          case "Enter": {
            const row = rows[index];
            if (row) navigate({ view: "trace", sessionId: row.id, filter: route.filter });
            event.preventDefault(); return;
          }
          default: return;
        }
        event.preventDefault();
        const row = rows[next];
        if (row) {
          setActive(row.id);
          document.getElementById(`session-option-${encodeURIComponent(row.id)}`)?.scrollIntoView({ block: "nearest" });
        }
      }}>
      {rows.map(row => <a key={row.id} id={`session-option-${encodeURIComponent(row.id)}`} role="option" tabIndex={-1}
        aria-selected={row.id === route.sessionId} class="session-picker__row" data-active={row.id === active}
        href={buildHash({ view: "trace", sessionId: row.id, filter: route.filter })}>
        <span>{row.id === route.sessionId ? "✓ " : ""}<code>{row.id}</code></span>
        <When row={row} /><span class="rowlink">{row.firstPrompt ?? "(요청문 기록 없음)"}</span>
      </a>)}
      {rows.length === 0 && <p>조건에 맞는 세션이 없습니다. 세션 목록에서 필터를 조정하세요.</p>}
    </div>}
  </section>;

  let body;
  if (rows === undefined) {
    body = null;
  } else if (rows.length === 0 && stats && stats.lastEventTs === undefined) {
    body = <WaitingEmpty stats={stats} />;
  } else if (rows.length === 0 && !isEmptyFilter(route.filter)) {
    body = <FilteredEmpty route={route} navigate={navigate} />;
  } else if (rows.length === 0) {
    body = <NoSessionsEmpty />;
  } else {
    body = <SessionTable rows={ordered} route={route} navigate={navigate} />;
  }

  return (
    <section class="sessions-console pe-console" data-pe-screen="sessions-table" data-peek={Boolean(route.peek)} aria-busy={busy}>
      <div class="page-title">
        <Title>세션</Title>
        <p>세션 사용 기록</p>
      </div>
      <SessionToolbar route={route} navigate={navigate} count={rows?.length} facetsOpen={facetsOpen} toggleFacets={() => setFacetsOpen(value => !value)} />
      {failure}
      {busy && <p role="status">세션 불러오는 중…</p>}
      <div class="sessions-body" data-facets-open={facetsOpen}>
        {facetRows && <SessionFacets rows={facetRows} route={route} navigate={navigate} />}
        <Results class="session-results" aria-label="세션 기록" tabIndex={-1}>
          {rows && <SessionHistogram rows={rows} filter={route.filter} />}
          {body}
        </Results>
      </div>
      {rows !== undefined && stats && <UsageNote stats={stats} />}
    </section>
  );
}
