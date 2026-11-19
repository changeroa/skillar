import type {ReactNode as ComponentChildren} from "react";
import { api, type SessionListRow } from "../../api";
import { OperationCounts } from "../../components/requests";
import { SortButton, TableRow } from "../../foundation/table/parts";
import { tableStyles } from "../../foundation/table/styles";
import { Badge, Tag } from "../../foundation/controls/labels";
import { RUNTIME_LABEL, SESSION_COLUMNS, buildHash, skillName,
  type SessionColumn, type SessionSort, type ViewProps } from "../../state";
import { COLUMN_LABEL, candidateSkills, readSkills } from "./model";

const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const sortable: Partial<Record<SessionColumn, SessionSort>> = { started: "started", runtime: "runtime", reads: "reads" };
function Skills({ values }: { readonly values: readonly string[] }) {
  return values.length ? <span className="session-table__skills">{values.map(uri => <Tag key={uri} text={skillName(uri)} />)}</span> : <>0</>;
}

// 호스팅 세션 화면(cloud 임베드)은 식별에 필요한 열만 남긴다(오너 피드백 ts 1795084225.603299:
// "너무 가로로 길어. 식별만 가능하게"). 요청문·검색 열은 상세에서 확인한다. 로컬 대시보드는 기존 열 구성 유지.
const HOSTED_SESSION_COLUMNS: readonly SessionColumn[] = ["started", "runtime", "reads"];

export function SessionTable({ rows, route, navigate }: Pick<ViewProps, "route" | "navigate"> & { readonly rows: readonly SessionListRow[] }) {
  tableStyles();
  const columns = api.mode === "cloud" ? HOSTED_SESSION_COLUMNS : SESSION_COLUMNS;
  const sort = route.sort ?? "-started";
  const select = (row: SessionListRow) => ({ ...route, view: "sessions" as const, peek: row.id, event: undefined });
  function cell(row: SessionListRow, column: SessionColumn): ComponentChildren {
    switch (column) {
      case "started": return <time dateTime={new Date(row.startedAt).toISOString()} title={new Date(row.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}>{date.format(row.startedAt)}</time>;
      case "runtime": return <Badge text={RUNTIME_LABEL[row.runtime]} color="ghost" mono={false} />;
      case "reads": return <Skills values={readSkills(row)} />;
      case "prompt": return <a className="rowlink" href={buildHash(select(row))} title={row.firstPrompt}><span>{row.firstPrompt ?? "(요청문 기록 없음)"}</span></a>;
      // 2차 declutter: 지워진 "후보" 열의 대표 후보 스킬 이름은 검색 열에 합친다.
      case "search": return <>
        <OperationCounts summary={row.requests?.search} />
        {candidateSkills(row).length > 0 && <span className="session-table__candidates"
          title="세션 요약에 기록된 대표 후보입니다. 전체 후보는 상세에서 확인하세요."><Skills values={candidateSkills(row)} /></span>}
      </>;
    }
  }
  return <div className="sessions__frame session-table-frame lf-table-surface" data-density={route.density ?? "compact"}>
    <table className="sessions session-table" data-density={route.density ?? "compact"}>
      <caption className="sr-only">세션 기록. 정렬은 수신된 범위에 적용됩니다.</caption>
      <thead><tr>{columns.map(column => {
        const field = sortable[column], active = sort.replace(/^-/, "") === field;
        return <th key={column} className={`cell-${column}`} scope="col" aria-sort={field ? active ? sort.startsWith("-") ? "descending" : "ascending" : "none" : undefined}>
          {field ? <SortButton label={COLUMN_LABEL[column]}
            direction={active ? sort.startsWith("-") ? "descending" : "ascending" : undefined}
            onSort={() => navigate({ ...route, sort: sort === field ? `-${field}` as SessionSort : field })} /> : COLUMN_LABEL[column]}
        </th>;
      })}</tr></thead>
      <tbody>{rows.map(row => <TableRow key={row.id} data-session-id={row.id} selected={route.peek === row.id}
        onOpen={() => navigate(select(row))}>
        {columns.map((column, index) => <td key={column} className={`cell-${column}`} data-label={COLUMN_LABEL[column]}>
          {index === 0 && !columns.includes("prompt")
            ? <a className="rowlink" href={buildHash(select(row))}>{cell(row, column)}</a> : cell(row, column)}
        </td>)}
      </TableRow>)}</tbody>
    </table>
  </div>;
}
