import type {ReactNode as ComponentChildren} from "react";
import { Card as AxCard } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { StackItem } from "@astryxdesign/core/Stack";
import { Divider } from "@astryxdesign/core/Divider";
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
  // Astryx Card composed with layout primitives. Landmark semantics preserved
  // (role=region + aria-label, as the old section[aria-label]); description
  // and footer use Astryx supporting text.
  return <AxCard role="region" aria-label={title}>
    <VStack gap={3}>
      <HStack vAlign="start">
        <StackItem size="fill">
          <VStack gap={1}>
            <Heading level={3}>{title}</Heading>
            {description && <Text type="supporting" display="block">{description}</Text>}
          </VStack>
        </StackItem>
        {actions && <StackItem size="static">{actions}</StackItem>}
      </HStack>
      {children}
      {footer && <>
        <Divider />
        <footer><Text type="supporting" display="block">{footer}</Text></footer>
      </>}
    </VStack>
  </AxCard>;
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
  return <section className="lf-metric" aria-label={label}>
    <p className="lf-metric__label">{label}</p>
    <strong className="lf-metric__value" data-measured={value !== null}>
      {value === null ? "미측정" : <>{prefix}{value.toLocaleString("ko-KR")}{suffix}</>}
    </strong>
    {note && <p className="lf-metric__note">{note}</p>}
  </section>;
}

export function MetricStrip({ metrics, label }: { readonly metrics: readonly MetricProps[]; readonly label: string }) {
  return <div className="lf-metric-strip" role="group" aria-label={label}>
    {metrics.map(metric => <Metric key={metric.label} {...metric} />)}
  </div>;
}
