import { useEffect, useState } from "react";
import type { Filter } from "../../../src/types.js";
import { REQUEST_STATUSES } from "../../../src/request-status.js";
import { FILTER_KEYS, STATE_LABEL, withoutFilterKey, type ViewProps } from "../../state";
import { Icon } from "../../components/icons";
import { kstPeriodStart } from "../../time";
import { Button } from "../../foundation/controls/buttons";
import { SearchInput } from "../../foundation/controls/fields";
import { TimePeriodSelect } from "../../foundation/controls/date-range";
import { DropdownMenu } from "../../foundation/overlays/menu";
import { TableDensity } from "../../foundation/table/controls";
import { TableToolbar } from "../../foundation/table/parts";

export function SessionToolbar({ route, navigate, count, facetsOpen, toggleFacets, sheet }: Pick<ViewProps, "route" | "navigate"> & {
  readonly count?: number; readonly facetsOpen: boolean; readonly toggleFacets: () => void; readonly sheet?: boolean;
}) {
  const [draft, setDraft] = useState(route.filter.q ?? "");
  useEffect(() => setDraft(route.filter.q ?? ""), [route.filter.q]);
  const update = (patch: Filter) => navigate({ ...route, peek: undefined, filter: { ...route.filter, ...patch } });
  return <>
    <div className="session-toolbar"><TableToolbar>
      <SearchInput id="session-search" label="요청문과 스킬 검색" value={draft} placeholder="요청문 · 스킬 · 세션 ID"
        onChange={setDraft} onSubmit={value => update({ q: value.trim() || undefined })} />
      <TimePeriodSelect label="기간" icon="calendar" value={route.filter.from === undefined && route.filter.to === undefined ? "all" : "custom"}
        options={[{ value: "all", label: "전체 기간" }, { value: "custom", label: "지정 기간", disabled: true },
          { value: "7", label: "최근 7일", badge: "7d" }, { value: "30", label: "최근 30일", badge: "30d" },
          { value: "60", label: "최근 60일", badge: "60d" }]}
        onChange={days => {
          const to = Date.now();
          update(days === "all" ? { from: undefined, to: undefined } : { from: kstPeriodStart(to, Number(days)), to });
        }} />
      <span className="session-toolbar__count">{count === undefined ? "집계 중" : `세션 ${count}개`}</span>
      <span className="session-facets-toggle"><Button text="필터" variant="outline"
        aria-controls={sheet ? "session-filter-sheet" : "session-facets"} aria-expanded={facetsOpen}
        aria-haspopup={sheet ? "dialog" : undefined} onClick={toggleFacets} /></span>
      <DropdownMenu id="session-request-state" label="요청 상태" width="wide" buttonIcon="funnel" items={[
        ...(["searchStatus", "loadStatus"] as const).flatMap(key => [
          { id: `${key}-all`, label: `${key === "searchStatus" ? "검색" : "읽기"} 상태 전체`,
            checked: !route.filter[key]?.length, separatorBefore: key === "loadStatus",
            onSelect: () => update({ [key]: undefined }) },
          ...REQUEST_STATUSES.map(value => ({ id: `${key}-${value}`,
            label: `${key === "searchStatus" ? "검색" : "읽기"} ${STATE_LABEL[value]}`,
            checked: route.filter[key]?.includes(value) ?? false, onSelect: () => update({ [key]: [value] }) })),
        ]),
        { id: "conversion-miss", label: "후보 있음·읽기 없음", separatorBefore: true,
          checked: route.filter.searchResult?.includes("candidates_found") === true && route.filter.loadStatus?.includes("not_attempted") === true,
          onSelect: () => update({ searchStatus: undefined, loadStatus: ["not_attempted"], searchResult: ["candidates_found"] }) },
      ]} />
      <TableDensity value={route.density ?? "compact"} comfortable onChange={value => {
        if (value === "compact" || value === "normal" || value === "comfortable") navigate({ ...route, density: value });
      }} />
    </TableToolbar></div>
    <div className="session-applied" role="group" aria-label="적용된 필터">
      {FILTER_KEYS.filter(key => route.filter[key] !== undefined && key !== "hourSpan").map(key => {
        const value = route.filter[key];
        const text = Array.isArray(value) ? value.join(", ") : String(value);
        return <button key={key} className="pe-button session-filter-pill" onClick={() => navigate({ ...route, peek: undefined, filter: withoutFilterKey(route.filter, key) })}
          aria-label={`${key} ${text} 필터 해제`}><code>{key}</code>{" "}<code>{text}</code><Icon name="close" /></button>;
      })}
      {FILTER_KEYS.some(key => route.filter[key] !== undefined) && <button className="pe-button" onClick={() => navigate({ ...route, peek: undefined, filter: {} })}>전체 해제</button>}
    </div>
  </>;
}
