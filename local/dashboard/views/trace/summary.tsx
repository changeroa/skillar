import type { TraceStep } from "../../../src/types.js";
import { useState } from "react";
import type { SessionListRow } from "../../api";
import { CopyButton } from "../../components/copy-button";
import { Icon } from "../../components/icons";
import { useNarrow } from "../../components/use-narrow";
import { ATTRIBUTION_LABEL, RUNTIME_LABEL, skillName } from "../../state";
import { firstPromptOf, formatCost, formatDuration, sessionBounds, traceCounts } from "./model";

const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export function summaryFacts(steps: readonly TraceStep[]) {
  const reads = [...new Set(steps.flatMap(step => step.kind === "load" && typeof step.detail.uri === "string" ? [step.detail.uri] : []))];
  const models = steps.filter(step => step.kind === "llm_call");
  const costs = models.flatMap(step => typeof step.detail.costUsd === "number" ? [step.detail.costUsd] : []);
  const unmeasuredSearches = steps.filter(step => step.kind === "search" && step.detail.elapsedMs === undefined).length;
  return { reads, modelCount: models.length, costCount: costs.length, cost: costs.reduce((sum, cost) => sum + cost, 0), unmeasuredSearches };
}

export function SessionSummary({ sessionId, steps, row, peek, embedded, backHref }: {
  readonly sessionId: string; readonly steps: TraceStep[]; readonly row?: SessionListRow;
  readonly peek: boolean; readonly embedded: boolean; readonly backHref: string;
}) {
  const bounds = sessionBounds(steps, row), counts = traceCounts(steps), facts = summaryFacts(steps);
  const Title = embedded || peek ? "h2" : "h1";
  const prompt = firstPromptOf(steps, row);
  // 2차 declutter: 길이·검색 수·오류 수는 제거(이벤트 목록이 같은 정보를 보여준다).
  // icon-swap: 시작=clock, 읽은 스킬=book-open+숫자(0이면 생략). 시각은 텍스트가 남으므로
  // 아이콘은 장식(aria-hidden), 읽은 스킬은 dt를 숨기고 dd에 이름/툴팁을 단다(inbox85).
  const line = [
    { id: "runtime", label: "실행 환경", hidden: true, value: <span className="pe-pill">{row ? RUNTIME_LABEL[row.runtime] : "미측정"}</span> },
    { id: "started", label: "시작", hidden: true, value: bounds.startedAt === undefined ? "미측정" : <><Icon name="clock" size={16} /><time dateTime={new Date(bounds.startedAt).toISOString()}>{date.format(bounds.startedAt)}</time></> },
    ...(facts.reads.length > 0 ? [{ id: "reads", label: "읽은 스킬", hidden: true, labelled: `읽은 스킬 ${facts.reads.length}개`,
      value: <><Icon name="book-open" size={16} />{facts.reads.length}</> }] : []),
  ];
  return <header className="trace-summary" data-component="session-summary">
    <div className="trace-summary__title"><Title className="trace__title"><code>{sessionId}</code></Title>{!peek && <CopyButton value={sessionId} />}</div>
    <dl className="trace-summary__line trace__meta" aria-label="세션 요약">
      {line.map(fact => <div key={fact.id} data-fact={fact.id}><dt className={fact.hidden ? "sr-only" : undefined}>{fact.label}</dt>
        <dd {...("labelled" in fact ? { role: "img", "aria-label": fact.labelled, title: fact.labelled } : {})}>{fact.value}</dd></div>)}
    </dl>
    {facts.reads.length > 0 && <div className="trace-summary__reads">{facts.reads.map(uri => <span className="pe-pill" key={uri} title={uri}><code>{skillName(uri)}</code></span>)}</div>}
    {peek && <dl className="trace-summary__kv">
      <div><dt>시작</dt><dd>{bounds.startedAt === undefined ? "미측정" : date.format(bounds.startedAt)}</dd></div>
      <div><dt>이벤트</dt><dd>{counts.steps}개</dd></div>
      <div><dt>읽기</dt><dd>{counts.loads}회</dd></div>
      <div><dt>세션 연결</dt><dd>{row ? ATTRIBUTION_LABEL[row.attribution] : "미측정"}</dd></div>
      <div><dt>모델 호출</dt><dd>{facts.modelCount}회 · 비용 {facts.costCount}/{facts.modelCount} 측정</dd></div>
    </dl>}
  </header>;
}
