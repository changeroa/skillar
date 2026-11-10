import { api } from "../api";
import { buildHash, serializeFilter, skillName, type ViewProps } from "../state";
import { summarizeRequests } from "../../src/request-status.js";
import { AnalysisEmpty, AnalysisError, AnalysisToolbar, AnalysisWidget, Metric, conditions, useAnalysisReport } from "../components/analysis";
import { Bars } from "../charts/bars";
import { durationDistribution, observedRequests, requestSeries, requestsInRange } from "./analysis-data";
import { DashboardActivity, DashboardFlow } from "./dashboard-widgets";

export function DashboardView({ route, live, embedded, navigate }: ViewProps) {
  const report = useAnalysisReport(serializeFilter(route.filter), async () => {
    const [rows, stats, skills, flow] = await Promise.all([api.sessions(route.filter), api.stats(route.filter), api.skills(), api.flow(route.filter, { unit: "search_requests", top: 5 })]);
    const traces = await observedRequests(rows);
    return { rows, stats, skills, flow, traces, filter: route.filter };
  }, embedded || api.mode === "cloud" ? live.seq : 0);
  const data = report.snapshot?.value;
  const requestsMeasured = (data?.traces.results.length ?? 0) > 0;
  const records = data ? requestsInRange(data.traces.results.flatMap(result => result.requests), data.filter) : [];
  const summary = summarizeRequests(records);
  const durations = durationDistribution(data?.rows ?? []);
  const average = durations.values.length ? durations.values.reduce((sum, value) => sum + value, 0) / durations.values.length / 60000 : undefined;
  const reads = new Map<string, number>();
  for (const record of records) if (record.operation === "load" && record.status === "succeeded" && record.uri) reads.set(record.uri, (reads.get(record.uri) ?? 0) + 1);
  const sort = route.analysisSort ?? "-reads";
  const top = [...reads].map(([uri, count]) => ({ uri, count, name: data?.skills.find(skill => skill.uri === uri)?.name ?? skillName(uri) }))
    .sort((a, b) => (sort.replace(/^-/, "") === "name" ? a.name.localeCompare(b.name, "ko") : a.count - b.count) * (sort.startsWith("-") ? -1 : 1));
  const order = (key: string, label: string) => <th scope="col" aria-sort={sort.replace(/^-/, "") === key ? sort.startsWith("-") ? "descending" : "ascending" : "none"}>
    <button onClick={() => navigate({ ...route, analysisSort: sort === key ? `-${key}` : key })}>{label} {sort.replace(/^-/, "") === key ? sort.startsWith("-") ? "↓" : "↑" : "↕"}</button></th>;
  const coverage = data ? `추적 있는 세션 ${data.traces.results.filter(result => result.events > 0).length}/${data.rows.length}개 · 조회 실패 ${data.traces.failed.length}개` : "";
  const outcomes = [
    ["후보 있음", summary.search.results.candidates_found], ["후보 없음", summary.search.results.no_candidates],
    ["실패", summary.search.counts.failed], ["취소", summary.search.counts.cancelled], ["알 수 없음", summary.search.counts.unknown],
    ["진행 중", summary.search.counts.in_progress],
    ["결과 미상 성공", summary.search.counts.succeeded - summary.search.results.candidates_found - summary.search.results.no_candidates],
  ] as const;
  return <section class="analysis pe-console" data-analysis-dashboard aria-busy={report.busy}>
    <header class="page-title">{embedded ? <h2>대시보드</h2> : <h1>대시보드</h1>}<p>이 기기의 세션·검색·읽기 요약</p></header>
    <AnalysisToolbar route={route} navigate={navigate} refresh={report.refresh} busy={report.busy} />
    {report.busy && <p role="status">{data ? `갱신 중: ${conditions(route.filter)}` : "세션 활동 집계 중…"}</p>}
    <AnalysisError error={report.error} title="세션 활동을 불러올 수 없습니다" retry={report.refresh} />
    {data && <><p class="analysis-scope" data-result-conditions>{api.mode === "fixtures" ? "예시 데이터 · " : ""}{conditions(data.filter)} · {coverage}</p>
      {data.rows.length === 0 ? <AnalysisEmpty route={route} navigate={navigate} /> : <>
        <div class="analysis-tiles">
          <Metric label="세션" value={data.rows.length}>세션 시작 기준 · 수신 범위</Metric>
          <Metric label="검색 요청" value={requestsMeasured ? summary.search.total : null}>{requestsMeasured ? <>후보 있음 {summary.search.results.candidates_found} · 후보 없음 {summary.search.results.no_candidates}<br />조회한 세션 추적 기준</> : "추적 조회 실패로 요청 수를 확인할 수 없습니다."}</Metric>
          <Metric label="읽기 요청" value={requestsMeasured ? summary.load.total : null}>{requestsMeasured ? <>성공 {summary.load.counts.succeeded} · 고유 읽은 스킬 {reads.size}<br />후보와 자료 읽기 제외</> : "추적 조회 실패로 읽기 수를 확인할 수 없습니다."}</Metric>
          <Metric label="평균 세션 길이" value={average === undefined ? null : Math.round(average * 10) / 10} suffix="분">종료 기록 {durations.values.length}세션 · 미종료 {data.rows.length - durations.values.length} 제외</Metric>
        </div>
        <div class="analysis-widgets">
          <AnalysisWidget title="읽기·검색 요청" id="requests" wide>
            {records.length ? <Bars title="일별 요청 · 한국 시간" groups={requestSeries(records, data.filter)} labels={["검색 요청", "읽기 요청"]} /> : <p>{requestsMeasured ? "조회한 추적에 요청 기록이 없습니다." : "요청 기록 미측정 · 추적을 불러올 수 없습니다."}</p>}
            <p class="pe-muted">한국 시간 · 요청 시작(없으면 종료) 시각 · {coverage} · 자료 읽기는 별도</p>
          </AnalysisWidget>
          <AnalysisWidget title="많이 읽힌 스킬" id="top-skills">
            <table class="analysis-table"><thead><tr>{order("name", "스킬")}{order("reads", "읽기")}</tr></thead>
              <tbody>{top.slice(0, 5).map(row => <tr key={row.uri}><td><a href={buildHash({ view: "sessions", filter: { ...data.filter, skill: [row.uri], loadStatus: ["succeeded"] } })} title={row.uri}>{row.name}</a></td><td class="num">{row.count}</td></tr>)}</tbody></table>
            {!top.length && <p>{requestsMeasured ? "읽은 스킬이 없습니다." : "읽은 스킬 미측정 · 추적 조회 실패"}</p>}<p class="pe-muted">성공한 읽기 요청 · 상위 5개 · {coverage}</p>
          </AnalysisWidget>
          <AnalysisWidget title="검색 결과 비율" id="outcomes">
            <table class="analysis-table"><thead><tr><th scope="col">요청 결과</th><th scope="col">건수</th><th scope="col">비율</th></tr></thead>
              <tbody>{outcomes.map(([label, count]) => <tr key={label}><td>{label}</td><td class="num">{requestsMeasured ? count : "미측정"}</td><td class="num">{!requestsMeasured ? "미측정" : summary.search.total ? `${(count / summary.search.total * 100).toFixed(0)}%` : "—"}</td></tr>)}</tbody></table>
            <p class="pe-muted">분모: 검색 요청 {requestsMeasured ? `${summary.search.total}건` : "미측정"} · 후보 있음은 읽음이나 작업 성공이 아닙니다.</p>
          </AnalysisWidget>
          <AnalysisWidget title="세션 길이 분포" id="duration">
            <Bars title="종료된 세션 · 분 단위" groups={durations.groups} labels={["세션"]} />
            <p class="pe-muted">종료−시작 · 종료 기록 {durations.values.length}세션 · 미종료는 0분이 아닙니다.</p>
          </AnalysisWidget>
          <AnalysisWidget title="읽기 지연" id="latency"><div class="analysis-unmeasured"><strong>미측정</strong><p>읽기 시작·종료 측정의 검증된 표본이 없습니다. 검색 지연을 읽기 지연으로 대체하지 않습니다.</p></div>
            <h2>스킬 구간</h2><p class="pe-muted">미측정 · 활성 구간은 읽기 수행 시간이나 후속 작업의 인과 효과가 아닙니다.</p>
          </AnalysisWidget>
          <AnalysisWidget title="요일·시간대 활동" id="activity" wide><DashboardActivity rows={data.rows} tz="Asia/Seoul" />
            <a class="pe-button" href={buildHash({ view: "heatmap", filter: data.filter })}>활동 전체 보기</a>
          </AnalysisWidget>
          <AnalysisWidget title="흐름" id="flow"><DashboardFlow dto={data.flow} skills={data.skills} />
            <p class="pe-muted">세션에 연결되지 않은 검색 {data.stats.unattributed?.searches ?? "미측정"} · 읽기 {data.stats.unattributed?.loads ?? "미측정"} · 별도 범위</p>
            <a class="pe-button" href={buildHash({ view: "flow", filter: data.filter })}>흐름 전체 보기</a>
          </AnalysisWidget>
        </div>
      </>}
    </>}
  </section>;
}
