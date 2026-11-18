import type { SkillEntry } from "../../src/types.js";
import type { SessionListRow } from "../api";
import { RUNTIME_LABEL, buildHash, skillName, type ViewProps } from "../state";
import { OperationCounts } from "../components/requests";
import type { ObservedSession } from "./analysis-data";
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


