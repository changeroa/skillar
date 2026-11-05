import { useState } from "preact/hooks";
import type { SessionListRow } from "../../api";
import { ADOPTION_STATES, RUNTIME_IDS, RUNTIME_LABEL, STATE_LABEL, skillName, type ViewProps } from "../../state";
import { readSkills } from "./model";

type Choice<T extends string> = { readonly value: T; readonly label: string; readonly count: number };
function Facet<T extends string>({ label, choices, selected, change, codeValues = false }: {
  readonly label: string; readonly choices: readonly Choice<T>[]; readonly selected?: readonly T[];
  readonly change: (values: T[] | undefined) => void;
  readonly codeValues?: boolean;
}) {
  const [mode, setMode] = useState("select"), [query, setQuery] = useState("");
  const shown = choices.filter(choice => mode === "select" || choice.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <fieldset class="session-facet"><legend>{label}</legend>
    <div class="session-facet__modes" role="group" aria-label={`${label} 입력 방식`}>
      <button class="pe-button" aria-pressed={mode === "select"} onClick={() => setMode("select")}>선택</button>
      <button class="pe-button" aria-pressed={mode === "text"} onClick={() => setMode("text")}>텍스트</button>
    </div>
    {mode === "text" && <input class="field" type="search" aria-label={`${label} 값 찾기`} placeholder="포함하는 값 찾기"
      value={query} onInput={event => setQuery(event.currentTarget.value)} />}
    {shown.map(choice => <label class="session-facet__choice" key={choice.value}>
      <input type="checkbox" checked={selected?.includes(choice.value) ?? false} onChange={event => {
        const next = new Set(selected);
        if (event.currentTarget.checked) next.add(choice.value); else next.delete(choice.value);
        change(next.size ? [...next] : undefined);
      }} /><span title={choice.value}>{codeValues ? <code>{choice.label}</code> : choice.label}</span><span class="pe-muted">{choice.count}</span>
    </label>)}
    {!shown.length && <p class="pe-muted">이 범위에 일치하는 값이 없습니다.</p>}
  </fieldset>;
}

export function SessionFacets({ rows, route, navigate }: Pick<ViewProps, "route" | "navigate"> & { readonly rows: readonly SessionListRow[] }) {
  const counts = (value: string, field: "runtime" | "state") => rows.filter(row => row[field] === value).length;
  const skills = [...new Set(rows.flatMap(row => [...readSkills(row)]))].sort();
  return <aside id="session-facets" class="session-facets" aria-label="세션 필터">
    <p class="session-facets__scope">선택한 기간과 자동 실행 설정 안의 수입니다.</p>
    <Facet codeValues label="실행 환경" choices={RUNTIME_IDS.map(value => ({ value, label: RUNTIME_LABEL[value], count: counts(value, "runtime") }))}
      selected={route.filter.runtime} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, runtime: values } })} />
    <Facet label="상태" choices={ADOPTION_STATES.map(value => ({ value, label: STATE_LABEL[value], count: counts(value, "state") }))}
      selected={route.filter.state} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, state: values } })} />
    <Facet codeValues label="읽은 스킬" choices={skills.map(value => ({ value, label: skillName(value), count: rows.filter(row => readSkills(row).includes(value)).length }))}
      selected={route.filter.skill} change={values => navigate({ ...route, peek: undefined, filter: { ...route.filter, skill: values } })} />
  </aside>;
}
