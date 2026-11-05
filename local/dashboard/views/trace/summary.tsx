import type { TraceStep } from "../../../src/types.js";
import { useState } from "preact/hooks";
import type { SessionListRow } from "../../api";
import { CopyButton } from "../../components/copy-button";
import { Icon } from "../../components/icons";
import { useNarrow } from "../../components/use-narrow";
import { ATTRIBUTION_LABEL, RUNTIME_LABEL, skillName } from "../../state";
import { firstPromptOf, formatCost, formatDuration, sessionBounds, traceCounts } from "./model";

const date = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export function summaryFacts(steps: readonly TraceStep[]) {
  const reads = [...new Set(steps.flatMap(step => step.kind === "load" && typeof step.detail.uri === "string" ? [step.detail.uri] : []))];
  const models = steps.filter(step => step.kind === "llm_call");
  const costs = models.flatMap(step => typeof step.detail.costUsd === "number" ? [step.detail.costUsd] : []);
  const unmeasuredSearches = steps.filter(step => step.kind === "search" && step.detail.elapsedMs === undefined).length;
  return { reads, modelCount: models.length, costCount: costs.length, cost: costs.reduce((sum, cost) => sum + cost, 0), unmeasuredSearches };
}

function FirstRequest({ prompt }: { readonly prompt: string }) {
  const narrow = useNarrow(), [open, setOpen] = useState(false);
  if (!narrow) return <details class="trace__prompt"><summary>첫 요청문 보기</summary><p class="tl__text">{prompt}</p></details>;
  return <div class="trace__prompt">
    <button class="foldbtn trace-first-request" aria-expanded={open} aria-controls="first-request-content" onClick={() => setOpen(value => !value)}>
      <Icon name="down" />{open ? "접기" : "첫 요청문 보기"}
    </button>
    <p id="first-request-content" class="tl__text" hidden={!open}>{prompt}</p>
  </div>;
}

export function SessionSummary({ sessionId, steps, row, peek, embedded, backHref }: {
  readonly sessionId: string; readonly steps: TraceStep[]; readonly row?: SessionListRow;
  readonly peek: boolean; readonly embedded: boolean; readonly backHref: string;
}) {
  const bounds = sessionBounds(steps, row), counts = traceCounts(steps), facts = summaryFacts(steps);
  const Title = embedded || peek ? "h2" : "h1";
  const prompt = firstPromptOf(steps, row);
  const duration = bounds.startedAt === undefined ? "미측정" : bounds.endedAt !== undefined
    ? formatDuration(bounds.endedAt - bounds.startedAt)
    : bounds.lastTs !== undefined ? `${formatDuration(bounds.lastTs - bounds.startedAt)} (종료 기록 없음)` : "종료 미기록";
  const line = [
    { id: "runtime", label: "실행 환경", hidden: true, value: <span class="pe-pill">{row ? RUNTIME_LABEL[row.runtime] : "미측정"}</span> },
    { id: "started", label: "시작", hidden: true, value: bounds.startedAt === undefined ? "미측정" : <time dateTime={new Date(bounds.startedAt).toISOString()}>{date.format(bounds.startedAt)}</time> },
    { id: "duration", label: "소요 시간", hidden: true, value: duration },
    { id: "reads", label: "읽은 스킬", value: `${facts.reads.length}개` },
    { id: "searches", label: "검색", value: <>{counts.searches}회{facts.unmeasuredSearches > 0 && <span> · 지연 시간 {facts.unmeasuredSearches}회 <span>측정 안 됨</span></span>}</> },
    { id: "errors", label: "오류", value: `${counts.errors}건` },
    { id: "models", label: "모델 기록", value: `${facts.modelCount}회` },
    { id: "cost", label: "비용", value: facts.costCount ? `${formatCost(facts.cost)} · ${facts.costCount}/${facts.modelCount} 측정` : "미측정" },
    { id: "outcome", label: "작업 성공", value: "미측정" },
  ];
  return <header class="trace-summary" data-component="session-summary">
    {!peek && <a class="trace__back" href={backHref}><Icon name="chevron" class="trace-back-icon" />세션 목록</a>}
    <div class="trace-summary__title"><Title class="trace__title"><code>{sessionId}</code></Title>{!peek && <CopyButton value={sessionId} />}</div>
    {prompt && <FirstRequest prompt={prompt} />}
    <dl class="trace-summary__line trace__meta" aria-label="세션 요약">
      {line.map(fact => <div key={fact.id} data-fact={fact.id}><dt class={fact.hidden ? "sr-only" : undefined}>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl>
    {facts.reads.length > 0 && <div class="trace-summary__reads">{facts.reads.map(uri => <span class="pe-pill" key={uri} title={uri}><code>{skillName(uri)}</code></span>)}</div>}
    {peek && <dl class="trace-summary__kv">
      <div><dt>시작</dt><dd>{bounds.startedAt === undefined ? "미측정" : date.format(bounds.startedAt)}</dd></div>
      <div><dt>길이</dt><dd>{duration}</dd></div>
      <div><dt>이벤트</dt><dd>{counts.steps}개</dd></div>
      <div><dt>읽기</dt><dd>{counts.loads}회</dd></div>
      <div><dt>세션 연결</dt><dd>{row ? ATTRIBUTION_LABEL[row.attribution] : "미측정"}</dd></div>
      <div><dt>모델 호출</dt><dd>{facts.modelCount}회 · 비용 {facts.costCount}/{facts.modelCount} 측정</dd></div>
    </dl>}
  </header>;
}
