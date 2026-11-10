import type { Filter } from "../../../src/types.js";
import type { SessionListRow } from "../../api";
import { kstDay } from "../../time";
import { Histogram } from "../../foundation/widgets/charts";

const DAY = 86_400_000;
export function histogramBars(rows: readonly Pick<SessionListRow, "startedAt">[], from?: number, to?: number) {
  if (rows.length === 0 && (from === undefined || to === undefined)) return [];
  const first = kstDay(from ?? Math.min(...rows.map(row => row.startedAt)));
  const last = kstDay(to === undefined ? Math.max(...rows.map(row => row.startedAt)) : to - 1);
  const counts = Array.from({ length: Math.max(0, last - first + 1) }, () => 0);
  for (const row of rows) {
    const index = kstDay(row.startedAt) - first;
    if (index >= 0 && index < counts.length) counts[index]++;
  }
  const maximum = Math.max(1, ...counts), baseline = 82, slot = 92 / counts.length;
  return counts.map((count, index) => {
    const height = count === 0 ? 1 : Math.max(1, Math.round(count / maximum * 60));
    return { count, baseline, height, y: baseline - height, x: 5 + index * slot,
      width: slot * .58, date: new Date((first + index) * DAY).toISOString().slice(0, 10) };
  });
}

export function SessionHistogram({ rows, filter }: { readonly rows: readonly SessionListRow[]; readonly filter: Filter }) {
  const bars = histogramBars(rows, filter.from, filter.to);
  if (!bars.length) return null;
  return <Histogram title={`일별 세션 ${rows.length}개 · KST · 수신된 기간`}
    labels={bars.map(bar => `${bar.date}\nKST`)} values={bars.map(bar => bar.count)} height={160} />;
}
