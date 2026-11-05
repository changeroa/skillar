export type BarGroup = { readonly label: string; readonly values: readonly number[] };

export function barGeometry(groups: readonly BarGroup[]) {
  const maximum = Math.max(1, ...groups.flatMap(group => group.values));
  const series = Math.max(1, ...groups.map(group => group.values.length));
  const width = 14, gap = 4, slot = Math.max(56, series * (width + gap) + 16), baseline = 130;
  return { maximum, baseline, chartWidth: Math.max(280, groups.length * slot + 48), bars: groups.flatMap((group, index) =>
    group.values.map((value, seriesIndex) => {
      const height = value === 0 ? 1 : value / maximum * 96;
      return { value, group: index, series: seriesIndex, label: group.label, baseline, width, height, y: baseline - height,
        x: 32 + index * slot + seriesIndex * (width + gap), center: 32 + index * slot + (series * width + (series - 1) * gap) / 2 };
    })) };
}

export function Bars({ title, groups, labels }: { readonly title: string; readonly groups: readonly BarGroup[]; readonly labels: readonly string[] }) {
  const geometry = barGeometry(groups);
  return <figure class="analysis-chart">
    <figcaption class="sr-only">{title}</figcaption>
    <div class="analysis-scroll" tabIndex={0} role="region" aria-label={`${title} 차트`}>
      <svg width={geometry.chartWidth} height="172" role="img" aria-label={`${title} · ${labels.join(", ")}`}>
        <line data-zero-baseline x1="24" x2={geometry.chartWidth} y1={geometry.baseline} y2={geometry.baseline} stroke="var(--line-2)" />
        <text x="8" y={geometry.baseline + 4}>0</text><text x="0" y="26">{geometry.maximum}</text>
        {geometry.bars.map(bar => <g key={`${bar.group}-${bar.series}`} data-bar data-baseline={bar.baseline} data-value={bar.value}>
          <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={bar.series === 1 ? "var(--accent)" : "var(--ink-2)"}><title>{bar.label} · {labels[bar.series]} {bar.value}</title></rect>
          <text x={bar.x + bar.width / 2} y={bar.y - 5} text-anchor="middle">{bar.value}</text>
          {bar.series === 0 && <text data-axis-label x={bar.center} y="156" text-anchor="middle">{bar.label}</text>}
        </g>)}
      </svg>
    </div>
    <div class="analysis-legend">{labels.map((label, index) => <span key={label}><i class={`analysis-key${index === 1 ? " analysis-key--read" : ""}`} />{label}</span>)}</div>
  </figure>;
}
