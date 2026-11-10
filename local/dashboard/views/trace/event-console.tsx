import { createRef, type RefObject } from "preact";
import { useRef } from "preact/hooks";
import type { SessionSkillReportDto, TraceStep } from "../../../src/types.js";
import { EVENT_ICON, Icon } from "../../components/icons";
import { useNarrow } from "../../components/use-narrow";
import { type ViewProps } from "../../state";
import { StepBody } from "./bodies";
import { EventInspector } from "./event-inspector";
import { ganttGeometry, type ganttViewport } from "./geometry";
import { GanttControls, useGanttWindow } from "./gantt-controls";
import { KIND_LABEL, formatOffset, sessionBounds } from "./model";
import { planTimeline, type KeyedStep, type TimelineItem } from "./plan";
import { SpanGroup } from "./timeline";
import { EventViewTabs } from "./view-tabs";
import { useEventRoving } from "./roving";

type EventProps = Pick<ViewProps, "route" | "navigate"> & {
  readonly item: TimelineItem; readonly selected: boolean; readonly narrow: boolean;
  readonly bounds: ReturnType<typeof sessionBounds>; readonly point?: ReturnType<typeof ganttViewport>["points"][number];
  readonly argumentIds?: ReadonlySet<string>;
  readonly trigger: RefObject<HTMLButtonElement>;
  readonly index?: number; readonly count?: number;
  readonly active?: boolean; readonly onFocus?: () => void;
};

function EventRow({ item, selected, bounds, point, trigger, route, navigate, index, count, active, onFocus }: EventProps) {
  const step = item.kind === "step" ? item.step : undefined;
  const kind = step?.kind ?? "skill_span", title = step ? KIND_LABEL[step.kind] : "스킬 구간";
  const ts = item.kind === "step" ? item.step.ts : item.span.startedAt;
  const summary = item.kind === "step" ? item.step.summary : item.span.name;
  const timeline = route.traceTab === "timeline";
  return <li class="trace-event" role={timeline ? "row" : "none"} aria-rowindex={timeline ? index : undefined} data-kind={kind} data-event-id={item.key}>
    <button ref={trigger} class="trace-event-row" data-event-kind={kind}
      role={timeline ? "gridcell" : "treeitem"} aria-selected={selected} aria-level={timeline ? undefined : 1}
      aria-posinset={timeline ? undefined : index} aria-setsize={timeline ? undefined : count}
      aria-colindex={timeline ? 1 : undefined} tabIndex={active ? 0 : -1} onFocus={onFocus}
      onClick={() => navigate({ ...route, event: item.key })}>
      <Icon name={step ? EVENT_ICON[step.kind] : "book"} /><span class="trace-event-row__kind">{title}</span>
      <code class="trace-event-row__summary" title={summary}>{summary}</code>
      <time class="pe-muted" dateTime={new Date(ts).toISOString()}>{bounds.startedAt === undefined ? "미측정" : formatOffset(ts - bounds.startedAt)}</time>
      {route.traceTab === "timeline" && point?.outside && <span class="pe-muted">시간 범위 밖</span>}
      {route.traceTab === "timeline" && point && !point.outside && <span class="event-gantt-track" aria-label={`${point.offsetMs}ms${point.bounded ? " · 측정된 구간" : " · 시점"}`}>
        {point.inView && <span class={point.bounded ? "event-gantt-bar" : "event-gantt-point"} style={`left:${point.x}%;width:${point.width}%`}
          data-offset={point.offsetMs} data-bounded={point.bounded} />}
      </span>}
    </button>
  </li>;
}

function EventBody({ item, selected, narrow, bounds, argumentIds, trigger, route, navigate }: EventProps) {
  const kind = item.kind === "step" ? item.step.kind : "skill_span";
  const title = item.kind === "step" ? KIND_LABEL[item.step.kind] : "스킬 구간";
  return <EventInspector id={item.key} kind={kind} title={title} value={item.kind === "step" ? item.step : item.span}
      selected={selected} narrow={narrow} trigger={trigger} route={route} navigate={navigate}>
      {item.kind === "step" ? <StepBody step={item.step} bounds={bounds} /> : <ol class="tl"><SpanGroup item={item} bounds={bounds} argumentIds={argumentIds} /></ol>}
    </EventInspector>;
}

