import type { ComponentChildren } from "preact";
import type { SessionListRow } from "../../api";
import { OperationCounts } from "../../components/requests";
import { SortButton, TableRow } from "../../foundation/table/parts";
import { tableStyles } from "../../foundation/table/styles";
import { Badge, Tag } from "../../foundation/controls/labels";
import { ATTRIBUTION_LABEL, RUNTIME_LABEL, SESSION_COLUMNS, STATE_LABEL, buildHash, skillName,
  type SessionColumn, type SessionSort, type ViewProps } from "../../state";
import { COLUMN_LABEL, candidateSkills, readSkills } from "./model";

const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
export const DEFAULT_COLUMNS: readonly SessionColumn[] = SESSION_COLUMNS.slice(0, 7);
const sortable: Partial<Record<SessionColumn, SessionSort>> = { started: "started", runtime: "runtime", state: "state", reads: "reads", duration: "duration" };
function Skills({ values }: { readonly values: readonly string[] }) {
  return values.length ? <span class="session-table__skills">{values.map(uri => <Tag key={uri} text={skillName(uri)} />)}</span> : <>0</>;
}

export function SessionTable({ rows, route, navigate }: Pick<ViewProps, "route" | "navigate"> & { readonly rows: readonly SessionListRow[] }) {
  tableStyles();
  const columns = route.columns ?? DEFAULT_COLUMNS;
  const sort = route.sort ?? "-started";
  const select = (row: SessionListRow) => ({ ...route, view: "sessions" as const, peek: row.id, event: undefined });
  function cell(row: SessionListRow, column: SessionColumn): ComponentChildren {
    switch (column) {
      case "started": return <time dateTime={new Date(row.startedAt).toISOString()} title={new Date(row.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}>{date.format(row.startedAt)}</time>;
      case "runtime": return <Badge text={RUNTIME_LABEL[row.runtime]} color="ghost" mono={false} />;
      case "state": return <Badge text={STATE_LABEL[row.state]} color="filledOnMuted" mono={false} />;
      case "reads": return <Skills values={readSkills(row)} />;
      case "candidates": return candidateSkills(row).length ? <span title="세션 요약에 기록된 대표 후보입니다. 전체 후보는 상세에서 확인하세요."><Skills values={candidateSkills(row)} /></span> : <span class="pe-muted" title="전체 후보는 세션 이벤트 상세에서 확인할 수 있습니다.">—</span>;
      case "duration": return row.endedAt === undefined ? <span class="pe-muted">종료 미기록</span> : `${Math.max(0, Math.round((row.endedAt - row.startedAt) / 60000))}분`;
      case "prompt": return <a class="rowlink" href={buildHash(select(row))} title={row.firstPrompt}><span>{row.firstPrompt ?? "(요청문 기록 없음)"}</span></a>;
      case "search": return <OperationCounts summary={row.requests?.search} />;
      case "load": return <OperationCounts summary={row.requests?.load} />;
      case "attribution": return ATTRIBUTION_LABEL[row.attribution] ?? row.attribution;
      case "id": return <a class="rowlink" href={buildHash(select(row))}><code>{row.id}</code></a>;
    }
  }
  return <div class="sessions__frame session-table-frame lf-table-surface" data-density={route.density ?? "compact"}>
    {columns.length === 0 ? <p role="status">열 메뉴에서 표시할 열을 선택하세요.</p> : <table class="sessions session-table"
      data-density={route.density ?? "compact"} data-custom-columns={route.columns !== undefined}>
      <caption class="sr-only">세션 기록. 정렬은 수신된 범위에 적용됩니다.</caption>
      <thead><tr>{columns.map(column => {
        const field = sortable[column], active = sort.replace(/^-/, "") === field;
        return <th key={column} class={`cell-${column}`} scope="col" aria-sort={field ? active ? sort.startsWith("-") ? "descending" : "ascending" : "none" : undefined}>
          {field ? <SortButton label={COLUMN_LABEL[column]}
            direction={active ? sort.startsWith("-") ? "descending" : "ascending" : undefined}
            onSort={() => navigate({ ...route, sort: sort === field ? `-${field}` as SessionSort : field })} /> : COLUMN_LABEL[column]}
        </th>;
      })}</tr></thead>
      <tbody>{rows.map(row => <TableRow key={row.id} data-session-id={row.id} selected={route.peek === row.id}
        onOpen={() => navigate(select(row))}>
        {columns.map((column, index) => <td key={column} class={`cell-${column}`} data-label={COLUMN_LABEL[column]}>
          {index === 0 && !columns.includes("prompt") && !columns.includes("id")
            ? <a class="rowlink" href={buildHash(select(row))}>{cell(row, column)}</a> : cell(row, column)}
        </td>)}
      </TableRow>)}</tbody>
    </table>}
  </div>;
}
