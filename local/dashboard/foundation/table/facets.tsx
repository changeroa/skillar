import { useState } from "react";
import { Button } from "../controls/buttons";
import { Checkbox, TextInput } from "../controls/fields";
import { tableStyles } from "./styles";

export type FacetChoice<T extends string> = { readonly value: T; readonly label: string; readonly count: number };

export function TableFacet<T extends string>({ label, choices, selected = [], change }: {
  readonly label: string; readonly choices: readonly FacetChoice<T>[]; readonly selected?: readonly T[];
  readonly change: (values: T[] | undefined) => void;
}) {
  tableStyles();
  const [expanded, setExpanded] = useState(true);
  const [query, setQuery] = useState("");
  const shown = choices.filter(choice => choice.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <fieldset className="lf-facet">
    <legend><span className="lf-facet-heading" data-active={selected.length > 0}>
      <Button text={label} icon="chevron" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} />
      {selected.length > 0 && <Button text="해제" icon="close" aria-label={`${label} 필터 해제`} variant="ghost" onClick={() => change(undefined)} />}
    </span></legend>
    {expanded && <>
      <div className="lf-facet-values">
        <TextInput label={`${label} 값 찾기`} type="search" placeholder="값 찾기"
          value={query} onChange={setQuery} />
        {shown.map(choice => <div className="lf-facet-choice" key={choice.value}>
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