function reportOnlyArguments(source: readonly KeyedStep[], spans: readonly Extract<TimelineItem, { kind: "span" }>[]) {
  const recorded = new Map<string, TraceStep>(), legacy = new Map<number, TraceStep[]>();
  for (const { step } of source) {
    if (step.kind !== "tool_call") continue;
    if (typeof step.detail.eventId === "string") recorded.set(step.detail.eventId, step);
    else {
      const queue = legacy.get(step.ts) ?? [];
      queue.push(step); legacy.set(step.ts, queue);
    }
  }
  return new Map(spans.map(item => [item.key, new Set(item.span.events.filter(event => {
    if (event.kind !== "tool_call") return false;
    const raw = recorded.get(event.id) ?? legacy.get(event.ts)?.shift();
    // The original event owns a captured argument disclosure. A report supplies
    // one only when that capture is absent, never a second copy of the same text.
    return raw === undefined || typeof raw.detail.args !== "string";
  }).map(event => event.id))]));
}

export function EventConsole({ source, report, bounds, route, navigate, embedded = false, prefix = "event" }: Pick<ViewProps, "route" | "navigate" | "embedded"> & {
  readonly source: readonly KeyedStep[]; readonly report?: SessionSkillReportDto; readonly bounds: ReturnType<typeof sessionBounds>; readonly prefix?: string;
}) {
  const narrow = useNarrow();
  const triggers = useRef(new Map<string, RefObject<HTMLButtonElement>>());
  const triggerFor = (key: string) => {
    let ref = triggers.current.get(key);
    if (!ref) { ref = createRef<HTMLButtonElement>(); triggers.current.set(key, ref); }
    return ref;
  };
  // Keep every source body in its original keyed parent. Report spans are additional
  // measured observations, not replacement identities for their member events.
  const spans = planTimeline(source, report).filter(item => item.kind === "span");
  const argumentsBySpan = reportOnlyArguments(source, spans);
  const items: TimelineItem[] = [...source, ...spans].sort((a, b) =>
    (a.kind === "step" ? a.step.ts : a.span.startedAt) - (b.kind === "step" ? b.step.ts : b.span.startedAt));
  const selected = route.event === undefined
    ? source.find(item => item.step.kind === "prompt")?.key ?? items[0]?.key
    : items.find(item => item.key === route.event)?.key;
  const graph = ganttGeometry(items, bounds.startedAt, bounds.endedAt);
  const window = useGanttWindow(graph);
  const points = new Map(window.viewport?.points.map(point => [point.key, point]));
  const tab = route.traceTab ?? "tree";
  const roving = useEventRoving(items.map(item => item.key), selected);
  const Heading = embedded ? "h3" : "h2";
  const TreeRoot = embedded ? "div" : "main";
  return <section class="event-console" data-component="linked-event-console">
    <EventViewTabs route={route} navigate={navigate} prefix={prefix} />
    {route.event !== undefined && selected === undefined && <p role="status">선택한 이벤트를 찾을 수 없습니다. 목록에서 다시 선택하세요.</p>}
    {tab === "timeline" && graph?.points.some(point => point.outside) && <p class="pe-muted event-range-note" role="status">세션 시간 범위 밖의 보고서 구간은 축에 표시하지 않습니다.</p>}
    <div class="event-console__split">
      <TreeRoot class="event-console__tree" aria-label="세션 이벤트" tabIndex={-1} data-component="event-tree">
       <div id={`${prefix}-tree-panel`} role="tabpanel" aria-labelledby={`${prefix}-${tab}-tab`}>
        <div class="event-console__heading"><Heading>이벤트 순서</Heading><span class="pe-muted">{source.length}개{spans.length ? ` · 구간 ${spans.length}개` : ""}</span></div>
        {tab === "timeline" && graph && <GanttControls graph={graph} window={window} />}
        <ol aria-label="세션 이벤트 순서" role={tab === "timeline" ? "grid" : "tree"}
          aria-rowcount={tab === "timeline" ? items.length : undefined} aria-colcount={tab === "timeline" ? 1 : undefined}
          onKeyDown={roving.onKeyDown}>{items.map((item, index) => <EventRow key={item.key} item={item} selected={selected === item.key}
          index={index + 1} count={items.length} active={roving.active === item.key} onFocus={() => roving.onFocus(item.key)}
          narrow={narrow} bounds={bounds} point={points.get(item.key)} trigger={triggerFor(item.key)} route={route} navigate={navigate} />)}</ol>
        {!items.length && <p>이 세션에 수집된 이벤트가 없습니다.</p>}
       </div>
      </TreeRoot>
      <aside class="event-console__inspector" aria-label="선택한 이벤트 상세">
        {items.map(item => <EventBody key={item.key} item={item} selected={selected === item.key} narrow={narrow}
          bounds={bounds} argumentIds={argumentsBySpan.get(item.key)} trigger={triggerFor(item.key)} route={route} navigate={navigate} />)}
      </aside>
    </div>
  </section>;
}
