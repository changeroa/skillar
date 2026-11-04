import { REQUEST_STATUSES, type RequestStatus, type SearchResult } from "../../src/request-status.js";
import { OperationCounts } from "../components/requests";
import { useEffect, useState } from "preact/hooks";
import type { Filter, RuntimeId } from "../../src/types.js";
import { api, type SessionListRow, type Stats } from "../api";
import { installStyles } from "../charts/sankey";
import {
  ATTRIBUTION_LABEL, RUNTIME_IDS, RUNTIME_LABEL, RUNTIME_MARK, STATE_LABEL,
  buildHash, isEmptyFilter, serializeFilter, skillName, type Route, type ViewProps,
} from "../state";

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

function Runtime({ runtime }: { runtime: RuntimeId }) {
  const label = RUNTIME_LABEL[runtime] ?? RUNTIME_LABEL.unknown;
  return (
    <span class="rt">
      <span class="rt__mark" aria-hidden="true">{RUNTIME_MARK[runtime] ?? RUNTIME_MARK.unknown}</span>
      <span>{label}</span>
    </span>
  );
}

const MAX_SKILL_CHIPS = 3;

function Skills({ skills }: { skills: string[] }) {
  if (!skills.length) return <span class="skills__none">없음</span>;
  const shown = skills.slice(0, MAX_SKILL_CHIPS);
  const more = skills.length - shown.length;
  return (
    <span class="skills">
      {shown.map((uri) => <span class="skill" key={uri} title={uri}>{skillName(uri)}</span>)}
      {more > 0 && <span class="skill skill--more" title={skills.slice(MAX_SKILL_CHIPS).map(skillName).join(", ")}>+{more}</span>}
    </span>
  );
}


function AttributionCell({ row }: { row: SessionListRow }) {
  if (row.attribution !== "none") return <span class="attr">{ATTRIBUTION_LABEL[row.attribution] ?? row.attribution}</span>;
  const tip = `세션 미연결: ${row.attributionReason ?? "사유 기록 없음"}`;
  return (
    <span class="attr attr--none" tabIndex={0} data-tip={tip} aria-label={tip}>미연결</span>
  );
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("a, button, input, select, [data-tip]") !== null;
}

