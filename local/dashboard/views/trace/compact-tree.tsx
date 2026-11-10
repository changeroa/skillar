import { Icon, EVENT_ICON } from "../../components/icons";
import { buildHash, type ViewProps } from "../../state";
import { KIND_LABEL, formatOffset } from "./model";
import type { KeyedStep } from "./plan";
import { ganttGeometry } from "./geometry";
import { EventViewTabs } from "./view-tabs";
import { GanttControls, useGanttWindow } from "./gantt-controls";
import { useEventRoving } from "./roving";

export function CompactTree({ items, startedAt, endedAt, route, navigate }: Pick<ViewProps, "route" | "navigate"> & {
  readonly items: readonly KeyedStep[]; readonly startedAt?: number; readonly endedAt?: number;
}) {
  const graph = ganttGeometry(items, startedAt, endedAt);
  const window = useGanttWindow(graph);
  const points = new Map(window.viewport?.points.map(point => [point.key, point]));
  const tab = route.traceTab ?? "tree";
  const roving = useEventRoving(items.map(item => item.key), route.event);
  return <section class="trace-compact-tree" data-component="event-tree">
    <EventViewTabs route={route} navigate={navigate} prefix="peek-event" />
    <div id="peek-event-tree-panel" role="tabpanel" aria-labelledby={`peek-event-${tab}-tab`}>
    <h3>이벤트 <span class="pe-muted">{items.length}개</span></h3>
    {tab === "timeline" && graph && <GanttControls graph={graph} window={window} />}
    <ol aria-label="세션 이벤트 순서" role={tab === "timeline" ? "grid" : "tree"}
      aria-rowcount={tab === "timeline" ? items.length : undefined} aria-colcount={tab === "timeline" ? 1 : undefined}
      onKeyDown={roving.onKeyDown}>{items.map((item, index) => {
      const point = points.get(item.key);
      return <li key={item.key} role={tab === "timeline" ? "row" : "none"} aria-rowindex={tab === "timeline" ? index + 1 : undefined}
        data-kind={item.step.kind} data-event-id={item.key}>
      <a class="trace-event-row" data-event-kind={item.step.kind} href={buildHash({ ...route, view: "trace", peek: undefined, event: item.key })}
        role={tab === "timeline" ? "gridcell" : "treeitem"} aria-selected={route.event === item.key}
        aria-level={tab === "timeline" ? undefined : 1} aria-posinset={tab === "timeline" ? undefined : index + 1}
        aria-setsize={tab === "timeline" ? undefined : items.length} aria-colindex={tab === "timeline" ? 1 : undefined}
        tabIndex={roving.active === item.key ? 0 : -1} onFocus={() => roving.onFocus(item.key)}>
        <Icon name={EVENT_ICON[item.step.kind]} /><span class="trace-event-row__kind">{KIND_LABEL[item.step.kind]}</span>
        <code class="trace-event-row__summary" title={item.step.summary}>{item.step.summary}</code>
        <time class="pe-muted" dateTime={new Date(item.step.ts).toISOString()}>{startedAt === undefined ? "미측정" : formatOffset(item.step.ts - startedAt)}</time>
        {tab === "timeline" && point && <span class="event-gantt-track">
          {point.inView && <span class={point.bounded ? "event-gantt-bar" : "event-gantt-point"} style={`left:${point.x}%;width:${point.width}%`}
            data-offset={point.offsetMs} data-bounded={point.bounded} />}
        </span>}
      </a>
    </li>; })}</ol>
    </div>
  </section>;
}
