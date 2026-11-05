import { useEffect, useState } from "preact/hooks";
import type { Filter } from "../../../src/types.js";
import { REQUEST_STATUSES, type RequestStatus, type SearchResult } from "../../../src/request-status.js";
import { FILTER_KEYS, SESSION_COLUMNS, STATE_LABEL, withoutFilterKey, type ViewProps } from "../../state";
import { Icon } from "../../components/icons";
import { COLUMN_LABEL } from "./model";
import { DEFAULT_COLUMNS } from "./table";

export function SessionToolbar({ route, navigate, count, facetsOpen, toggleFacets }: Pick<ViewProps, "route" | "navigate"> & {
  readonly count?: number; readonly facetsOpen: boolean; readonly toggleFacets: () => void;
}) {
  const [draft, setDraft] = useState(route.filter.q ?? "");
  useEffect(() => setDraft(route.filter.q ?? ""), [route.filter.q]);
  const update = (patch: Filter) => navigate({ ...route, peek: undefined, filter: { ...route.filter, ...patch } });
  const columns = route.columns ?? DEFAULT_COLUMNS;
  return <>
    <div class="session-toolbar">
      <form class="session-search" role="search" onSubmit={event => { event.preventDefault(); update({ q: draft.trim() || undefined }); }}>
        <Icon name="search" /><label class="sr-only" for="session-search">요청문과 스킬 검색</label>
        <input id="session-search" type="search" value={draft} placeholder="요청문 · 스킬 · 세션 ID"
          onInput={event => setDraft(event.currentTarget.value)} />
        <button class="pe-button" type="submit">검색</button>
      </form>
      <select class="field" aria-label="기간" value={route.filter.from === undefined && route.filter.to === undefined ? "all" : "custom"}
        onChange={event => {
          const days = event.currentTarget.value;
          const to = Date.now();
          update(days === "all" ? { from: undefined, to: undefined } : { from: to - Number(days) * 86400000, to });
        }}>
        <option value="all">전체 기간</option><option value="custom" disabled>지정 기간</option>
        <option value="7">최근 7일</option><option value="30">최근 30일</option><option value="60">최근 60일</option>
      </select>
      <span class="session-toolbar__count">{count === undefined ? "집계 중" : `세션 ${count}개`}</span>
      <button class="pe-button session-facets-toggle" aria-controls="session-facets" aria-expanded={facetsOpen} onClick={toggleFacets}><Icon name="filter" />필터</button>
      <details class="session-menu" onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
      }}><summary class="pe-button"><Icon name="filter" />요청 상태</summary>
        <div class="session-menu__body">
          {(["searchStatus", "loadStatus"] as const).map(key => <label key={key}>{key === "searchStatus" ? "검색 상태" : "읽기 상태"}
            <select class="field" value={route.filter[key]?.[0] ?? ""} onChange={event => {
              const value = event.currentTarget.value as RequestStatus | "";
              update({ [key]: value ? [value] : undefined });
            }}><option value="">전체</option>{REQUEST_STATUSES.map(value => <option key={value} value={value}>{STATE_LABEL[value]}</option>)}</select>
          </label>)}
          <label>검색 결과<select class="field" value={route.filter.searchResult?.[0] ?? ""} onChange={event => {
            const value = event.currentTarget.value as SearchResult | ""; update({ searchResult: value ? [value] : undefined });
          }}><option value="">전체</option><option value="candidates_found">후보 있음</option><option value="no_candidates">후보 없음</option></select></label>
        </div>
      </details>
      <details class="session-menu" data-control="columns" onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
      }}><summary class="pe-button"><Icon name="columns" />열 {columns.length}/{SESSION_COLUMNS.length}</summary>
        <div class="session-menu__body">
          {SESSION_COLUMNS.map(column => <label key={column}><input type="checkbox" checked={columns.includes(column)}
            onChange={event => {
              const next = event.currentTarget.checked ? [...columns, column] : columns.filter(value => value !== column);
              navigate({ ...route, columns: SESSION_COLUMNS.filter(value => next.includes(value)) });
            }} />{COLUMN_LABEL[column]}</label>)}
          <button class="pe-button" onClick={() => navigate({ ...route, columns: undefined })}>기본 열 복원</button>
        </div>
      </details>
      <label class="sr-only" for="session-density">행 간격</label>
      <select id="session-density" class="field" value={route.density ?? "compact"} onChange={event => {
        const value = event.currentTarget.value;
        if (value === "compact" || value === "normal" || value === "comfortable") navigate({ ...route, density: value });
      }}><option value="compact">촘촘하게</option><option value="normal">보통 간격</option><option value="comfortable">넓은 간격</option></select>
    </div>
    <div class="session-applied" role="group" aria-label="적용된 필터">
      {FILTER_KEYS.filter(key => route.filter[key] !== undefined && key !== "hourSpan").map(key => {
        const value = route.filter[key];
        const text = Array.isArray(value) ? value.join(", ") : String(value);
        return <button key={key} class="pe-button session-filter-pill" onClick={() => navigate({ ...route, peek: undefined, filter: withoutFilterKey(route.filter, key) })}
          aria-label={`${key} ${text} 필터 해제`}><code>{key}</code>{" "}<code>{text}</code><Icon name="close" /></button>;
      })}
      {FILTER_KEYS.some(key => route.filter[key] !== undefined) && <button class="pe-button" onClick={() => navigate({ ...route, peek: undefined, filter: {} })}>전체 해제</button>}
    </div>
  </>;
}
