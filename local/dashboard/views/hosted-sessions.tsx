// 호스팅 세션 화면(cloud 모드): 리포트 작업 없이 D1 평문 요약(api.sessionIndex)만 읽는다.
// 시작 시각은 session_facts에 실제 행이 있을 때만 보이고, 없으면 "시작 알 수 없음"이다. 최근 활동(마지막
// 이벤트) 시각은 별도 열로만 보이며 시작으로 읽히지 않게 한다. 요청문·상태·토큰·자동 실행·소요 시간은
// 이 색인에 없으므로 열 자체를 두지 않는다(값을 지어내지 않는다). 본문은 리포트 화면 링크로만 연다.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "../api";
import type { SessionIndexEvents, SessionIndexList } from "../cloud";
import { createMergedSessionIndex, type MergedCursor, type MergedRow, type SourceIndex } from "../session-index-merge";
import { Icon } from "../components/icons";
import { useNarrow } from "../components/use-narrow";
import { installStyles } from "../charts/sankey";
import { Tag } from "../foundation/controls/labels";
import { IconButton } from "../foundation/controls/buttons";
import { TimePeriodSelect } from "../foundation/controls/date-range";
import { TableFacet } from "../foundation/table/facets";
import { TableRow, TableToolbar } from "../foundation/table/parts";
import { tableStyles } from "../foundation/table/styles";
import { Alert, EmptyState, StatusMessage } from "../foundation/widgets/messages";
import { RUNTIME_LABEL, buildHash, hostedSkillLabel, skillKey, type ViewProps } from "../state";
import { kstPeriodStart } from "../time";
import { sessionsStyles } from "./sessions/styles";

type Row = MergedRow;
type EventRow = SessionIndexEvents["events"][number];
export const PAGE_SIZE = 50;

const stamp = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const clock = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const full = (ms: number) => new Date(ms).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
export const runtimeLabel = (runtime: string | null): string =>
  runtime === null ? "알 수 없음" : (RUNTIME_LABEL as Record<string, string>)[runtime] ?? runtime;
export const KIND_LABEL: Record<string, string> = {
  session_start: "세션 시작", prompt: "요청문", search: "검색", load: "스킬 읽기", read_file: "파일 읽기",
  native_skill: "기본 스킬", llm_call: "모델 호출", tool_call: "도구 호출", session_end: "세션 종료",
  error: "오류", skill_request: "스킬 요청",
};
export const kindLabel = (kind: string | null): string => kind === null ? "종류 알 수 없음" : KIND_LABEL[kind] ?? kind;

