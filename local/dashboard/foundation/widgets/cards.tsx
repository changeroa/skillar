import type { ComponentChildren } from "preact";
import { Skeleton } from "../controls/labels";
import { EmptyState, Alert } from "./messages";

export type CardProps = {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ComponentChildren;
  readonly footer?: ComponentChildren;
  readonly children: ComponentChildren;
};

export function Card({ title, description, actions, footer, children }: CardProps) {
  return <section class="lf-card" aria-label={title}>
    <header class="lf-card__header">
      <div><h3 class="lf-card__title">{title}</h3>
        {description && <p class="lf-card__description">{description}</p>}</div>
      {actions && <div class="lf-card__actions">{actions}</div>}
    </header>
    <div class="lf-card__content">{children}</div>
    {footer && <footer class="lf-card__footer">{footer}</footer>}
  </section>;
}

export type WidgetState =
  | { readonly kind: "ready" }
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly message: string; readonly action?: ComponentChildren }
  | { readonly kind: "error"; readonly message: string; readonly action?: ComponentChildren };

export function Widget({ state, children, ...props }: CardProps & { readonly state: WidgetState }) {
  let content: ComponentChildren;
  switch (state.kind) {
    case "ready": content = children; break;
    case "loading": content = <Skeleton label={`${props.title} 불러오는 중`} />; break;
    case "empty": content = <EmptyState title="표시할 데이터가 없습니다" description={state.message} action={state.action} />; break;
    case "error": content = <Alert title="불러오지 못했습니다" variant="destructive" announce action={state.action}>{state.message}</Alert>; break;
    default: { const unreachable: never = state; return unreachable; }
  }
  return <Card {...props}>{content}</Card>;
}

export type MetricProps = {
  readonly label: string;
  readonly value: number | null;
  readonly note?: string;
  readonly prefix?: string;
  readonly suffix?: string;
};

export function Metric({ label, value, note, prefix, suffix }: MetricProps) {
  return <section class="lf-metric" aria-label={label}>
    <p class="lf-metric__label">{label}</p>
    <strong class="lf-metric__value" data-measured={value !== null}>
      {value === null ? "미측정" : <>{prefix}{value.toLocaleString("ko-KR")}{suffix}</>}
    </strong>
    {note && <p class="lf-metric__note">{note}</p>}
  </section>;
}

export function MetricStrip({ metrics, label }: { readonly metrics: readonly MetricProps[]; readonly label: string }) {
  return <div class="lf-metric-strip" role="group" aria-label={label}>
    {metrics.map(metric => <Metric key={metric.label} {...metric} />)}
  </div>;
}
