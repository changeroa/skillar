import { BarChart } from "../foundation/widgets/charts";

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
  return <BarChart title={title} data={{
    labels: groups.map(group => group.label),
    series: labels.map((label, index) => ({ label, values: groups.map(group => group.values[index] ?? null) })),
  }} />;
}