/** 호스트(app.tsx)가 보기 가능한 출처마다 색인 읽기 수단을 등록한다. select는 리포트(본문) 화면이 쓰는 출처를 바꾼다. */
export type HostedSources = { readonly sources: readonly SourceIndex[]; readonly select: (key: string) => void; readonly lastReceivedMs?: number | null };
let registry: HostedSources | undefined;
const listeners = new Set<() => void>();
export function configureHostedSources(next: HostedSources | undefined): void {
  registry = next; for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const peekValue = (row: Pick<Row, "source" | "sessionId">) => `${row.source}/${row.sessionId}`;
export const splitPeek = (peek: string): { source: string; sessionId: string } => {
  const at = peek.indexOf("/");
  return at < 0 ? { source: "", sessionId: peek } : { source: peek.slice(0, at), sessionId: peek.slice(at + 1) };
};
/** 개발자용 화면별 D1 읽기 행 수(숨김 토글): 주소에 ?devrows=1 을 붙여 연 적이 있거나(주소는 곧 정리되므로 불러올 때
 *  한 번 읽는다) localStorage "skillar-dev-rows"가 "1"일 때만 보인다. 일반 사용자 화면에는 나오지 않는다. */
const devFromUrl = typeof location !== "undefined" && new URLSearchParams(location.search).has("devrows");
if (devFromUrl) { try { localStorage.setItem("skillar-dev-rows", "1"); } catch { /* 저장 불가면 이번 방문만 */ } }
export const showRowsRead = (): boolean => {
  if (devFromUrl) return true;
  try { return localStorage.getItem("skillar-dev-rows") === "1"; } catch { return false; }
};

installStyles("hosted-sessions", `
.hs-table td{vertical-align:middle}
.session-table-frame.lf-table-surface .hs-table .rowlink{display:inline-flex;align-items:center;height:auto;min-height:0}
.sessions-console[data-peek=true] .hs-table .cell-hsskills,.sessions-console[data-peek=true] .hs-table th.cell-hsskills{display:none}
.hs-summary{font-size:12px;color:var(--ink-2);margin-inline-start:auto}
.hs-sheet{position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;background:var(--lf-modal,#fff);height:100dvh}
.hs-sheet__bar{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--lf-border)}.hs-sheet__bar h2{margin:0;font-size:16px}
.hs-sheet__body{overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.hs-partial{margin:0 0 8px;font-size:12px}
.hs-when{display:flex;flex-direction:column;line-height:1.3}.hs-when small{color:var(--ink-3);font-size:11px}
.hs-unknown{color:var(--ink-3)}
.hs-c-narrow{display:none}
.hs-counts{font-variant-numeric:tabular-nums;white-space:nowrap}
.hs-skills{display:flex;flex-wrap:wrap;gap:4px}
.hs-pager{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:12px;font-size:12px;color:var(--ink-2)}
.hs-rows{font-size:11px;color:var(--ink-3);margin:8px 0 0;text-align:right}
.hs-shortcut{display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left}
.session-table .cell-hsstart{width:128px}.session-table .cell-hsactive{width:128px}.session-table .cell-hsruntime{width:110px}
.session-table .cell-hscounts{width:140px}.session-table .cell-hsskills{width:auto}
.hs-peek{position:sticky;top:16px;align-self:start;max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--lf-border);background:var(--lf-modal);padding:var(--lf-space-4);min-width:0}
.hs-peek h2{font:var(--lf-weight-strong) var(--lf-text-lg)/24px var(--lf-font-sans);margin:0 0 8px;overflow-wrap:anywhere}
.hs-peek dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 12px;font-size:12px}.hs-peek dt{color:var(--ink-3)}.hs-peek dd{margin:0}
.hs-peek__bar{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:12px}
.hs-timeline{list-style:none;margin:8px 0;padding:0;border-left:1px solid var(--lf-border)}
.hs-timeline li{display:flex;gap:12px;padding:4px 0 4px 12px;font-size:12px;position:relative}
.hs-timeline li::before{content:"";position:absolute;left:-4px;top:11px;width:7px;height:7px;border-radius:50%;background:var(--ink-3)}
.hs-timeline li[data-kind=search]::before{background:var(--lf-ring,#4c8)}.hs-timeline li[data-kind=load]::before{background:var(--accent,#48f)}
.hs-timeline time{font-variant-numeric:tabular-nums;color:var(--ink-2);min-width:64px}
.hs-body-note{font-size:12px;color:var(--ink-2)}
@media(max-width:1023px){.hs-peek{position:fixed;inset:0;z-index:60;height:100dvh;max-height:100dvh;border:0;background:var(--lf-modal,#fff)}}
@media(max-width:640px){
.session-table.hs-table,.session-table.hs-table tbody,.session-table.hs-table tr,.session-table.hs-table td{display:block;width:auto!important;height:auto!important;border:0}
.session-table.hs-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.session-table.hs-table tr{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 0;padding:10px 4px;border-bottom:1px solid var(--lf-border)}
.session-table.hs-table td{padding:0!important;min-width:0}
.session-table.hs-table td::before{display:none}
.session-table.hs-table .cell-hsstart{display:none}
.session-table.hs-table td.cell-hsruntime::before{display:inline;content:"·";margin:0 6px;color:var(--ink-3)}
.session-table.hs-table .cell-hsactive{order:1}.session-table.hs-table .cell-hsruntime:nth-of-type(4){order:2}.session-table.hs-table .cell-hsruntime:nth-of-type(3){order:3}
.session-table.hs-table .cell-hscounts{order:4;flex:1 0 100%}.session-table.hs-table .cell-hsskills{order:5;flex:1 0 100%;display:flex!important;align-items:center;flex-wrap:wrap;gap:4px}
.hs-chip{flex:1 0 100%;order:-1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;border:1px solid var(--line, #d0d5dd);border-radius:6px;font-size:13px}.hs-c-wide{display:none}.hs-c-narrow{display:inline;font-size:12px;color:var(--ink-2)}
.session-table.hs-table tr{padding:8px 4px}
.session-table.hs-table .rowlink{min-height:0;height:auto}
}
`);

function encodeCursor(cursor: MergedCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** 주소의 커서는 신뢰하지 않는다: 모양이 맞지 않으면 처음 쪽으로 돌아간다(서버는 어차피 범위 읽기만 한다). */
function decodeCursor(value: string | undefined): MergedCursor | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry === "done") { out[key] = "done"; continue; }
      const cursor = entry as { lastEventMs?: unknown; sessionId?: unknown };
      if (typeof cursor?.lastEventMs !== "number" || typeof cursor.sessionId !== "string") return null;
      out[key] = { lastEventMs: cursor.lastEventMs, sessionId: cursor.sessionId };
    }
    return out as MergedCursor;
  } catch { return null; }
}

