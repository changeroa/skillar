import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { TraceStep, SessionSkillReportDto } from "../../src/types.js";
import { api, ApiError, type SessionListRow } from "../api";
import { RequestDetails } from "../components/requests";
import { UnresolvedLoadNotice } from "../components/skill-evidence";
import { buildHash, type ViewProps } from "../state";
import { sessionBounds, traceCounts } from "./trace/model";
import { createTimelineKeys } from "./trace/plan";
import { Header } from "./trace/header";
import { NeverConsulted } from "./trace/timeline";
import { TRACE_CSS } from "./trace/styles";
import { SessionSummary } from "./trace/summary";
import { CompactTree } from "./trace/compact-tree";
import { traceConsoleStyles } from "./trace/console-style";
import { EventConsole } from "./trace/event-console";
export * from "./trace/model";
export * from "./trace/plan";

function NotFound({ sessionId, backHref, embedded }: { sessionId: string; backHref: string; readonly embedded: boolean }) {
  const Title = embedded ? "h2" : "h1";
  return (
    <section class="empty empty--trace">
      <Title class="trace__title">{sessionId}</Title>
      <h2>이 세션을 찾을 수 없습니다</h2>
      <h2>세션을 찾을 수 없습니다</h2>
      <p><code class="cmd">{sessionId}</code>에 기록된 이벤트가 없습니다. 보존 기간이 지나 삭제되었거나 오래된 링크일 수 있습니다.</p>
      <a class="btn" href={backHref}>세션으로 돌아가기</a>
    </section>
  );
}

const STYLE_ID = "skillar-trace-style";

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = TRACE_CSS;
  document.head.append(el);
}

export function TraceView({ route, navigate, live, embedded = false, presentation = "page" }: ViewProps & { readonly presentation?: "page" | "peek" }) {
  ensureStyles();
  traceConsoleStyles();
  const sessionId = route.sessionId ?? "";
  const timelineKeys = useMemo(() => createTimelineKeys(sessionId), [sessionId]);
  const backHref = buildHash({ ...route, view: "sessions", sessionId: undefined, event: undefined, peek: undefined });
  const [steps, setSteps] = useState<TraceStep[]>();
  const [row, setRow] = useState<SessionListRow>();
  const [report, setReport] = useState<SessionSkillReportDto>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const lastReport = useRef<SessionSkillReportDto | undefined>(undefined);

  useEffect(() => {
    setSteps(undefined);
    setRow(undefined);
    setReport(undefined);
    lastReport.current = undefined;
    setError(undefined);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    Promise.all([api.trace(sessionId), api.sessions({}),
      Promise.allSettled([api.skillReport(sessionId, { automated: "include" })])])
      .then(([trace, rows, skillReport]) => {
        if (cancelled) return;
        setSteps(trace);
        setRow(rows.find((r) => r.id === sessionId));
        const result = skillReport[0];
        switch (result.status) {
          case "fulfilled":
            lastReport.current = result.value;
            setReport(result.value);
            setError(undefined);
            break;
          case "rejected":
            if (lastReport.current !== undefined) setError("보고서를 새로 고치지 못했습니다. 마지막으로 확인한 보고서를 표시합니다.");
            else setError(undefined);
            break;
          default: { const exhaustive: never = result; return exhaustive; }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError && err.status === 403 ? "이 기록을 볼 권한이 없습니다" : "추적 기록을 불러오지 못했습니다");
      }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [sessionId, refresh]);

  useEffect(() => {
    if (live.seq === 0 || (live.last && live.last.id !== sessionId)) return;
    setRefresh((n) => n + 1);
  }, [live.seq, sessionId]);

  if (steps === undefined) {
    return (
      <section class="trace" aria-busy={busy}>
        <Header sessionId={sessionId} steps={[]} backHref={backHref} embedded={embedded} />
        {busy && <p role="status">추적 기록 불러오는 중…</p>}
        {error && <div class="notice" role="alert"><p>{error}</p><button type="button" class="btn"
          onClick={() => { setError(undefined); setRefresh(n => n + 1); }}>다시 시도</button></div>}
      </section>
    );
  }
  if (steps.length === 0 && !row) return <NotFound sessionId={sessionId} backHref={backHref} embedded={embedded} />;

  const bounds = sessionBounds(steps, row);
  const counts = traceCounts(steps);
  const source = timelineKeys(steps);
  if (presentation === "peek") return <section class="trace pe-console" aria-busy={busy}>
    <SessionSummary sessionId={sessionId} steps={steps} row={row} peek embedded backHref={backHref} />
    {error && <p role="alert">{error}<button class="pe-button" onClick={() => setRefresh(value => value + 1)}>다시 시도</button></p>}
    <CompactTree items={source} startedAt={bounds.startedAt} endedAt={bounds.endedAt} route={route} navigate={navigate} />
  </section>;
  return (
    <section class="trace trace-console pe-console" data-pe-screen="session-detail" aria-busy={busy}>
      {error && <p class="notice" role="alert">실시간 갱신 실패: {error} <button type="button" class="btn"
        onClick={() => { setError(undefined); setRefresh(n => n + 1); }}>다시 시도</button></p>}
      <SessionSummary sessionId={sessionId} row={row} steps={steps} backHref={backHref} embedded={embedded} peek={false} />
      {busy && <p role="status">추적 기록 불러오는 중…</p>}
      {report && <UnresolvedLoadNotice loads={report.unattributedLoads} />}
      {counts.searches === 0 && (report?.unattributedLoads.count ?? 0) === 0 && <NeverConsulted counts={counts} />}
      <EventConsole source={source} report={report} bounds={bounds} route={route} navigate={navigate} embedded={embedded} />
      <RequestDetails steps={steps} />
    </section>
  );
}
