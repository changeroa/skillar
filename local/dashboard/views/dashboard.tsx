import { api } from "../api";
import { buildHash, serializeFilter, skillName, type ViewProps } from "../state";
import { summarizeRequests } from "../../src/request-status.js";
import { AnalysisEmpty, AnalysisError, AnalysisToolbar, AnalysisWidget, Metric, conditions, useAnalysisReport } from "../components/analysis";
import { observedRequests, requestsInRange } from "./analysis-data";
import { StatusMessage } from "../foundation/widgets/messages";
import { DAY_MS, kstWeekStart } from "../time";

const WEEK_LABELS = ["3주 전", "2주 전", "지난주", "이번 주"] as const;

/**
 * 스킬 화면(구 대시보드): 가치 1번의 "버전 승격 판단"은 세션 하나가 아니라 스킬 단위로 모아 봐야 한다.
 * KPI는 세션·검색 요청·읽기 요청 세 개만 남기고, "많이 읽힌 스킬" 표가 화면의 주인공이다.
 * 표는 버전 다이제스트·검색 후보 수·읽기 수·최근 4주 읽기·읽은 세션 링크를 함께 보여 준다
 * (흐름의 경로 수와 활동의 주별 읽기를 흡수한 열이다).
 */
export function DashboardView({ route, live, embedded, navigate }: ViewProps) {
  const report = useAnalysisReport(serializeFilter(route.filter), async () => {
    const [rows, skills] = await Promise.all([api.sessions(route.filter), api.skills()]);
    const traces = await observedRequests(rows);
    return { rows, skills, traces, filter: route.filter };
  }, embedded || api.mode === "cloud" ? live.seq : 0);
  const data = report.snapshot?.value;
  const requestsMeasured = (data?.traces.results.length ?? 0) > 0;
  const records = data ? data.traces.results.flatMap(result =>
    requestsInRange(result.requests, data.filter).map(record => ({ ...record, session: result.session }))) : [];
  const summary = summarizeRequests(records);

  // 스킬별 집계: 읽기 수·검색 후보 수·읽은 세션 수·버전 다이제스트·최근 4주 읽기.
  const reads = new Map<string, number>();
  const readSessions = new Map<string, Set<string>>();
  const candidates = new Map<string, number>();
  const digests = new Map<string, string>();
  const weekly = new Map<string, number[]>();
  if (data) {
    const thisWeek = kstWeekStart(Date.now());
    for (const result of data.traces.results) {
      for (const [uri, count] of result.candidates) candidates.set(uri, (candidates.get(uri) ?? 0) + count);
      for (const [uri, digest] of result.digests) digests.set(uri, digest);
    }
    for (const record of records) {
      if (record.operation !== "load" || record.status !== "succeeded" || !record.uri) continue;
      reads.set(record.uri, (reads.get(record.uri) ?? 0) + 1);
      let sessions = readSessions.get(record.uri);
      if (!sessions) readSessions.set(record.uri, sessions = new Set());
      sessions.add(record.session);
      const ts = record.startedAt ?? record.endedAt;
      if (ts !== undefined) {
        const age = Math.round((thisWeek - kstWeekStart(ts)) / (7 * DAY_MS));
        if (age >= 0 && age < 4) {
          const counts = weekly.get(record.uri) ?? [0, 0, 0, 0];
          counts[3 - age] += 1;
          weekly.set(record.uri, counts);
        }
      }
    }
  }
  const weekMax = Math.max(1, ...[...weekly.values()].flat());
  const nameOf = (uri: string) => data?.skills.find(skill => skill.uri === uri)?.name ?? skillName(uri);
  const sort = route.analysisSort ?? "-reads";
  const top = [...reads.keys()].map(uri => ({ uri, name: nameOf(uri), count: reads.get(uri) ?? 0 }))
    .sort((a, b) => (sort.replace(/^-/, "") === "name" ? a.name.localeCompare(b.name, "ko") : a.count - b.count) * (sort.startsWith("-") ? -1 : 1));
  const order = (key: string, label: string) => <th scope="col" aria-sort={sort.replace(/^-/, "") === key ? sort.startsWith("-") ? "descending" : "ascending" : "none"}>
    <button onClick={() => navigate({ ...route, analysisSort: sort === key ? `-${key}` : key })}>{label} {sort.replace(/^-/, "") === key ? sort.startsWith("-") ? "↓" : "↑" : "↕"}</button></th>;
  return <section className="analysis pe-console" data-analysis-dashboard aria-busy={report.busy}>
    <header className="page-title">{embedded ? <h2>스킬</h2> : <h1>스킬</h1>}</header>
    <AnalysisToolbar route={route} navigate={navigate} />
    {report.busy && <StatusMessage level="DEFAULT" announce message={data ? `갱신 중: ${conditions(route.filter)}` : "세션 활동 집계 중…"} />}
    <AnalysisError error={report.error} title="세션 활동을 불러올 수 없습니다" retry={report.refresh} />
    {data && <>{data.rows.length === 0 ? <AnalysisEmpty route={route} navigate={navigate} /> : <>
        <div className="analysis-tiles">
          <Metric label="세션" value={data.rows.length} />
          <Metric label="검색 요청" value={requestsMeasured ? summary.search.total : null}>{!requestsMeasured && "추적 조회 실패로 요청 수를 확인할 수 없습니다."}</Metric>
          <Metric label="읽기 요청" value={requestsMeasured ? summary.load.total : null}>{!requestsMeasured && "추적 조회 실패로 읽기 수를 확인할 수 없습니다."}</Metric>
        </div>
        <AnalysisWidget title="많이 읽힌 스킬" id="top-skills" wide>
          <div className="analysis-scroll"><table className="analysis-table"><thead><tr>
            {order("name", "스킬")}<th scope="col">버전</th><th scope="col">검색 후보</th>{order("reads", "읽기")}
            <th scope="col">최근 4주 읽기</th><th scope="col">읽은 세션</th>
          </tr></thead>
            <tbody>{top.map(row => {
              const digest = digests.get(row.uri);
              const weeks = weekly.get(row.uri) ?? [0, 0, 0, 0];
              const sessions = readSessions.get(row.uri)?.size ?? 0;
              const href = buildHash({ view: "sessions", filter: { ...data.filter, skill: [row.uri], loadStatus: ["succeeded"] } });
              return <tr key={row.uri}>
                <td><a href={href} title={row.uri}>{row.name}</a></td>
                <td>{digest ? <code title={`버전 다이제스트 ${digest}`}>@{digest.replace(/^sha256:/, "").slice(0, 8)}</code> : <span className="pe-muted">—</span>}</td>
                <td className="num">{candidates.get(row.uri) ?? 0}</td>
                <td className="num">{row.count}</td>
                <td><span className="skill-weeks" role="img"
                  aria-label={`최근 4주 읽기: ${weeks.map((count, index) => `${WEEK_LABELS[index]} ${count}`).join(", ")}`}>
                  {weeks.map((count, index) => <span key={index} className="skill-weeks__bar" data-count={count}
                    style={{ height: `${count ? Math.max(3, Math.round(count / weekMax * 14)) : 2}px` }}
                    title={`${WEEK_LABELS[index]} ${count}회`} />)}
                </span></td>
                <td className="num"><a href={href} title={`${row.name}을(를) 읽은 세션`}>{sessions}</a></td>
              </tr>;
            })}</tbody></table></div>
          {!top.length && <p>{requestsMeasured ? "읽은 스킬이 없습니다." : "읽은 스킬 미측정 · 추적 조회 실패"}</p>}
        </AnalysisWidget>
      </>}
    </>}
  </section>;
}
