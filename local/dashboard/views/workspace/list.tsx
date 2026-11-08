import { useLayoutEffect, useRef } from "preact/hooks";
import type { FlowListEntry } from "../../../src/types.js";
import { api } from "../../api";
import { buildHash, type ViewProps } from "../../state";
import { AnalysisError, AnalysisToolbar, conditions, useAnalysisReport } from "../../components/analysis";
import { flowTitle, flowsQuery, formatStarted, workspaceFilter } from "./model";
import { SpecTag } from "./row-parts";
import { WorkspaceView } from "./detail";

export function sortWorkspaces(rows: readonly FlowListEntry[], sort: string) {
  const key = sort.replace(/^-/, "");
  return [...rows].sort((a, b) => {
    const left = key === "name" ? flowTitle(a) : key === "sessions" ? a.counts.sessions : key === "panes" ? a.counts.panes : a.startedMs;
    const right = key === "name" ? flowTitle(b) : key === "sessions" ? b.counts.sessions : key === "panes" ? b.counts.panes : b.startedMs;
    if (left === null || right === null) return left === right ? a.id.localeCompare(b.id) : left === null ? 1 : -1;
    return (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "ko")) * (sort.startsWith("-") ? -1 : 1) || a.id.localeCompare(b.id);
  });
}

function WorkspacePeek(props: ViewProps) {
  const { route, navigate } = props;
  const ref = useRef<HTMLElement>(null);
  const close = () => navigate({ ...route, peek: undefined });
  useLayoutEffect(() => {
    const origin = [...document.querySelectorAll<HTMLButtonElement>(".workspace-table .wsrow__title")]
      .find(button => button.closest("tr")?.getAttribute("data-flow") === route.peek);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => { queueMicrotask(() => { if (origin?.isConnected) origin.focus({ preventScroll: true }); }); };
  }, []);
  return <aside ref={ref} class="workspace-peek" role="dialog" aria-modal="true" aria-label="작업 공간 미리보기" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== "Tab") return;
    const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),summary")].filter(node => node.checkVisibility());
    if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
  }}>
    <header class="workspace-peek__head"><button class="pe-button" onClick={close}>목록으로 · 닫기</button>
      <a class="pe-button" href={buildHash({ ...route, view: "workspace", flowId: route.peek, peek: undefined })}>전체 페이지로 열기</a></header>
    <div class="workspace-peek__body"><WorkspaceView {...props} route={{ ...route, flowId: route.peek }} peek /></div>
  </aside>;
}

export function WorkspacesView(props: ViewProps) {
  const { route, navigate, live, embedded } = props;
  const query = flowsQuery(route);
  const report = useAnalysisReport(JSON.stringify(query), async () => ({ dto: await api.flows(query), filter: workspaceFilter(query) }), embedded || api.mode === "cloud" ? live.seq : 0);
  const current = report.snapshot?.value;
  const sort = route.analysisSort ?? "-started", search = route.analysisQuery ?? "";
  const matches = current?.dto.flows.filter(entry => flowTitle(entry).toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  const rows = sortWorkspaces(matches.filter(entry => !route.facet || entry.kind === route.facet), sort);
  const heading = (key: string, text: string) => <th scope="col" aria-sort={sort.replace(/^-/, "") !== key ? "none" : sort.startsWith("-") ? "descending" : "ascending"}>
    <button onClick={() => navigate({ ...route, analysisSort: sort === key ? `-${key}` : key })}>{text} {sort.replace(/^-/, "") === key ? sort.startsWith("-") ? "↓" : "↑" : "↕"}</button></th>;
  return <section class="analysis pe-console" aria-busy={report.busy}>
    <header class="page-title">{embedded ? <h2>작업 공간</h2> : <h1>작업 공간</h1>}<p>작업 공간별 패널과 연결된 세션을 확인합니다.</p></header>
    <AnalysisToolbar route={{ ...route, filter: workspaceFilter(query) }} navigate={navigate} refresh={report.refresh} busy={report.busy} workspace />
    <label>작업 공간 검색 <input class="field" type="search" value={search} onInput={event => navigate({ ...route, analysisQuery: event.currentTarget.value || undefined, peek: undefined })} /></label>
    <AnalysisError error={report.error} title="작업 공간을 불러올 수 없습니다" retry={report.refresh} />
    {report.busy && <p role="status">{current ? `갱신 중: ${conditions(workspaceFilter(query))}` : "작업 공간 불러오는 중…"}</p>}
    {current && <p class="analysis-scope" data-result-conditions>{conditions(current.filter)} · {formatStarted(current.dto.generatedAt)} 기준 · 받은 {current.dto.flows.length}개 내부 정렬{current.dto.nextCursor ? " · 추가 작업 공간 있음" : ""}</p>}
    <div class="workspace-split">
      <div inert={!!route.peek}>
        {current && <div class="analysis-facets" aria-label="받은 작업 공간의 종류별 수">
          <button class="pe-button" aria-pressed={!route.facet} onClick={() => navigate({ ...route, facet: undefined })}>전체 {matches.length}</button>
          {[...new Set(matches.map(entry => entry.kind))].map(kind => <button class="pe-button" key={kind} aria-pressed={route.facet === kind} onClick={() => navigate({ ...route, facet: kind })}>
            {kind === "outside_herdr" ? "패널 연결 없음" : kind === "flow" ? "등록됨" : "미등록"} {matches.filter(entry => entry.kind === kind).length}</button>)}
        </div>}
        {current && rows.length > 0 && <div class="analysis-scroll"><table class="analysis-table workspace-table">
          <thead><tr>{heading("name", "작업 공간")}{heading("started", "시작")}{heading("panes", "패널")}{heading("sessions", "세션")}<th scope="col">스펙</th></tr></thead>
          <tbody>{rows.map(entry => <tr key={entry.id} data-flow={entry.id} aria-selected={route.peek === entry.id}>
            <td><button class="wsrow__title" onClick={() => navigate({ ...route, peek: entry.id })}>{flowTitle(entry)}</button></td>
            <td><time>{formatStarted(entry.startedMs)}</time></td><td class="num">{entry.counts.panes}</td><td class="num">{entry.counts.sessions}</td><td><SpecTag entry={entry} /></td>
          </tr>)}</tbody></table></div>}
        {current && rows.length === 0 && <section class="empty"><h2>이 기간에는 작업 공간이 없습니다</h2>
          <p>{current.dto.flows.length ? "검색어와 종류 필터를 지워 보세요." : "연결 확인 명령으로 작업 공간 연결을 확인한 뒤 에이전트를 실행하세요."}</p>
          {search || route.facet || query.from !== undefined || query.to !== undefined || query.automated !== undefined
            ? <button class="pe-button" onClick={() => navigate({ view: "workspaces", filter: {} })}>필터 지우기</button>
            : <a class="pe-button" href={buildHash({ view: "sessions", filter: {} })}>연결 안내 보기</a>}
          <code>skillar doctor</code>
        </section>}
      </div>
      {route.peek && <WorkspacePeek {...props} />}
    </div>
  </section>;
}
