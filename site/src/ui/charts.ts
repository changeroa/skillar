import { h } from "preact";

export type ChartSeries = { readonly label: string; readonly values: readonly (number | null)[] };
export type ChartData = { readonly labels: readonly string[]; readonly series: readonly ChartSeries[] };
const geometry = { width: 640, height: 280, left: 48, right: 592, top: 32, baseline: 232, gap: 8 } as const;

/** Every series shares this scale and zero baseline; null is not a zero. */
export function chartLayout(data: ChartData, height: number = geometry.height) {
  const baseline = height - (geometry.height - geometry.baseline);
  const max = Math.max(1, ...data.series.flatMap(series => series.values.filter(value => value !== null)));
  const groupWidth = (geometry.right - geometry.left) / Math.max(1, data.labels.length);
  const gap = Math.min(geometry.gap, groupWidth / Math.max(4, data.series.length * 4));
  const width = (groupWidth - gap * (data.series.length + 1)) / Math.max(1, data.series.length);
  const y = (value: number) => baseline - value / max * (baseline - geometry.top);
  const bars = data.labels.flatMap((label, group) => data.series.map((series, seriesIndex) => {
    const value = series.values[group] ?? null;
    // Integer SVG geometry keeps the rendered bottom exact even after the
    // browser stores rect coordinates as float32 values.
    const height = value === null ? 0 : Math.max(1, Math.round(baseline - y(value)));
    return { label, series: series.label, seriesIndex, value, x: geometry.left + group * groupWidth + gap + seriesIndex * (width + gap),
      y: baseline - height, width, height, baseline };
  }));
  return { ...geometry, height, baseline, max, groupWidth, bars, y };
}

function Chart({ title, data, kind, height }: { readonly title: string; readonly data: ChartData; readonly kind: "bar" | "line"; readonly height?: number }) {
  const layout = chartLayout(data, height);
  const x = (value: number) => `${value / layout.width * 100}%`;
  const measured = data.series.some(series => series.values.some(value => value !== null));
  return h("figure", { class: "ui-chart" }, h("figcaption", null, title),
    !measured ? h("p", { class: "ui-empty" }, "미측정") :
      h("svg", { width: "100%", height: layout.height, style: { height: layout.height }, role: "img", "aria-label": title },
        h("title", null, title),
        h("desc", null, data.labels.map((label, index) =>
          `${label}: ${data.series.map(series => `${series.label} ${series.values[index] ?? "미측정"}`).join(", ")}`).join("; ")),
        h("line", { x1: x(layout.left), x2: x(layout.right), y1: layout.baseline, y2: layout.baseline, class: "ui-chart-axis" }),
        h("text", { x: x(layout.left - 12), y: layout.baseline + 4, "text-anchor": "end" }, "0"),
        kind === "bar" ? layout.bars.map((bar, index) =>
          h("g", { key: index, class: `ui-series-${bar.seriesIndex % 2}` },
            bar.value !== null && h("rect", { x: x(bar.x), y: bar.y, width: x(bar.width), height: bar.height,
              "data-baseline": bar.baseline, "data-value": bar.value }),
            bar.value !== null && h("text", { x: x(bar.x + bar.width / 2), y: bar.y - 8, "text-anchor": "middle" }, bar.value))) :
          data.series.map((series, seriesIndex) => h("g", { key: series.label, class: `ui-series-${seriesIndex % 2}` },
            // Each missing point breaks the path rather than fabricating continuity.
            h("svg", { width: "100%", height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}`, preserveAspectRatio: "none", "aria-hidden": "true" },
              h("path", { fill: "none", d: series.values.map((value, index, values) => value === null ? "" :
              `${index === 0 || values[index - 1] === null ? "M" : "L"}${layout.left + (index + .5) * layout.groupWidth},${layout.y(value)}`).join(" ") }),
            ),
            series.values.map((value, index) => value === null ? null : h("g", { key: index },
              h("circle", { cx: x(layout.left + (index + .5) * layout.groupWidth), cy: layout.y(value), r: 3 }),
              h("text", { x: x(layout.left + (index + .5) * layout.groupWidth), y: layout.y(value) - 8, "text-anchor": "middle" }, value))))),
        data.labels.map((label, index) => h("text", { key: index, x: x(layout.left + (index + .5) * layout.groupWidth),
          y: layout.baseline + 28, "text-anchor": "middle" }, label))),
    h("ul", { class: "ui-chart-legend" }, data.series.map((series, index) => h("li", { key: series.label, class: `ui-series-${index % 2}` },
      series.label, series.values.some(value => value === null) ? series.values.every(value => value === null) ? " · 미측정" : " · 일부 미측정" : ""))));
}

export function BarChart(props: { readonly title: string; readonly data: ChartData; readonly height?: number }) {
  return h(Chart, { ...props, kind: "bar" });
}
export function LineChart(props: { readonly title: string; readonly data: ChartData }) {
  return h(Chart, { ...props, kind: "line" });
}
