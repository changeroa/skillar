import type { SessionListRow } from "../../api";
import { ADOPTION_STATES, RUNTIME_IDS, RUNTIME_LABEL, STATE_LABEL, skillName, type ViewProps } from "../../state";
import { readSkills } from "./model";
import { TableFacet } from "../../foundation/table/facets";

export function SessionFacets({ rows, route, navigate }: Pick<ViewProps, "route" | "navigate"> & { readonly rows: readonly SessionListRow[] }) {
  const counts = (value: string, field: "runtime" | "state") => rows.filter(row => row[field] === value).length;
  const skills = [...new Set(rows.flatMap(row => [...readSkills(row)]))].sort();
  return <aside id="session-facets" class="session-facets lf-facet-panel" aria-label="세션 필터">
    <p class="session-facets__scope">선택한 기간과 자동 실행 설정 안의 수입니다.</p>
    <TableFacet label="실행 환경" choices={RUNTIME_IDS.map(value => ({ value, label: RUNTIME_LABEL[value], count: counts(value, "runtime") }))}
      selected={route.filter.runtime} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, runtime: values } })} />
    <TableFacet label="상태" choices={ADOPTION_STATES.map(value => ({ value, label: STATE_LABEL[value], count: counts(value, "state") }))}
      selected={route.filter.state} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, state: values } })} />
    <TableFacet label="읽은 스킬" choices={skills.map(value => ({ value, label: skillName(value), count: rows.filter(row => readSkills(row).includes(value)).length }))}
      selected={route.filter.skill} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, skill: values } })} />
  </aside>;
}
