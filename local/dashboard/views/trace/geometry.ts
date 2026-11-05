import type { TimelineItem } from "./plan";

export function ganttGeometry(items: readonly TimelineItem[], origin?: number, last?: number) {
  if (!items.length) return undefined;
  const intervals = items.map(item => {
    if (item.kind === "span") return { item, start: item.span.startedAt, end: item.span.endedAt };
    const { startedAt, endedAt } = item.step.detail;
    return typeof startedAt === "number" && typeof endedAt === "number" && endedAt >= startedAt
      ? { item, start: startedAt, end: endedAt } : { item, start: item.step.ts, end: undefined };
  });
  const raw = intervals.filter(interval => interval.item.kind === "step");
  const window = last !== undefined && raw.length ? raw : intervals;
  const start = Math.min(origin ?? window[0].start, ...window.map(interval => interval.start));
  const end = Math.max(last ?? start, ...window.map(interval => interval.end ?? interval.start));
  const scale = end === start ? 1 : end - start;
  return { start, end, points: intervals.map(interval => ({
    key: interval.item.key, offsetMs: interval.start - (origin ?? start),
    x: (interval.start - start) / scale * 100,
    width: interval.end === undefined ? 0 : (interval.end - interval.start) / scale * 100,
    bounded: interval.end !== undefined,
    outside: interval.start < start || (interval.end ?? interval.start) > end,
  })) };
}

export function ganttViewport(graph: NonNullable<ReturnType<typeof ganttGeometry>>, zoom: number, position: number) {
  const width = (graph.end - graph.start) / zoom;
  const start = graph.start + position * (graph.end - graph.start - width);
  const left = position * (100 - 100 / zoom);
  return { start, end: start + width, left, width: 100 / zoom,
    points: graph.points.map(point => {
      const x = (point.x - left) * zoom, end = x + point.width * zoom;
      return { ...point, inView: !point.outside && end >= 0 && x <= 100,
        x: Math.max(0, Math.min(100, x)),
        width: point.bounded ? Math.max(0, Math.min(100, end) - Math.max(0, x)) : 0 };
    }) };
}
