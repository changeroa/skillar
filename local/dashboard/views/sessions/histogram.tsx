import type { Filter } from "../../../src/types.js";
import type { SessionListRow } from "../../api";
import { kstDay } from "../../time";

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
  const stride = Math.max(1, Math.ceil(bars.length / 6));
  return <figure class="session-histogram" aria-labelledby="session-histogram-title">
    <figcaption id="session-histogram-title">일별 세션 <span class="pe-muted">· 한국 시간 · 수신된 기간</span></figcaption>
    <div class="session-histogram__plot">
      <svg width="100%" height="112" role="img" aria-label={`일별 세션 ${rows.length}개`} style={`min-width:${Math.max(280, bars.length * 14)}px`}>
        <line x1="3%" x2="99%" y1="82" y2="82" stroke="var(--line-2)" />
        <text x="0" y="86">0</text>
        {bars.map((bar, index) => <g key={bar.date} data-count={bar.count} data-baseline={bar.baseline}>
          <rect x={`${bar.x}%`} width={`${bar.width}%`} y={bar.y} height={bar.height} fill={bar.count ? "var(--ink-2)" : "var(--line-2)"}>
            <title>{bar.date}: {bar.count}</title>
          </rect>
          <text x={`${bar.x + bar.width / 2}%`} y={bar.y - 5} text-anchor="middle">{bar.count}</text>
          {(index % stride === 0 || index === bars.length - 1) && <text x={`${bar.x + bar.width / 2}%`} y="105" text-anchor="middle">{bar.date.slice(5)}</text>}
        </g>)}
      </svg>
    </div>
  </figure>;
}
