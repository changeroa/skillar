import { isSkillarMcpData } from "../../../src/ingest/identity.js";
import type { TraceStep } from "../../../src/types.js";
import { CallList, callRows } from "../../components/calls";
import { Facts } from "../../components/facts";
import { KIND_LABEL, SPAN_KIND_LABEL, NEVER_CONSULTED, formatOffset, searchDetail, sessionBounds, type ToolDetail, type TraceCounts } from "./model";
import { spanFacts, type TimelineItem } from "./plan";
import { StepBody } from "./bodies";
const timeFmt = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function StepTime({ ts, startedAt }: { ts: number; startedAt?: number }) {
  const offset = startedAt !== undefined ? formatOffset(ts - startedAt) : "";
  return (
    <time class="tl__time" dateTime={new Date(ts).toISOString()} title={new Date(ts).toLocaleString("ko-KR")}>
      <b>{timeFmt.format(ts)}</b>
      {offset && <span class="tl__offset">{offset}</span>}
    </time>
  );
}

export function Step({ step, bounds }: { step: TraceStep; bounds: ReturnType<typeof sessionBounds> }) {
  const search = step.kind === "search" ? searchDetail(step) : undefined;
  const failedTool = step.kind === "tool_call" && (step.detail as ToolDetail).success === false;
  const skillarTool = step.kind === "tool_call" && isSkillarMcpData(step.detail as ToolDetail);
  const hollow = step.kind === "read_file" || step.kind === "native_skill" || step.kind === "llm_call" || step.kind === "tool_call";
  return (
    <li class={`tl__step tl__step--${step.kind}`} data-kind={step.kind}>
      <span class={hollow ? "tl__dot tl__dot--hollow" : "tl__dot"} aria-hidden="true" />
      <div class="tl__head">
        <span class="tl__kind">{KIND_LABEL[step.kind] ?? step.kind}</span>
        {step.kind === "native_skill" && <span class="tl__tag" title="실행 환경의 내장 스킬 기능으로 처리한 기록입니다. skillar 호출이 아닙니다.">내장</span>}
        {skillarTool && <span class="tl__tag" title="skillar의 MCP 서버 호출입니다.">skillar</span>}
        {failedTool && <span class="tl__tag tl__tag--bad">실패</span>}
        {search?.abstained && <span class="tl__tag tl__tag--bad">추천 보류</span>}
        <StepTime ts={step.ts} startedAt={bounds.startedAt} />
      </div>
      <div class="tl__body">
        <StepBody step={step} bounds={bounds} />
      </div>
    </li>
  );
}

export function SpanGroup({ item, bounds }: { item: Extract<TimelineItem, { kind: "span" }>; bounds: ReturnType<typeof sessionBounds> }) {
  const rows = callRows(item.span.events);
  return (
    <li class="tl__step tl__step--span" data-kind="skill_span" data-skill={item.span.skill} data-turn={item.turnId}>
      <span class="tl__dot tl__dot--hollow" aria-hidden="true" />
      <div class="tl__head">
        <span class="tl__kind">{SPAN_KIND_LABEL}</span>
        <span class="tl__name" title={item.span.uri ?? "스킬 URI 기록 없음"}>{item.span.name}</span>
        <StepTime ts={item.span.startedAt} startedAt={bounds.startedAt} />
      </div>
      <div class="tl__body">
        <Facts facts={spanFacts(item.span, rows.length, item.finding)} />
        <CallList rows={rows} />
      </div>
    </li>
  );
}

export function NeverConsulted({ counts }: { counts: TraceCounts }) {
  return (
    <div class="callout" role="status" data-empty="never-consulted">
      <strong>{NEVER_CONSULTED}</strong>
      <span>
        스킬 검색 기록이 없어 후보 순위를 매기지 않았습니다.
        {counts.natives ? ` 실행 환경이 내장 스킬 ${counts.natives}개를 처리했습니다.` : ""}
      </span>
    </div>
  );
}
