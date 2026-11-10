import { useEffect, useId, useState } from "preact/hooks";
import { Button } from "../controls/buttons";
import { EmptyState } from "./messages";
import { chartLayout } from "./chart-layout";
import type { ChartData } from "./chart-layout";

export type ChartProps = { readonly title: string; readonly data: ChartData; readonly height?: number | undefined };
type Point = { readonly label: string; readonly series: string };

function Chart({ title, data, kind, height }: ChartProps & { readonly kind: "bar" | "histogram" | "line" }) {
  const id = useId();
  const [hidden, setHidden] = useState<readonly number[]>([]);
  const [focused, setFocused] = useState<Point | null>(null);
  const [hovered, setHovered] = useState<Point | null>(null);
  let line = false;
  let histogram = false;
  switch (kind) {
    case "bar": break;
    case "histogram": histogram = true; break;
    case "line": line = true; break;
    default: { const unreachable: never = kind; return unreachable; }
  }
  const layout = chartLayout(data, height);
  const x = (value: number) => `${value / layout.width * 100}%`;
  const measured = data.series.some(series => series.values.some(value => value !== null));
  const describe = (label: string, series: string, value: number | null) => `${label} · ${series}: ${value ?? "미측정"}`;
  const resolve = (point: Point | null) => {
    if (!point) return null;
    const index = data.series.findIndex(series => series.label === point.series);
    const value = data.series[index]?.values[data.labels.indexOf(point.label)];
    return value == null || hidden.includes(index) ? null : describe(point.label, point.series, value);
  };
  const tooltip = resolve(focused) ?? resolve(hovered);
  const dismiss = () => { setFocused(null); setHovered(null); };
  useEffect(() => {
    if (!tooltip) return;
    const root = document.documentElement;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    root.addEventListener("keydown", escape);
    return () => root.removeEventListener("keydown", escape);
  }, [tooltip]);
  return <figure class="lf-chart" data-kind={kind} onMouseLeave={() => setHovered(null)}>
    <figcaption>{title}</figcaption>
    {!measured ? <EmptyState title={data.labels.length ? "미측정" : "표시할 데이터가 없습니다"}
      description="측정값이 있는 범위에서 차트를 표시합니다." /> :
      <div class="lf-chart__scroll">
        <svg width="100%" height={layout.height} role="group" aria-label={title}
          style={{ minWidth: Math.max(280, data.labels.length * 72) }}
          onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); } }}>
          <title>{title}</title>
          <desc>{data.labels.map((label, index) => data.series.map(series => describe(label, series.label, series.values[index] ?? null)).join(", ")).join("; ")}</desc>
          {[0, .5, 1].map(ratio => <line key={ratio} class="lf-chart__grid"
            x1={x(layout.left)} x2={x(layout.right)} y1={layout.y(layout.max * ratio)} y2={layout.y(layout.max * ratio)} />)}
          <line data-zero-baseline class="lf-chart__axis" x1={x(layout.left)} x2={x(layout.right)} y1={layout.baseline} y2={layout.baseline} />
          <text x={x(layout.left - 12)} y={layout.baseline + 4} text-anchor="end">0</text>
          <text x={x(layout.left - 12)} y={layout.top + 4} text-anchor="end">{layout.max}</text>
          {line ? data.series.map((series, seriesIndex) =>
            <g key={series.label} class={`lf-chart__series lf-chart__series--${seriesIndex % 8 + 1}`} hidden={hidden.includes(seriesIndex)}>
              <svg width="100%" height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}
                preserveAspectRatio="none" aria-hidden="true">
                <path fill="none" d={series.values.map((value, index, values) => value === null ? "" :
                  `${index === 0 || values[index - 1] == null ? "M" : "L"}${layout.left + (index + .5) * layout.groupWidth},${layout.y(value)}`).join(" ")} />
              </svg>
              {data.labels.map((label, index) => {
                const value = series.values[index] ?? null;
                if (value === null) return null;
                const text = describe(label, series.label, value);
                return <g key={label} tabindex={0} role="img" data-chart-point aria-label={text}
                  aria-describedby={tooltip === text ? `${id}-tooltip` : undefined}
                  onFocus={() => setFocused({ label, series: series.label })} onBlur={() => setFocused(null)}
                  onMouseEnter={() => setHovered({ label, series: series.label })}>
                  <circle cx={x(layout.left + (index + .5) * layout.groupWidth)} cy={layout.y(value)} r="3" />
                  <text x={x(layout.left + (index + .5) * layout.groupWidth)} y={layout.y(value) - 8} text-anchor="middle">{value}</text>
                </g>;
              })}
            </g>) :
            layout.bars.map((bar, index) => {
              const text = describe(bar.label, bar.series, bar.value);
              return <g key={index} class={`lf-chart__series lf-chart__series--${bar.seriesIndex % 8 + 1}`}
                hidden={hidden.includes(bar.seriesIndex)} tabindex={bar.value === null ? undefined : 0}
                role={bar.value === null ? undefined : "img"} data-chart-point={bar.value !== null || undefined} aria-label={bar.value === null ? undefined : text}
                aria-describedby={tooltip === text ? `${id}-tooltip` : undefined}
                onFocus={() => setFocused({ label: bar.label, series: bar.series })} onBlur={() => setFocused(null)}
                onMouseEnter={() => setHovered({ label: bar.label, series: bar.series })}>
                {bar.value !== null && <>
                  <rect x={x(histogram ? layout.left + Math.floor(index / data.series.length) * layout.groupWidth + 1 : bar.x)}
                    y={bar.y} width={x(histogram ? Math.max(1, layout.groupWidth - 2) : bar.width)} height={bar.height}
                    data-value={bar.value} data-baseline={bar.baseline} />
                  <text x={x(histogram ? layout.left + (index + .5) * layout.groupWidth : bar.x + bar.width / 2)}
                    y={bar.y - 8} text-anchor="middle">{bar.value}</text>
                </>}
              </g>;
            })}
          {data.labels.map((label, index) => <text key={label} class="lf-chart__label"
            x={x(layout.left + (index + .5) * layout.groupWidth)} y={layout.baseline + 28} text-anchor="middle">
            {label.split("\n").map((line, row) => <tspan key={row} x={x(layout.left + (index + .5) * layout.groupWidth)} dy={row === 0 ? 0 : 16}>{line}</tspan>)}
          </text>)}
        </svg>
      </div>}
    {tooltip && <div role="tooltip" id={`${id}-tooltip`} class="lf-chart__tooltip">{tooltip}</div>}
    <div class="lf-chart__legend" role="group" aria-label={`${title} 계열`}>
      {data.series.map((series, index) => <span key={series.label} class={`lf-chart__legend-item lf-chart__series--${index % 8 + 1}`}
        data-hidden={hidden.includes(index)}>
        <span class="lf-chart__swatch" aria-hidden="true" />
        <Button text={`${series.label}${series.values.some(value => value === null)
        ? series.values.every(value => value === null) ? " · 미측정" : " · 일부 미측정" : ""}`}
        variant="ghost" icon={hidden.includes(index) ? "minus" : "check"} aria-pressed={!hidden.includes(index)}
        onClick={() => { setHidden(previous => previous.includes(index) ? previous.filter(value => value !== index) : [...previous, index]); dismiss(); }} />
      </span>)}
    </div>
    <details class="lf-chart__data"><summary>데이터 표 보기 · {title}</summary>
      <div class="lf-chart__data-scroll"><table>
        <caption>{title} · 전체 측정값</caption>
        <thead><tr><th scope="col">구간</th>{data.series.map(series => <th scope="col" key={series.label}>{series.label}</th>)}</tr></thead>
        <tbody>{data.labels.map((label, index) => <tr key={label}><th scope="row">{label}</th>
          {data.series.map(series => <td key={series.label}>{series.values[index] ?? "미측정"}</td>)}</tr>)}</tbody>
      </table></div>
    </details>
  </figure>;
}

export function BarChart(props: ChartProps) { return <Chart {...props} kind="bar" />; }
export function LineChart(props: ChartProps) { return <Chart {...props} kind="line" />; }
export function Histogram({ title, labels, values, height }: {
  readonly title: string; readonly labels: readonly string[]; readonly values: readonly (number | null)[]; readonly height?: number;
}) {
  return <Chart title={title} data={{ labels, series: [{ label: "빈도", values }] }} height={height} kind="histogram" />;
}
