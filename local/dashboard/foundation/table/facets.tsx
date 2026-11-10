import { useState } from "preact/hooks";
import { Button } from "../controls/buttons";
import { Checkbox, Input } from "../controls/fields";
import { tableStyles } from "./styles";

export type FacetChoice<T extends string> = { readonly value: T; readonly label: string; readonly count: number };

export function TableFacet<T extends string>({ label, choices, selected = [], change }: {
  readonly label: string; readonly choices: readonly FacetChoice<T>[]; readonly selected?: readonly T[];
  readonly change: (values: T[] | undefined) => void;
}) {
  tableStyles();
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState("select");
  const [query, setQuery] = useState("");
  const shown = choices.filter(choice => choice.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <fieldset class="lf-facet">
    <legend><span class="lf-facet-heading" data-active={selected.length > 0}>
      <Button text={label} icon="chevron" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} />
      {selected.length > 0 && <Button text="해제" aria-label={`${label} 필터 해제`} variant="ghost" onClick={() => change(undefined)} />}
    </span></legend>
    {expanded && <>
      <div class="lf-facet-modes" role="group" aria-label={`${label} 입력 방식`}>
        <Button text="선택" variant="ghost" aria-pressed={mode === "select"} onClick={() => setMode("select")} />
        <Button text="텍스트" variant="ghost" aria-pressed={mode === "text"} onClick={() => setMode("text")} />
      </div>
      <div class="lf-facet-values">
        <Input label={`${label} 값 찾기`} type={mode === "text" ? "text" : "search"} icon={mode === "text" ? false : "search"} placeholder={mode === "text" ? "포함하는 값 찾기" : "값 찾기"}
          value={query} onInput={event => setQuery(event.currentTarget.value)} />
        {shown.map(choice => <div class="lf-facet-choice" key={choice.value}>
          <Checkbox size="sm" label={choice.label} title={choice.value} checked={selected.includes(choice.value)}
            onChange={event => {
              const next = event.currentTarget.checked ? [...selected, choice.value] : selected.filter(value => value !== choice.value);
              change(next.length ? next : undefined);
            }} /><span>{choice.count}</span>
        </div>)}
        {!shown.length && <p role="status">이 범위에 일치하는 값이 없습니다.</p>}
      </div>
    </>}
  </fieldset>;
}
