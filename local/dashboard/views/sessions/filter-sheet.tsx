import { kstPeriodStart } from "../../time";
import { useState } from "preact/hooks";
import type { SessionListRow } from "../../api";
import { ConsoleSheet } from "../../components/console-sheet";
import type { ViewProps } from "../../state";
import { SessionFacets } from "./facets";

export function SessionFilterSheet({ route, navigate, rows, close }: Pick<ViewProps, "route" | "navigate"> & {
  readonly rows: readonly SessionListRow[]; readonly close: () => void;
}) {
  const [filter, setFilter] = useState(route.filter);
  return <ConsoleSheet id="session-filter-sheet" title="필터" close={close} actions={<>
    <button class="pe-button" onClick={() => setFilter({})}>초기화</button>
    <button class="pe-button" onClick={() => { navigate({ ...route, peek: undefined, filter }); close(); }}>세션 보기</button>
  </>}>
    <label class="session-sheet-period">기간
      <select class="pe-input" aria-label="필터 기간" value={filter.from === undefined && filter.to === undefined ? "all" : "custom"}
        onChange={event => {
          const value = event.currentTarget.value;
          if (value === "all") setFilter({ ...filter, from: undefined, to: undefined });
          else if (value !== "custom") {
            const to = Date.now();
            setFilter({ ...filter, from: kstPeriodStart(to, Number(value)), to });
          }
        }}>
        <option value="all">전체 기간</option><option value="7">최근 7일</option><option value="30">최근 30일</option>
        <option value="60">최근 60일</option><option value="custom" disabled>선택한 기간</option>
      </select>
    </label>
    <p class="pe-muted">기간을 바꾸면 적용 후 수를 다시 집계합니다.</p>
    <SessionFacets rows={rows} route={{ ...route, filter }} navigate={next => setFilter(next.filter)} />
  </ConsoleSheet>;
}