function Row({ row, route, navigate }: { row: SessionListRow; route: Route; navigate: ViewProps["navigate"] }) {
  const target: Route = { view: "trace", sessionId: row.id, filter: route.filter };
  return (
    <tr onClick={(event) => { if (!isInteractive(event.target)) navigate(target); }}>
      <td class="c-runtime" data-label="실행 환경"><Runtime runtime={row.runtime} /></td>
      <td class="c-started" data-label="시작"><When row={row} /></td>
      <td class="c-prompt" data-label="첫 요청문">
        <a class={row.firstPrompt ? "rowlink" : "rowlink rowlink--dim"} href={buildHash(target)}>
          {row.firstPrompt ?? "(요청문 기록 없음)"}
        </a>
      </td>
      <td class="c-skills" data-label="스킬"><Skills skills={row.skills} /></td>
      <td class="c-search" data-label="검색"><OperationCounts summary={row.requests?.search} /></td>
      <td class="c-load" data-label="읽기"><OperationCounts summary={row.requests?.load} /></td>
      <td class="c-attr" data-label="세션 연결"><AttributionCell row={row} /></td>
    </tr>
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

function Toolbar({ route, navigate, count }: { route: Route; navigate: ViewProps["navigate"]; count: number | undefined }) {
  const { filter } = route;
  const [draft, setDraft] = useState(filter.q ?? "");
  useEffect(() => setDraft(filter.q ?? ""), [filter.q]);
  const update = (patch: Filter) => {
    const next: Filter = { ...filter, ...patch };
    for (const key of Object.keys(next) as (keyof Filter)[]) if (next[key] === undefined) delete next[key];
    navigate({ ...route, filter: next });
  };
  return (
    <form
      class="toolbar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const input = (event.currentTarget as HTMLFormElement).elements.namedItem("q") as HTMLInputElement | null;
        const q = input?.value.trim() ?? "";
        update({ q: q || undefined });
      }}
    >
      <label class="toolbar__label" for="session-search">요청문과 스킬 검색</label>
      <input id="session-search" class="field field--search" type="search" name="q" placeholder="예: pr-review" value={draft} onInput={(event) => setDraft(event.currentTarget.value)} />
      <select class="field field--select" aria-label="실행 환경" value={filter.runtime?.length === 1 ? filter.runtime[0] : ""} onChange={(event) => { const v = (event.currentTarget as HTMLSelectElement).value as RuntimeId | ""; update({ runtime: v ? [v] : undefined }); }}>
        <option value="">모든 실행 환경</option>
        {RUNTIME_IDS.map((id) => <option key={id} value={id}>{RUNTIME_LABEL[id]}</option>)}
      </select>
      {(["searchStatus", "loadStatus"] as const).map((key) => (
        <select class="field field--select" aria-label={key === "searchStatus" ? "검색 상태" : "읽기 상태"} value={filter[key]?.length === 1 ? filter[key]![0] : ""}
          onChange={(event) => { const value = event.currentTarget.value as RequestStatus | ""; update({ [key]: value ? [value] : undefined }); }}>
          <option value="">{key === "searchStatus" ? "모든 검색 상태" : "모든 읽기 상태"}</option>
          {REQUEST_STATUSES.map((status) => <option key={status} value={status}>{STATE_LABEL[status]}</option>)}
        </select>
      ))}
      <select class="field field--select" aria-label="검색 결과" value={filter.searchResult?.[0] ?? ""}
        onChange={(event) => { const value = event.currentTarget.value as SearchResult | ""; update({ searchResult: value ? [value] : undefined }); }}>
        <option value="">모든 검색 결과</option><option value="candidates_found">후보 있음</option><option value="no_candidates">후보 없음</option>
      </select>
      {count !== undefined && <span class="toolbar__count">세션 {count}개</span>}
    </form>
  );
}

const LIVE_REFRESH_DEBOUNCE_MS = 300;

export function SessionsView({ route, navigate, live, embedded = false }: ViewProps) {
  const Title = embedded ? "h2" : "h1";
  const filterKey = serializeFilter(route.filter);
  const [rows, setRows] = useState<SessionListRow[]>();
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (live.seq === 0) return;
    const timer = setTimeout(() => setRefresh((n) => n + 1), LIVE_REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [live.seq]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.sessions(route.filter), api.stats(route.filter)])
      .then(([nextRows, nextStats]) => {
        if (cancelled) return;
        setRows(nextRows);
        setStats(nextStats);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [filterKey, refresh]);

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
    body = (
      <div class="sessions__frame">
        <table class="sessions">
          <colgroup>
            <col style="width:10%" />
            <col style="width:9%" />
            <col />
            <col style="width:14%" />
            <col style="width:17%" />
            <col style="width:12%" />
            <col style="width:10%" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">실행 환경</th>
              <th scope="col">시작</th>
              <th scope="col">첫 요청문</th>
              <th scope="col">스킬</th>
              <th scope="col">검색</th>
              <th scope="col">읽기</th>
              <th scope="col">세션 연결</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <Row key={row.id} row={row} route={route} navigate={navigate} />)}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section aria-busy={rows === undefined}>
      <div class="page-title">
        <Title>세션 사용 기록</Title>
        <p>검색과 읽기 횟수는 요청 단위로 셉니다. 요청이 없었던 것과 결과를 알 수 없는 것은 다릅니다.</p>
      </div>
      <Toolbar route={route} navigate={navigate} count={rows?.length} />
      {error && <p class="notice" role="alert">세션을 불러오지 못했습니다: {error}</p>}
      {body}
      {rows !== undefined && stats && <UsageNote stats={stats} />}
    </section>
  );
}
