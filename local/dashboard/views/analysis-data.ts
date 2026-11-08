import { requestRecords, type RequestRecord } from "../../src/request-status.js";
import type { Filter, HeatmapDto, SkillWeekDto, TraceStep } from "../../src/types.js";
import { api, type SessionListRow } from "../api";
import { skillName } from "../state";
import { DAY_MS, kstDay, kstIsoWeek, kstWeekStart } from "../time";

export function traceRequests(steps: readonly TraceStep[]) {
  return requestRecords(steps.map((step, index) => ({ id: `event-${index}`, ts: step.ts, kind: step.kind, data: step.detail })));
}

export async function observedRequests(rows: readonly SessionListRow[]) {
  const results: { readonly session: string; readonly events: number; readonly requests: readonly RequestRecord[] }[] = [];
  const failed: string[] = [];
  const queue = [...rows];
  // Bound trace reads so opening analysis cannot saturate a local daemon.
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try { const steps = await api.trace(row.id); results.push({ session: row.id, events: steps.length, requests: traceRequests(steps) }); }
      catch { failed.push(row.id); }
    }
  }));
  return { results, failed };
}

export function sessionsHeatmap(rows: readonly Pick<SessionListRow, "startedAt">[], tz: string, weekStart: 0 | 1): HeatmapDto {
  const cells = Array.from({ length: 7 }, (_, dow) => Array.from({ length: 24 }, (_, hour) => ({ dow, hour, count: 0 })));
  const format = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const row of rows) {
    const parts = format.formatToParts(row.startedAt);
    const dow = weekdays.indexOf(parts.find(part => part.type === "weekday")?.value ?? "");
    const hour = Number(parts.find(part => part.type === "hour")?.value);
    const cell = cells[dow]?.[hour];
    if (cell) cell.count++;
  }
  return { tz, weekStart, bucketHours: 1, cells: cells.flat(), rowTotals: cells.map(row => row.reduce((sum, cell) => sum + cell.count, 0)),
    colTotals: Array.from({ length: 24 }, (_, hour) => cells.reduce((sum, row) => sum + (row[hour]?.count ?? 0), 0)) };
}

export function requestSeries(records: readonly RequestRecord[], filter: Filter) {
  const timestamps = records.flatMap(record => {
    const ts = record.startedAt ?? record.endedAt;
    return ts === undefined ? [] : [ts];
  });
  if (!timestamps.length) return [];
  const first = kstDay(filter.from ?? Math.min(...timestamps));
  const last = kstDay(filter.to === undefined ? Math.max(...timestamps) : filter.to - 1);
  const buckets = Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => ({ label: new Date((first + index) * DAY_MS).toISOString().slice(5, 10), values: [0, 0] }));
  for (const record of records) {
    const ts = record.startedAt ?? record.endedAt;
    if (ts === undefined) continue;
    const bucket = buckets[kstDay(ts) - first];
    if (bucket) bucket.values[record.operation === "search" ? 0 : 1]++;
  }
  return buckets;
}

export function requestsInRange(records: readonly RequestRecord[], filter: Filter) {
  return records.filter(record => {
    const ts = record.startedAt ?? record.endedAt;
    return ts !== undefined && (filter.from === undefined || ts >= filter.from) && (filter.to === undefined || ts < filter.to);
  });
}

export function requestsSkillWeek(records: readonly RequestRecord[], skills?: readonly string[]): SkillWeekDto {
  const reads = records.flatMap(record => {
    const ts = record.startedAt ?? record.endedAt;
    if (record.operation !== "load" || record.status !== "succeeded" || !record.uri || ts === undefined || skills?.length && !skills.includes(record.uri)) return [];
    return [{ uri: record.uri, week: kstIsoWeek(ts), start: kstWeekStart(ts) }];
  });
  const first = reads.length ? Math.min(...reads.map(read => read.start)) : 0;
  const last = reads.length ? Math.max(...reads.map(read => read.start)) : 0;
  const weeks = reads.length ? Array.from({ length: 1 + Math.round((last - first) / (7 * DAY_MS)) }, (_, index) => kstIsoWeek(first + index * 7 * DAY_MS)) : [];
  const rows = [...new Set(reads.map(read => read.uri))].sort().map(uri => ({
    uri, name: skillName(uri), counts: weeks.map(week => reads.filter(read => read.uri === uri && read.week === week).length),
  }));
  return { weeks, rows };
}

export function durationDistribution(rows: readonly Pick<SessionListRow, "startedAt" | "endedAt">[]) {
  const values = rows.flatMap(row => row.endedAt === undefined ? [] : [row.endedAt - row.startedAt]);
  const bounds = [0, 10, 20, 30, 40, 50];
  return { values, groups: bounds.map((minutes, index) => ({
    label: index === bounds.length - 1 ? "50분+" : `${minutes}–${minutes + 10}분`,
    values: [values.filter(ms => ms >= minutes * 60000 && (index === bounds.length - 1 || ms < (minutes + 10) * 60000)).length],
  })) };
}