let catalogNames: ReadonlyMap<string, string> | undefined;
/** 보관함 스킬 이름표(같은 출처 /api/skills). 못 읽으면 빈 표로 두고 이름 대신 "비공개 스킬 …"을 보인다. */
function useSkillNames(): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(catalogNames ?? new Map());
  useEffect(() => {
    if (catalogNames !== undefined) return;
    const controller = new AbortController();
    fetch("/api/skills", { credentials: "same-origin", signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject(new Error("skills"))).then((body: unknown) => {
      const list = (body as { skills?: { skillId?: unknown; name?: unknown }[] }).skills ?? [];
      catalogNames = new Map(list.flatMap(item => typeof item.skillId === "string" && typeof item.name === "string" ? [[item.skillId, item.name] as const] : []));
      setNames(catalogNames);
    }, () => undefined);
    return () => controller.abort();
  }, []);
  return names;
}

export function HostedSessionsView({ route, navigate }: ViewProps) {
  sessionsStyles(); tableStyles();
  const hosted = useSyncExternalStore(subscribe, () => registry);
  const narrow = useNarrow();
  const skillNames = useSkillNames();
  // 기간 기본값은 최근 7일(승인 제안서 31행). 기간은 최근 활동 시각 기준이고 위쪽 끝은 열어 둔다.
  const period = (route.period === "30" || route.period === "60" || route.period === "90" || route.period === "all" ? route.period : "7") as "7" | "30" | "60" | "90" | "all";
  const setPeriod = (value: "7" | "30" | "60" | "90" | "all") => navigate({ ...route, view: "sessions", period: value, cur: undefined, peek: undefined });
  // 스킬 보기: /skills에서 넘어온 ?skill=<UUID 또는 URI>. 세션 중 그 스킬을 읽은 적 있는 것만 보인다.
  const skillId = useMemo(() => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(route.filter.skill?.[0] ?? "")?.[0], [route.filter.skill]);
  const from = useMemo(() => period === "all" ? undefined : kstPeriodStart(Date.now(), Number(period)), [period]);
  const to: number | undefined = undefined;
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetTrigger = useRef<HTMLButtonElement>(null);
  const sourceKey = route.src ?? null; // null = 출처 전체(기본). 주소에 남아 공유·새로고침에서 유지된다.
  const setSourceKey = (key: string | null) => navigate({ ...route, view: "sessions", src: key ?? undefined, cur: undefined, peek: undefined });
  const chosen = useMemo(() => hosted?.sources.filter(s => sourceKey === null || s.key === sourceKey) ?? [], [hosted, sourceKey]);
  const index = useMemo(() => hosted === undefined || chosen.length === 0 ? undefined : createMergedSessionIndex(chosen), [hosted, chosen]);
  const [failed, setFailed] = useState<string[]>([]);
  const labelOf = (key: string) => hosted?.sources.find(s => s.key === key)?.label ?? "알 수 없는 출처";
  const [runtimes, setRuntimes] = useState<string[]>([]);
  const [shortcut, setShortcut] = useState(false);
  // URL의 cur는 "지금 쪽의 시작 커서"다. 그 쪽부터 이어 보며(앞쪽 위치는 모름) 이전 쪽 버튼은 꺼 둔다.
  const [anchor] = useState<MergedCursor | null>(() => decodeCursor(route.cur));
  const [pages, setPages] = useState<(MergedCursor | null)[]>([anchor]); // 각 쪽의 시작 커서
  const [page, setPage] = useState(0);
  const [list, setList] = useState<Awaited<ReturnType<NonNullable<typeof index>["list"]>>>();
  const [total, setTotal] = useState<number>();
  const [options, setOptions] = useState<{ runtime: string | null; sessions: number }[]>();
  const [error, setError] = useState<"permission" | "failed">();
  const [busy, setBusy] = useState(true);
  const [reload, setReload] = useState(0);
  const filter = useMemo(() => ({ activeFromMs: from, activeToMs: to, runtimes, searchWithoutRead: shortcut, ...(skillId === undefined ? {} : { skillId }) }), [from, to, runtimes, shortcut, skillId]);
  const filterKey = JSON.stringify([filter, sourceKey, hosted?.sources.map(s => s.key)]);
  const rowsRead = useRef<Record<string, number | null>>({});
  const [, repaint] = useState(0);
  const track = (screen: string, value: number | null) => { rowsRead.current[screen] = value; repaint(n => n + 1); };
  // 필터가 바뀌면 처음 쪽으로 돌아간다.
  const firstFilter = useRef(true);
  useEffect(() => { if (firstFilter.current) { firstFilter.current = false; return; } setPages([null]); setPage(0); }, [filterKey]);
  // 현재 쪽의 시작 커서를 주소에 남긴다(replace: 쪽을 넘길 때마다 기록이 쌓이지 않게).
  useEffect(() => {
    const cursor = pages[page] ?? null;
    const enc = cursor === null ? undefined : encodeCursor(cursor);
    if (enc === route.cur) return;
    history.replaceState(null, "", buildHash({ ...route, cur: enc }));
  }, [pages, page]);
  useEffect(() => {
    if (index === undefined) return;
    const controller = new AbortController();
    index.filterOptions(controller.signal).then(result => { setOptions(result.runtimes.map(r => ({ ...r }))); track("filterOptions", result.rowsRead); setFailed(current => [...new Set([...current, ...result.failed.map(f => f.source)])]); }, () => undefined);
    return () => controller.abort();
  }, [index, reload]);
  useEffect(() => {
    if (index === undefined) return;
    const controller = new AbortController();
    setTotal(undefined); setFailed([]);
    index.count(filter, controller.signal).then(result => { setTotal(result.total); track("count", result.rowsRead); setFailed(current => [...new Set([...current, ...result.failed.map(f => f.source)])]); }, () => undefined);
    return () => controller.abort();
  }, [index, filterKey, reload]);
  useEffect(() => {
    if (index === undefined) return;
    const controller = new AbortController();
    setBusy(true);
    index.list(filter, { limit: PAGE_SIZE, cursor: pages[page] ?? null }, controller.signal).then(result => {
      setList(result); setFailed(current => [...new Set([...current, ...result.failed.map(f => f.source)])]); setError(undefined); track("list", result.rowsRead);
      setPages(current => current[page + 1] !== undefined || result.nextCursor === null ? current : [...current, result.nextCursor]);
    }, (err: unknown) => {
      if (controller.signal.aborted) return;
      setError(err instanceof ApiError && err.status === 403 ? "permission" : "failed");
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [index, filterKey, page, reload]);

  const rows = list?.sessions ?? [];
  const selected = rows.find(row => peekValue(row) === route.peek);
  const open = (row: Row) => navigate({ ...route, view: "sessions", peek: peekValue(row), event: undefined });
  if (hosted === undefined) return <StatusMessage level="DEFAULT" announce message="출처 불러오는 중…" />;
  if (index === undefined) return <EmptyState title="세션을 불러올 수 없습니다" description="이 화면은 클라우드 출처에서만 사용할 수 있습니다." />;
  const hasFilter = runtimes.length > 0 || shortcut || period !== "7" || sourceKey !== null || skillId !== undefined;
  const clear = () => { setRuntimes([]); setShortcut(false); const { skill: _skill, ...rest } = route.filter; navigate({ ...route, filter: rest, period: "7", src: undefined, cur: undefined, peek: undefined }); };
  const runtimeChoices = (options ?? []).filter(o => o.runtime !== null)
    .map(o => ({ value: o.runtime as string, label: runtimeLabel(o.runtime), count: o.sessions }));
  const unknownRuntime = options?.find(o => o.runtime === null)?.sessions ?? 0;
  const first = page * PAGE_SIZE + 1;
  const anchored = anchor !== null;
  const facetBody = <>
    <p className="session-facets__scope" title={`기간은 최근 활동 시각 기준입니다. ${sourceKey === null ? `출처 ${hosted.sources.length}개를 합쳐 셉니다.` : "선택한 출처 한 곳만 셉니다."}`}>{sourceKey === null ? `출처 ${hosted.sources.length}개 합산` : "출처 1개"} · 최근 활동 기준</p>
    <button type="button" className="pe-button hs-shortcut" aria-pressed={shortcut} onClick={() => setShortcut(value => !value)}>
      <span>검색 있음·읽기 없음</span></button>
    <TableFacet label="실행 환경" choices={runtimeChoices} selected={runtimes} change={values => setRuntimes(values ?? [])} />
    {unknownRuntime > 0 && <p className="hs-unknown" role="note">실행 환경 알 수 없음 {unknownRuntime}개는 항목에 없어 이 필터로 고를 수 없습니다.</p>}
  </>;
  const activeCount = runtimes.length + (shortcut ? 1 : 0);
  return <><section className="sessions-console pe-console" data-pe-screen="sessions-table" data-peek={Boolean(route.peek)} aria-busy={busy}>
    <h2 className="sr-only">세션</h2>
    <div className="session-toolbar"><TableToolbar>
      <TimePeriodSelect label="기간(최근 활동 기준)" icon="calendar" value={period}
        options={[{ value: "all", label: "전체 기간" }, { value: "custom", label: "지정 기간", disabled: true },
          { value: "7", label: "최근 7일" }, { value: "30", label: "최근 30일" },
          { value: "60", label: "최근 60일" }, { value: "90", label: "최근 90일" }]}
        onChange={days => { if (days === "7" || days === "30" || days === "60" || days === "90" || days === "all") setPeriod(days); }} />
      <label className="hs-source">출처 <select value={sourceKey ?? ""} aria-label="출처" onChange={event => setSourceKey(event.currentTarget.value || null)}>
        <option value="">출처 전체 ({hosted.sources.length})</option>
        {hosted.sources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select></label>
      {narrow && <button type="button" ref={sheetTrigger} className="pe-button" aria-haspopup="dialog" aria-expanded={sheetOpen} aria-controls="hs-filter-sheet"
        onClick={() => setSheetOpen(true)}>필터{activeCount > 0 ? ` ${activeCount}` : ""}</button>}
      <span className="session-toolbar__count" role="status">{total === undefined ? "세는 중…" : `세션 ${total.toLocaleString("ko-KR")}개`}</span>
      {skillId !== undefined && <span className="hs-chip" role="status">스킬 {hostedSkillLabel(`skill://private/${skillId}/`, skillNames)} 읽은 세션만
        <button type="button" className="pe-button" aria-label="스킬 필터 해제" onClick={() => { const { skill: _s, ...rest } = route.filter; navigate({ ...route, filter: rest, cur: undefined, peek: undefined }); }}>해제</button></span>}
      {hasFilter && <button type="button" className="pe-button" onClick={clear}>필터 해제</button>}
      <span className="hs-summary" data-testid="source-summary" title="읽기 기록은 작업 성공을 뜻하지 않습니다.">{`출처 ${hosted.sources.length}개`}{hosted.lastReceivedMs == null ? "" : ` · 마지막 수신 ${clock.format(hosted.lastReceivedMs).slice(0, 5)}`}</span>
    </TableToolbar></div>
    {failed.length > 0 && <div className="hs-partial"><Alert variant="warning" announce>
      {`출처 ${failed.length}개(${failed.map(labelOf).join(", ")})를 불러오지 못해 빠져 있습니다. 아래 목록과 개수는 전체가 아닙니다.`}
      {" "}<button type="button" className="btn" onClick={() => { setPages([null]); setPage(0); setReload(n => n + 1); }}>다시 시도</button></Alert></div>}
    {error && <Alert variant="destructive" announce action={<button type="button" className="btn" onClick={() => { setError(undefined); setPages([null]); setPage(0); setReload(n => n + 1); }}>다시 시도</button>}>
      {error === "permission" ? "이 기록을 볼 권한이 없습니다" : "세션을 불러오지 못했습니다"}</Alert>}
    <div className="sessions-body" data-facets-open={!narrow}>
      {!narrow && <aside id="session-facets" className="session-facets lf-facet-panel" aria-label="세션 필터">{facetBody}</aside>}
      <div className="session-results" tabIndex={-1} aria-label="세션 기록">
        {busy && list === undefined && <StatusMessage level="DEFAULT" announce message="세션 불러오는 중…" />}
        {list !== undefined && rows.length === 0 && (hasFilter
          ? <EmptyState title="조건에 맞는 세션이 없습니다" description="기간을 늘리거나 필터를 해제하세요."
              action={<button type="button" className="btn" onClick={clear}>필터 해제</button>} />
          : <EmptyState title="아직 기록된 세션이 없습니다" description="올린 기록에 이벤트가 있으면 여기에 나타납니다. 출처 기기에서 최신 기록을 올리고 출처를 다시 불러오세요." />)}
        {rows.length > 0 && <div className="sessions__frame session-table-frame lf-table-surface" data-density={route.density ?? "compact"}>
          <table className="sessions session-table hs-table" data-density={route.density ?? "compact"}>
            <caption className="sr-only">세션 기록. 최근 활동이 늦은 순입니다.</caption>
            <thead><tr>
              <th scope="col" className="cell-hsstart">시작</th>
              <th scope="col" className="cell-hsactive" aria-sort="descending">최근 활동</th>
              <th scope="col" className="cell-hsruntime">실행 환경</th>
              <th scope="col" className="cell-hsruntime">출처</th>
              <th scope="col" className="cell-hscounts">이벤트 · 읽기 · 검색</th>
              <th scope="col" className="cell-hsskills">읽은 스킬</th>
            </tr></thead>
            <tbody>{rows.map(row => <TableRow key={peekValue(row)} data-session-id={row.sessionId} selected={route.peek === peekValue(row)} onOpen={() => open(row)}>
              <td className="cell-hsstart" data-label="시작">{row.startedMs === null
                ? <span className="hs-unknown" title="이 세션의 시작 기록이 아직 없습니다">시작 알 수 없음</span>
                : <time dateTime={new Date(row.startedMs).toISOString()} title={full(row.startedMs)}>{stamp.format(row.startedMs)}</time>}</td>
              <td className="cell-hsactive" data-label="최근 활동"><a className="rowlink" href={buildHash({ ...route, view: "sessions", peek: peekValue(row), event: undefined })}>
                <time dateTime={new Date(row.lastEventMs).toISOString()} title={`마지막 이벤트 ${full(row.lastEventMs)}`}>{stamp.format(row.lastEventMs)}</time></a></td>
              <td className="cell-hsruntime" data-label="실행 환경">{row.runtime === null ? <span className="hs-unknown">알 수 없음</span> : runtimeLabel(row.runtime)}</td>
              <td className="cell-hsruntime" data-label="출처" title={labelOf(row.source)}>{labelOf(row.source)}</td>
              <td className="cell-hscounts hs-counts" data-label="이벤트 · 읽기 · 검색"><span className="hs-c-wide">{row.events} · {row.reads} · {row.searches}</span><span className="hs-c-narrow">이벤트 {row.events} · 읽기 {row.reads} · 검색 {row.searches}</span></td>
              <td className="cell-hsskills" data-label="읽은 스킬">{row.skills.length === 0 ? <span className="hs-unknown" title="읽은 스킬 없음" aria-label="읽은 스킬 없음">—</span>
                : <span className="hs-skills">{[...new Map(row.skills.map(s => [skillKey(s.skillId), s])).values()].map(s => <Tag key={skillKey(s.skillId)} text={hostedSkillLabel(s.skillId, skillNames)} />)}</span>}</td>
            </TableRow>)}</tbody>
          </table>
        </div>}
        {rows.length > 0 && <nav className="hs-pager" aria-label="표 페이지" aria-busy={busy}>
          <span role="status">{anchored ? `공유된 위치에서 이어서 ${rows.length}개` : total === undefined ? `${first}–${first + rows.length - 1}` : `${total.toLocaleString("ko-KR")}개 중 ${first}–${first + rows.length - 1}`}</span>
          <IconButton label="이전" icon="chevronLeft" variant="outline" disabled={busy || page === 0} onClick={() => setPage(page - 1)} />
          <IconButton label="다음" icon="chevronRight" variant="outline" disabled={busy || list?.nextCursor === null || list === undefined} onClick={() => setPage(page + 1)} />
        </nav>}
        {showRowsRead() && <p className="hs-rows" data-testid="rows-read">D1 읽은 행(화면별): {Object.entries(rowsRead.current).map(([k, v]) => `${k} ${v ?? "알 수 없음"}`).join(" · ")}</p>}
      </div>
    </div>
  </section>
  {narrow && sheetOpen && <FilterSheet close={() => { setSheetOpen(false); sheetTrigger.current?.focus(); }}>{facetBody}</FilterSheet>}
  {route.peek && <HostedPeek route={route} navigate={navigate} row={selected} peek={route.peek} index={index} label={labelOf} select={hosted.select} />}
  </>;
}

function FilterSheet({ close, children }: { readonly close: () => void; readonly children: React.ReactNode }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  return <div className="hs-sheet" id="hs-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="hs-sheet-title"
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),select,summary"))
        .filter(node => node.getClientRects().length > 0);
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <div className="hs-sheet__bar"><h2 id="hs-sheet-title">필터</h2><button type="button" ref={closeButton} className="pe-button" onClick={close}>적용하고 닫기</button></div>
    <div className="hs-sheet__body">{children}</div>
  </div>;
}

function HostedPeek({ route, navigate, row, peek, index, label, select }: Pick<ViewProps, "route" | "navigate"> & {
  readonly row?: Row; readonly peek: string; readonly index: ReturnType<typeof createMergedSessionIndex>;
  readonly label: (key: string) => string; readonly select: (key: string) => void;
}) {
  const skillNames = useSkillNames();
  const { source, sessionId } = splitPeek(peek);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cursor, setCursor] = useState<SessionIndexEvents["nextCursor"]>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [more, setMore] = useState(0);
  const [read, setRead] = useState<number | null>(null);
  useEffect(() => { setEvents([]); setCursor(null); setMore(0); setState("loading"); }, [peek]);
  useEffect(() => {
    if (index === undefined) return;
    const controller = new AbortController();
    index.events(source, sessionId, { limit: 200, cursor: more === 0 ? null : cursor }, controller.signal).then(result => {
      setEvents(current => more === 0 ? result.events.map(e => ({ ...e })) : [...current, ...result.events]);
      setCursor(result.nextCursor); setRead(result.rowsRead); setState("ready");
    }, () => { if (!controller.signal.aborted) setState("failed"); });
    return () => controller.abort();
  }, [index, peek, more]);
  const close = () => navigate({ ...route, peek: undefined, event: undefined });
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [route]);
  return <aside className="hs-peek session-peek pe-console" role="dialog" aria-labelledby="hs-peek-title" data-pe-screen="sessions-peek">
    <div className="hs-peek__bar">
      <a className="pe-button" onClick={() => select(source)} href={buildHash({ ...route, view: "trace", sessionId, peek: undefined })}>본문은 리포트에서<Icon name="external" /></a>
      <button type="button" className="pe-button" onClick={close}>닫기</button>
    </div>
    <h2 id="hs-peek-title"><code>{sessionId}</code></h2>
    {row !== undefined && <dl>
      <dt>시작</dt><dd>{row.startedMs === null ? <span className="hs-unknown">알 수 없음 (시작 기록 없음)</span> : full(row.startedMs)}</dd>
      <dt>처음 관측한 이벤트</dt><dd>{full(row.firstEventMs)}</dd>
      <dt>최근 활동</dt><dd>{full(row.lastEventMs)}</dd>
      <dt>출처</dt><dd>{label(source)}</dd>
      <dt>실행 환경</dt><dd>{runtimeLabel(row.runtime)}</dd>
      <dt>이벤트 · 읽기 · 검색</dt><dd>{row.events} · {row.reads} · {row.searches}</dd>
    </dl>}
    {row !== undefined && row.skills.length > 0 && <>
      <h3 className="sr-only">읽은 스킬</h3>
      <div className="hs-skills" aria-label="읽은 스킬">{row.skills.map(s => <Tag key={`${s.skillId}:${s.digest ?? ""}`} text={hostedSkillLabel(s.skillId, skillNames)}
        secondaryText={s.digest === null ? "버전 알 수 없음" : s.digest.slice(0, 8)} />)}</div>
    </>}
    <h3>이벤트 타임라인</h3>
    <p className="hs-body-note">종류와 시각만 보입니다. 요청문·검색어·본문은 이 화면에서 열지 않습니다.</p>
    {state === "loading" && <StatusMessage level="DEFAULT" announce message="이벤트 불러오는 중…" />}
    {state === "failed" && <Alert variant="destructive" announce action={<button type="button" className="btn" onClick={() => { setState("loading"); setMore(n => n); }}>닫고 다시 열기</button>}>이벤트를 불러오지 못했습니다</Alert>}
    {state === "ready" && events.length === 0 && <p className="hs-unknown">이벤트가 없습니다.</p>}
    <ol className="hs-timeline">{events.map(e => <li key={e.entityKey} data-kind={e.kind ?? "unknown"}>
      <time dateTime={new Date(e.timestampMs).toISOString()} title={full(e.timestampMs)}>{clock.format(e.timestampMs)}</time>
      <span>{kindLabel(e.kind)}</span></li>)}</ol>
    {cursor !== null && <button type="button" className="btn" onClick={() => setMore(n => n + 1)}>이벤트 더 보기</button>}
    {showRowsRead() && <p className="hs-rows">D1 읽은 행: events {read ?? "알 수 없음"}</p>}
  </aside>;
}
