import { useEffect, useState } from "preact/hooks";
import type { FlowReportDto } from "../../../src/types.js";
import { api } from "../../api";
import { Facts } from "../../components/facts";
import { UnresolvedLoadNotice } from "../../components/skill-evidence";
import type { WorkflowSpec } from "../../../src/workflow/spec.js";
import { buildHash, type ViewProps } from "../../state";

import { Tree } from "./tree";
import { Steps } from "./steps";
import { formatStarted, specLabel, summaryFacts, flowSummary, flowsQuery, reportIndex, sessionInWindow, dateTimeFmt, workspaceFilter } from "./model";
import { AnalysisError, conditions } from "../../components/analysis";
import { StatusMessage } from "../../foundation/widgets/messages";
const LIVE_REFRESH_DEBOUNCE_MS = 300;
export function Header({ report, backHref, onRefresh, busy, embedded = false }: { report: FlowReportDto; backHref: string; onRefresh: () => void; busy: boolean; readonly embedded?: boolean }) {
  const Title = embedded ? "h2" : "h1";
  const panes = report.tree.tabs.reduce((n, tab) => n + tab.panes.length, 0);
  const history = report.tree.tabs.some((tab) => tab.panes.some((pane) => pane.sessions.some((link) =>
    link.session !== null && !sessionInWindow(link.session, report.flow))));
  return (
    <header class="ws__head card">
      <a class="ws__back" href={backHref}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        작업 공간 목록
      </a>
      <Title class="ws__title">{report.label ?? report.workspaceId}</Title>
      <dl class="ws__meta">
        {report.kind !== "outside_herdr" && <>
        <div>
          <dt>작업 공간</dt>
          <dd class="ws__id">{report.workspaceId}</dd>
        </div>
        <div>
          <dt>스펙</dt>
          <dd class={report.spec ? undefined : "dim"}>{specLabel(report.spec)}</dd>
        </div>
        <div>
          <dt>시작</dt>
          <dd>{formatStarted(report.flow?.registeredMs ?? null)}</dd>
        </div>
        <div>
          <dt>종료</dt>
          <dd class={report.flow?.endedMs != null ? undefined : "dim"}>{report.flow?.endedMs != null ? formatStarted(report.flow.endedMs) : "상태 미상"}</dd>
        </div>
        <div>
          <dt>패널</dt>
          <dd>{panes}</dd>
        </div>
        </>}
        <div>
          <dt>세션</dt>
          <dd>{report.usage.sessions.length}</dd>
        </div>
      </dl>
      <Facts facts={summaryFacts(flowSummary(report))} className="facts ws__counts" />
      {history && <p class="dim" data-pane-history="true">대화 차례와 세션 수에는 패널 기록이 포함됩니다. 단계 결과와 고유 호출 비용은 이 워크플로의 실행 구간만 집계하며, 구간 밖 세션은 아래에 따로 표시됩니다.</p>}
      <div class="ws__actions">
        <span class="dim">{dateTimeFmt.format(report.generatedAt)} 기준</span>
        <button type="button" class="btn" onClick={onRefresh} disabled={busy}>{busy ? "읽는 중\u2026" : "새로 고침"}</button>
      </div>
      {report.excludedSessions.length > 0 && (
        <p class="dim" data-excluded={report.excludedSessions.length}>
          자동화된 세션 {report.excludedSessions.length}개 제외됨
          ({[...new Set(report.excludedSessions.map((session) => session.reason))].join(", ")}). 자동화된 세션을 표시하도록 설정하면 포함됩니다.
        </p>
      )}
    </header>
  );
}

export function WorkspaceView({ route, live, embedded = false, peek = false }: ViewProps & { readonly peek?: boolean }) {
  const flowId = route.flowId ?? "";
  const backHref = buildHash({ view: "workspaces", filter: route.filter });
  const query = flowsQuery(route);
  const queryKey = JSON.stringify(query);
  const [report, setReport] = useState<FlowReportDto>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [specSteps, setSpecSteps] = useState<WorkflowSpec["steps"]>([]);
  const [specError, setSpecError] = useState<string>();
  const [resultQuery, setResultQuery] = useState(query);

  useEffect(() => {
    if (!embedded && api.mode !== "cloud" || live.seq === 0) return;
    const timer = setTimeout(() => setRefresh((n) => n + 1), LIVE_REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [embedded, live.seq]);

  useEffect(() => {
    setReport(undefined);
    setError(undefined);
    setSpecSteps([]);
    setSpecError(undefined);
  }, [flowId]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    api.flowReport(flowId, query)
      .then((dto) => {
        if (cancelled) return;
        setReport(dto);
        setResultQuery(query);
        setError(undefined);
        setBusy(false);
        if (dto.spec) {
          const spec = dto.spec;
          api.workflowVersions(spec.name).then((versions) => {
            if (cancelled) return;
            const version = versions.find((item) => item.version === spec.version);
            if (version) {
              setSpecSteps(version.steps);
              setSpecError(undefined);
            }
            else setSpecError("등록된 스펙 버전이 응답에 없습니다");
          }).catch((err: unknown) => {
            if (!cancelled) setSpecError(err instanceof Error ? err.message : String(err));
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      });
    return () => { cancelled = true; };
  }, [flowId, queryKey, refresh]);

  if (error !== undefined && report === undefined) {
    return (
      <section class="ws analysis pe-console">
        <header class="page-title">{embedded || peek ? <h2>작업 공간</h2> : <h1>작업 공간</h1>}</header>
        <AnalysisError error={error} title="이 워크플로를 불러올 수 없습니다" retry={() => setRefresh(n => n + 1)} />
        <a class="btn ws__backbtn" href={backHref}>작업 공간 목록으로</a>
      </section>
    );
  }
  if (report === undefined) return <section class="ws analysis pe-console" aria-busy="true"><header class="page-title">{embedded || peek ? <h2>작업 공간</h2> : <h1>작업 공간</h1>}</header><StatusMessage level="DEFAULT" announce message="작업 공간 보고서 읽는 중…" /></section>;

  const { findings, usageBySpan } = reportIndex(report);
  return (
    <section class="ws analysis pe-console" aria-busy={busy}>
      {busy && <StatusMessage level="DEFAULT" announce message={`갱신 중: ${conditions(workspaceFilter(query))}`} />}
      <p class="analysis-scope" data-result-conditions>{conditions(workspaceFilter(resultQuery))}</p>
      <Header report={report} backHref={backHref} onRefresh={() => setRefresh((n) => n + 1)} busy={busy} embedded={embedded || peek} />
      <AnalysisError error={error} title="이 워크플로를 새로 고칠 수 없습니다" retry={() => setRefresh(n => n + 1)} />
      {report.executionScope && <aside class="callout" role="note" data-execution-boundary={report.executionScope.boundary}>{report.executionScope.label}</aside>}
      <UnresolvedLoadNotice loads={report.unattributedLoads} />
      {report.comparison && <Steps comparison={report.comparison} specSteps={specSteps} specError={specError} uncertain={report.unattributedLoads.count > 0} />}
      <Tree tree={report.tree} route={route} findings={findings} usageBySpan={usageBySpan} filtered={report.excludedSessions.length > 0} flow={report.flow} />
    </section>
  );
}
