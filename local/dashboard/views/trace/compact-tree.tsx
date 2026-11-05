import { Icon, EVENT_ICON } from "../../components/icons";
import { buildHash, type ViewProps } from "../../state";
import { KIND_LABEL, formatOffset } from "./model";
import type { KeyedStep } from "./plan";

export function CompactTree({ items, startedAt, route }: Pick<ViewProps, "route"> & {
  readonly items: readonly KeyedStep[]; readonly startedAt?: number;
}) {
  return <section class="trace-compact-tree" data-component="event-tree">
    <h3>이벤트 <span class="pe-muted">{items.length}개</span></h3>
    <ol aria-label="세션 이벤트 순서">{items.map(item => <li key={item.key} data-kind={item.step.kind}>
      <a class="trace-event-row" data-event-kind={item.step.kind} href={buildHash({ ...route, view: "trace", peek: undefined, event: item.key })}>
        <Icon name={EVENT_ICON[item.step.kind]} /><span class="trace-event-row__kind">{KIND_LABEL[item.step.kind]}</span>
        <code class="trace-event-row__summary" title={item.step.summary}>{item.step.summary}</code>
        <time class="pe-muted" dateTime={new Date(item.step.ts).toISOString()}>{startedAt === undefined ? "미측정" : formatOffset(item.step.ts - startedAt)}</time>
      </a>
    </li>)}</ol>
  </section>;
}
