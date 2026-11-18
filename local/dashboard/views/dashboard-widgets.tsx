import type { FlowDto, SkillEntry } from "../../src/types.js";
import type { SessionListRow } from "../api";
import { DOW_LABEL, RUNTIME_LABEL, buildHash, skillName, type ViewProps } from "../state";
import { buildGrid } from "../charts/heatmap";
import { Sankey } from "../charts/sankey";
import { OperationCounts } from "../components/requests";
import { sessionsHeatmap, type ObservedSession } from "./analysis-data";
import { readSkills, sortSessions } from "./sessions/model";

const recentDate = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

/** 최근 세션: J1의 첫 화면. 어떤 스킬(버전)을 읽었고 검색·읽기 요청이 어떻게 됐는지 한 행씩 보여 준다. */
export function DashboardRecentSessions({ rows, skills, traces, route }: {
  readonly rows: readonly SessionListRow[]; readonly skills: readonly SkillEntry[];
  readonly traces: readonly ObservedSession[]; readonly route: ViewProps["route"];
}) {
  const nameOf = (uri: string) => skills.find(skill => skill.uri === uri)?.name ?? skillName(uri);
  const digestsOf = (sessionId: string) => traces.find(result => result.session === sessionId)?.digests;
  const recent = sortSessions(rows, "-started").slice(0, 5);
  return <div className="analysis-scroll"><table className="analysis-table dashboard-recent">
    <caption>최근 세션 {recent.length}개 · 시작 최신순 · 한국 시간</caption>
    <thead><tr><th scope="col">시작</th><th scope="col">실행 환경</th><th scope="col">읽은 스킬</th><th scope="col">검색</th><th scope="col">읽기</th><th scope="col">첫 요청</th></tr></thead>
    <tbody>{recent.map(row => {
      const href = buildHash({ ...route, view: "sessions", peek: row.id, event: undefined });
      const digests = digestsOf(row.id);
      const reads = readSkills(row);
      return <tr key={row.id}>
        <td><a className="rowlink" href={href}><time dateTime={new Date(row.startedAt).toISOString()} title={new Date(row.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}>{recentDate.format(row.startedAt)}</time></a></td>
        <td>{RUNTIME_LABEL[row.runtime]}</td>
        <td>{reads.length ? reads.map(uri => {
          const digest = digests?.get(uri);
          return <a key={uri} className="rowlink" href={href} title={digest ? `${uri} · 버전 다이제스트 ${digest}` : uri}>{nameOf(uri)}{digest ? <code className="dashboard-recent__digest">@{digest.slice(0, 8)}</code> : null}</a>;
        }) : <span className="pe-muted">읽기 없음</span>}</td>
        <td><OperationCounts summary={row.requests?.search} /></td>
        <td><OperationCounts summary={row.requests?.load} /></td>
        <td className="dashboard-recent__prompt"><a className="rowlink" href={href} title={row.firstPrompt}>{row.firstPrompt ?? "(요청문 기록 없음)"}</a></td>
      </tr>;
    })}</tbody></table></div>;
}

export function DashboardActivity({ rows, tz }: { readonly rows: readonly SessionListRow[]; readonly tz: string }) {
  const grid = buildGrid(sessionsHeatmap(rows, tz, 1), { bucketHours: 4 });
  return <div className="analysis-scroll"><table className="dashboard-activity-grid">
    <caption>요일·시간대 활동 · 세션 시작 · {tz === "Asia/Seoul" ? "한국 시간" : tz} · 4시간</caption>
    <thead><tr><th scope="col">요일</th>{grid.hours.map(hour => <th scope="col" key={hour}>{hour}시</th>)}<th scope="col">합계</th></tr></thead>
    <tbody>{grid.rows.map((row, index) => <tr key={grid.dows[index]}><th scope="row">{DOW_LABEL[grid.dows[index]!]}</th>{row.map(cell =>
      <td key={cell.hour} data-level={cell.level} title={`${DOW_LABEL[cell.dow]}요일 ${cell.hour}시부터 4시간 · ${cell.count}세션`}>{cell.count}</td>)}<td>{grid.rowTotals[index]}</td></tr>)}</tbody>
  </table><p className="pe-muted">0 · 적음 → 많음 · 최댓값 {grid.maxCount} · 전체 {grid.total}세션</p></div>;
}

export function DashboardFlow({ dto, skills }: { readonly dto: FlowDto; readonly skills: readonly SkillEntry[] }) {
  const preview = { ...dto, nodes: dto.nodes.map(node => node.column !== 1 || node.other ? node : {
    ...node, label: skills.find(skill => `s:${skill.uri}` === node.id)?.name ?? skillName(node.label),
  }) };
  return <>{(dto.requestCount ?? dto.sessionCount) > 0
    ? <div role="img" aria-label={`${dto.requestCount === undefined ? `세션 ${dto.sessionCount}개의 작업 유형·스킬·결과 흐름. 검색 요청 수는 미측정입니다.` : `검색 요청 ${dto.requestCount}건의 작업 유형·스킬·결과 흐름.`} 상세 화면에서 경로와 상태를 확인할 수 있습니다.`}><div inert aria-hidden="true"><Sankey dto={preview} hrefFor={() => undefined} onActivate={() => undefined} /></div></div>
    : <p>이 기간에 검색 요청이 없습니다.</p>}
    <p className="pe-muted">검색 요청 {dto.requestCount === undefined ? "미측정 · 세션 단위 원본" : `${dto.requestCount}건`} · 요청의 상태이며 작업 성공률이 아닙니다. 상세 화면에서 탐색합니다.</p></>;
}
