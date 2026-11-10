import { z } from "zod";
import { Card, Metric, BarChart, LineChart, Histogram, EmptyState, Alert, StatusMessage, Callout } from "./widgets";
import { Glyph } from "./controls/icons";

const schema = z.object({
  kind: z.enum(["Card", "Metric", "Bar", "Line", "Histogram", "Empty", "Alert", "StatusMessage", "Callout"]),
  title: z.string().default("기록"),
  text: z.string().default(""),
  variant: z.enum(["default", "info", "warning", "destructive"]).default("default"),
  level: z.enum(["DEFAULT", "DEBUG", "WARNING", "ERROR"]).default("ERROR"),
  size: z.enum(["default", "compact", "sm"]).default("default"),
  align: z.enum(["top", "middle"]).default("top"),
  value: z.number().nullable().default(0),
  emptyVariant: z.enum(["default", "intro"]).default("default"),
  surface: z.enum(["background", "popover"]).default("background"),
  width: z.number().min(40).max(1400).default(600),
  data: z.object({
    labels: z.array(z.string()), series: z.array(z.object({ label: z.string(), values: z.array(z.number().nullable()) })),
  }).default({ labels: ["월", "화", "수"], series: [{ label: "읽기", values: [0, 7, null] }] }),
});

/** Development-only matching-content host; never overrides primitive paint. */
export function WidgetsReference() {
  const spec = schema.parse(JSON.parse(new URLSearchParams(location.search).get("widgetReference") ?? "{}"));
  const context = {
    background: { paint: "var(--lf-background)", padding: 0 },
    popover: { paint: "var(--lf-popover)", padding: 8 },
  }[spec.surface];
  let content;
  switch (spec.kind) {
    case "Card": content = <Card title={spec.title} description={spec.text}>기록된 사용량을 확인합니다.</Card>; break;
    case "Metric": content = <Metric label={spec.title} value={spec.value} note={spec.text} />; break;
    case "Bar": content = <BarChart title={spec.title} data={spec.data} />; break;
    case "Line": content = <LineChart title={spec.title} data={spec.data} />; break;
    case "Histogram": content = <Histogram title={spec.title} labels={spec.data.labels} values={spec.data.series[0]?.values ?? []} />; break;
    case "Empty": content = <EmptyState title={spec.title} description={spec.text} variant={spec.emptyVariant} />; break;
    case "Alert": content = <Alert title={spec.title} variant={spec.variant} size={spec.size === "sm" ? "sm" : "default"}
      icon="dashboard">{spec.text}</Alert>; break;
    case "StatusMessage": content = <StatusMessage message={spec.text} level={spec.level} size={spec.size === "compact" ? "compact" : "default"} />; break;
    case "Callout": content = <Callout variant={spec.variant === "warning" ? "warning" : "info"} align={spec.align}
      onDismiss={() => {}}><p>{spec.text}</p></Callout>; break;
    default: { const unreachable: never = spec.kind; return unreachable; }
  }
  return <main id="gallery" data-ready="true" style={{ width: spec.width + context.padding * 2, maxWidth: "calc(100% - 64px)", margin: 32 }}>
    <div id="widget-reference" style={{ boxSizing: "border-box", padding: context.padding, background: context.paint }}>{content}</div>
    <p style={{ marginTop: 32 }}><Glyph name="check" /> Product primitive · development-only matching-content host</p>
  </main>;
}
