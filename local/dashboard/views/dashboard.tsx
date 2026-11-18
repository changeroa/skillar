import { api } from "../api";
import { buildHash, serializeFilter, skillName, type ViewProps } from "../state";
import { summarizeRequests } from "../../src/request-status.js";
import { AnalysisEmpty, AnalysisError, AnalysisToolbar, AnalysisWidget, Metric, conditions, useAnalysisReport } from "../components/analysis";
import { Bars } from "../charts/bars";
import { durationDistribution, observedRequests, requestSeries, requestsInRange } from "./analysis-data";
import { DashboardRecentSessions } from "./dashboard-widgets";
import { StatusMessage } from "../foundation/widgets/messages";

export function DashboardView({ route, live, embedded, navigate }: ViewProps) {
  const report = useAnalysisReport(serializeFilter(route.filter), async () => {
    const [rows, skills] = await Promise.all([api.sessions(route.filter), api.skills()]);
    const traces = await observedRequests(rows);
    return { rows, skills, traces, filter: route.filter };
  }, embedded || api.mode === "cloud" ? live.seq : 0);
  const data = report.snapshot?.value;
  const requestsMeasured = (data?.traces.results.length ?? 0) > 0;
  const records = data ? requestsInRange(data.traces.results.flatMap(result => result.requests), data.filter) : [];
  const summary = summarizeRequests(records);
  const conversion = (data?.traces.results ?? []).reduce((total, result) => ({ searches: total.searches + result.conversion.searches, converted: total.converted + result.conversion.converted }), { searches: 0, converted: 0 });
  const durations = durationDistribution(data?.rows ?? []);
  const average = durations.values.length ? durations.values.reduce((sum, value) => sum + value, 0) / durations.values.length / 60000 : undefined;
  const reads = new Map<string, number>();
  for (const record of records) if (record.operation === "load" && record.status === "succeeded" && record.uri) reads.set(record.uri, (reads.get(record.uri) ?? 0) + 1);
  const sort = route.analysisSort ?? "-reads";
  const top = [...reads].map(([uri, count]) => ({ uri, count, name: data?.skills.find(skill => skill.uri === uri)?.name ?? skillName(uri) }))
    .sort((a, b) => (sort.replace(/^-/, "") === "name" ? a.name.localeCompare(b.name, "ko") : a.count - b.count) * (sort.startsWith("-") ? -1 : 1));
  const order = (key: string, label: string) => <th scope="col" aria-sort={sort.replace(/^-/, "") === key ? sort.startsWith("-") ? "descending" : "ascending" : "none"}>
    <button onClick={() => navigate({ ...route, analysisSort: sort === key ? `-${key}` : key })}>{label} {sort.replace(/^-/, "") === key ? sort.startsWith("-") ? "↓" : "↑" : "↕"}</button></th>;
  return <section className="analysis pe-console" data-analysis-dashboard aria-busy={report.busy}>
    <header className="page-title">{embedded ? <h2>대시보드</h2> : <h1>대시보드</h1>}</header>
    <AnalysisToolbar route={route} navigate={navigate} refresh={report.refresh} busy={report.busy} />
    {report.busy && <StatusMessage level="DEFAULT" announce message={data ? `갱신 중: ${conditions(route.filter)}` : "세션 활동 집계 중…"} />}
    <AnalysisError error={report.error} title="세션 활동을 불러올 수 없습니다" retry={report.refresh} />
    {data && <>{data.rows.length === 0 ? <AnalysisEmpty route={route} navigate={navigate} /> : <>
        <AnalysisWidget title="최근 세션" id="recent-sessions" wide>
          <DashboardRecentSessions rows={data.rows} skills={data.skills} traces={data.traces.results} route={route} />
        </AnalysisWidget>
        <div className="analysis-tiles">
          <Metric label="세션" value={data.rows.length}>세션 시작 기준 · 수신 범위</Metric>
          <Metric label="검색 요청" value={requestsMeasured ? summary.search.total : null}>{requestsMeasured ? <>후보 있음 {summary.search.results.candidates_found} · 후보 없음 {summary.search.results.no_candidates}<br />조회한 세션 추적 기준</> : "추적 조회 실패로 요청 수를 확인할 수 없습니다."}</Metric>
          <Metric label="읽기 요청" value={requestsMeasured ? summary.load.total : null}>{requestsMeasured ? <>성공 {summary.load.counts.succeeded} · 고유 읽은 스킬 {reads.size}<br />후보와 자료 읽기 제외</> : "추적 조회 실패로 읽기 수를 확인할 수 없습니다."}</Metric>
          <Metric label="후보→읽기 전환" value={requestsMeasured && conversion.searches ? conversion.converted : null} suffix={conversion.searches ? `/${conversion.searches}` : undefined}>{requestsMeasured ? (conversion.searches ? null : "후보를 표시한 검색이 관찰되지 않았습니다.") : "추적 조회 실패로 전환을 확인할 수 없습니다."}</Metric>
          <Metric label="평균 세션 길이" value={average === undefined ? null : Math.round(average * 10) / 10} suffix="분">종료 기록 {durations.values.length}세션 · 미종료 {data.rows.length - durations.values.length} 제외</Metric>
        </div>
        <div className="analysis-widgets">
          <AnalysisWidget title="읽기·검색 요청" id="requests" wide>
            {records.length ? <Bars title="일별 요청 · 한국 시간" groups={requestSeries(records, data.filter)} labels={["검색 요청", "읽기 요청"]} /> : <p>{requestsMeasured ? "조회한 추적에 요청 기록이 없습니다." : "요청 기록 미측정 · 추적을 불러올 수 없습니다."}</p>}
          </AnalysisWidget>
          <AnalysisWidget title="많이 읽힌 스킬" id="top-skills">
            <table className="analysis-table"><thead><tr>{order("name", "스킬")}{order("reads", "읽기")}</tr></thead>
              <tbody>{top.slice(0, 5).map(row => <tr key={row.uri}><td><a href={buildHash({ view: "sessions", filter: { ...data.filter, skill: [row.uri], loadStatus: ["succeeded"] } })} title={row.uri}>{row.name}</a></td><td className="num">{row.count}</td></tr>)}</tbody></table>
            {!top.length && <p>{requestsMeasured ? "읽은 스킬이 없습니다." : "읽은 스킬 미측정 · 추적 조회 실패"}</p>}
          </AnalysisWidget>
        </div>
      </>}
    </>}
  </section>;
}
