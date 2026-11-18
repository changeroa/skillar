import { Icon, EVENT_ICON } from "../../components/icons";
import { buildHash, type ViewProps } from "../../state";
import { KIND_LABEL, formatOffset } from "./model";
import type { KeyedStep } from "./plan";
import { useEventRoving } from "./roving";

export function CompactTree({ items, startedAt, endedAt, route, navigate }: Pick<ViewProps, "route" | "navigate"> & {
  readonly items: readonly KeyedStep[]; readonly startedAt?: number; readonly endedAt?: number;
}) {
  const roving = useEventRoving(items.map(item => item.key), route.event);
  return <section className="trace-compact-tree" data-component="event-tree">
    <div id="peek-event-tree-panel">
    <h3>이벤트 <span className="pe-muted">{items.length}개</span></h3>
    <ol aria-label="세션 이벤트 순서" role="tree"
      onKeyDown={roving.onKeyDown}>{items.map((item, index) =>
      <li key={item.key} role="none"
        data-kind={item.step.kind} data-event-id={item.key}>
      <a className="trace-event-row" data-event-kind={item.step.kind} href={buildHash({ ...route, view: "trace", peek: undefined, event: item.key })}
        role="treeitem" aria-selected={route.event === item.key}
        aria-level={1} aria-posinset={index + 1}
        aria-setsize={items.length}
        tabIndex={roving.active === item.key ? 0 : -1} onFocus={() => roving.onFocus(item.key)}>
        <Icon name={EVENT_ICON[item.step.kind]} /><span className="trace-event-row__kind">{KIND_LABEL[item.step.kind]}</span>
        <code className="trace-event-row__summary" title={item.step.summary}>{item.step.summary}</code>
        <time className="pe-muted" dateTime={new Date(item.step.ts).toISOString()}>{startedAt === undefined ? "미측정" : formatOffset(item.step.ts - startedAt)}</time>
      </a>
    </li>)}</ol>
    </div>
  </section>;
}
