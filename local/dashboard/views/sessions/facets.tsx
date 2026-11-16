import type { SessionListRow } from "../../api";
import { REQUEST_STATUSES, hasStatus, type RequestStatus } from "../../../src/request-status.js";
import { RUNTIME_IDS, RUNTIME_LABEL, STATE_LABEL, skillName, type ViewProps } from "../../state";
import { readSkills } from "./model";
import { TableFacet } from "../../foundation/table/facets";

export function SessionFacets({ rows, route, navigate }: Pick<ViewProps, "route" | "navigate"> & { readonly rows: readonly SessionListRow[] }) {
  const runtimes = (value: string) => rows.filter(row => row.runtime === value).length;
  // Mirrors matchesFilter: a row without request summaries counts as unknown.
  const statuses = (op: "search" | "load", value: RequestStatus) =>
    rows.filter(row => row.requests ? hasStatus(row.requests[op], value) : value === "unknown").length;
  const skills = [...new Set(rows.flatMap(row => [...readSkills(row)]))].sort();
  const results = (value: "candidates_found" | "no_candidates") =>
    rows.filter(row => (row.requests?.search.results[value] ?? 0) > 0).length;
  const conversionMiss = rows.filter(row => (row.requests?.search.results.candidates_found ?? 0) > 0 && row.requests !== undefined && hasStatus(row.requests.load, "not_attempted")).length;
  return <aside id="session-facets" class="session-facets lf-facet-panel" aria-label="세션 필터">
    <p class="session-facets__scope">선택한 기간과 자동 실행 설정 안의 수입니다.</p>
    <button type="button" class="pe-button" onClick={() => navigate({ ...route, peek: undefined, filter: { ...route.filter, searchStatus: undefined, loadStatus: ["not_attempted"], searchResult: ["candidates_found"] } })}>후보 있음·읽기 없음 ({conversionMiss})</button>
    <div class="session-facet--result"><TableFacet label="검색 결과" choices={([{ value: "candidates_found", label: "후보 있음" }, { value: "no_candidates", label: "후보 없음" }] as const).map(option => ({ value: option.value, label: option.label, count: results(option.value) }))}
      selected={route.filter.searchResult} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, searchResult: values } })} /></div>
    <TableFacet label="실행 환경" choices={RUNTIME_IDS.map(value => ({ value, label: RUNTIME_LABEL[value], count: runtimes(value) }))}
      selected={route.filter.runtime} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, runtime: values } })} />
    <TableFacet label="검색 상태" choices={REQUEST_STATUSES.map(value => ({ value, label: STATE_LABEL[value], count: statuses("search", value) }))}
      selected={route.filter.searchStatus} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, searchStatus: values } })} />
    <TableFacet label="읽기 상태" choices={REQUEST_STATUSES.map(value => ({ value, label: STATE_LABEL[value], count: statuses("load", value) }))}
      selected={route.filter.loadStatus} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, loadStatus: values } })} />
    <TableFacet label="읽은 스킬" choices={skills.map(value => ({ value, label: skillName(value), count: rows.filter(row => readSkills(row).includes(value)).length }))}
      selected={route.filter.skill} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, skill: values } })} />
  </aside>;
}
