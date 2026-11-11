import { useEffect, useState } from "preact/hooks";
import type { Filter } from "../../../src/types.js";
import { REQUEST_STATUSES } from "../../../src/request-status.js";
import { FILTER_KEYS, SESSION_COLUMNS, STATE_LABEL, withoutFilterKey, type ViewProps } from "../../state";
import { Icon } from "../../components/icons";
import { COLUMN_LABEL } from "./model";
import { DEFAULT_COLUMNS } from "./table";
import { kstPeriodStart } from "../../time";
import { Button } from "../../foundation/controls/buttons";
import { SearchInput } from "../../foundation/controls/fields";
import { TimePeriodSelect } from "../../foundation/controls/date-range";
import { DropdownMenu } from "../../foundation/overlays/menu";
import { ColumnVisibility, TableDensity } from "../../foundation/table/controls";
import { TableToolbar } from "../../foundation/table/parts";

export function SessionToolbar({ route, navigate, count, facetsOpen, toggleFacets, sheet }: Pick<ViewProps, "route" | "navigate"> & {
  readonly count?: number; readonly facetsOpen: boolean; readonly toggleFacets: () => void; readonly sheet?: boolean;
}) {
  const [draft, setDraft] = useState(route.filter.q ?? "");
  useEffect(() => setDraft(route.filter.q ?? ""), [route.filter.q]);
  const update = (patch: Filter) => navigate({ ...route, peek: undefined, filter: { ...route.filter, ...patch } });
  const columns = route.columns ?? DEFAULT_COLUMNS;
  return <>
    <div class="session-toolbar"><TableToolbar>
      <SearchInput id="session-search" label="요청문과 스킬 검색" value={draft} placeholder="요청문 · 스킬 · 세션 ID"
        onChange={setDraft} onSubmit={value => update({ q: value.trim() || undefined })} />
      <TimePeriodSelect label="기간" value={route.filter.from === undefined && route.filter.to === undefined ? "all" : "custom"}
        options={[{ value: "all", label: "전체 기간" }, { value: "custom", label: "지정 기간", disabled: true },
          { value: "7", label: "최근 7일" }, { value: "30", label: "최근 30일" }, { value: "60", label: "최근 60일" }]}
        onChange={days => {
          const to = Date.now();
          update(days === "all" ? { from: undefined, to: undefined } : { from: kstPeriodStart(to, Number(days)), to });
        }} />
      <span class="session-toolbar__count">{count === undefined ? "집계 중" : `세션 ${count}개`}</span>
      <span class="session-facets-toggle"><Button text="필터" variant="outline"
        aria-controls={sheet ? "session-filter-sheet" : "session-facets"} aria-expanded={facetsOpen}
        aria-haspopup={sheet ? "dialog" : undefined} onClick={toggleFacets} /></span>
      <DropdownMenu id="session-request-state" label="요청 상태" width="wide" items={[
        ...(["searchStatus", "loadStatus"] as const).flatMap(key => [
          { id: `${key}-all`, label: `${key === "searchStatus" ? "검색" : "읽기"} 상태 전체`,
            checked: !route.filter[key]?.length, separatorBefore: key === "loadStatus",
            onSelect: () => update({ [key]: undefined }) },
          ...REQUEST_STATUSES.map(value => ({ id: `${key}-${value}`,
            label: `${key === "searchStatus" ? "검색" : "읽기"} ${STATE_LABEL[value]}`,
            checked: route.filter[key]?.includes(value) ?? false, onSelect: () => update({ [key]: [value] }) })),
        ]),
        { id: "result-all", label: "검색 결과 전체", separatorBefore: true, checked: !route.filter.searchResult?.length,
          onSelect: () => update({ searchResult: undefined }) },
        ...([{ value: "candidates_found", label: "후보 있음" }, { value: "no_candidates", label: "후보 없음" }] as const)
          .map(option => ({ id: option.value, label: option.label, checked: route.filter.searchResult?.includes(option.value) ?? false,
            onSelect: () => update({ searchResult: [option.value] }) })),
      ]} />
      <ColumnVisibility columns={SESSION_COLUMNS.map(id => ({ id, label: COLUMN_LABEL[id] }))}
        hidden={SESSION_COLUMNS.filter(column => !columns.includes(column))} allowEmpty
        onReset={() => navigate({ ...route, columns: undefined })}
        onChange={hidden => navigate({ ...route, columns: SESSION_COLUMNS.filter(column => !hidden.includes(column)) })} />
      <TableDensity value={route.density ?? "compact"} comfortable onChange={value => {
        if (value === "compact" || value === "normal" || value === "comfortable") navigate({ ...route, density: value });
      }} />
    </TableToolbar></div>
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
