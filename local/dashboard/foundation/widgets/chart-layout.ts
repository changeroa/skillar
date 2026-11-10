export type ChartSeries = { readonly label: string; readonly values: readonly (number | null)[] };
export type ChartData = { readonly labels: readonly string[]; readonly series: readonly ChartSeries[] };
const geometry = { width: 640, height: 280, left: 48, right: 592, top: 32, baseline: 232, gap: 8 } as const;

/** One shared zero baseline; null is never coerced into a measured zero. */
export function chartLayout(data: ChartData, height: number = geometry.height) {
  const baseline = height - (geometry.height - geometry.baseline);
  const max = Math.max(1, ...data.series.flatMap(series => series.values.filter(value => value !== null)));
  const groupWidth = (geometry.right - geometry.left) / Math.max(1, data.labels.length);
  const gap = Math.min(geometry.gap, groupWidth / Math.max(4, data.series.length * 4));
  const width = (groupWidth - gap * (data.series.length + 1)) / Math.max(1, data.series.length);
  const y = (value: number) => baseline - value / max * (baseline - geometry.top);
  const bars = data.labels.flatMap((label, group) => data.series.map((series, seriesIndex) => {
    const value = series.values[group] ?? null;
    const barHeight = value === null ? 0 : Math.max(1, Math.round(baseline - y(value)));
    return { label, series: series.label, seriesIndex, value, x: geometry.left + group * groupWidth + gap + seriesIndex * (width + gap),
      y: baseline - barHeight, width, height: barHeight, baseline };
  }));
  return { ...geometry, height, baseline, max, groupWidth, bars, y };
}
