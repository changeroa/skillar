import { loadSessions, localDowHour } from "./selection.js";
import { compareSql, eventOrder, sourceOrder, parseJson, skillMeta, metaFor, type FactContext } from "./base.js";
import type { Filter, HeatmapDto, SkillWeekDto, RuntimeId, FactStore } from "./types.js";
const DAY_MS=86_400_000; const WEEK_MS=7*DAY_MS;
const RUNTIMES: RuntimeId[] = ["claude-code","codex","gemini","cursor","omo","gajae","openclaw","unknown"];
function isoWeekStart(ts: number): number {
  const d = new Date(ts);
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - mondayOffset * DAY_MS;
}
function isoWeekLabel(weekStart: number): string {
  const thursday = new Date(weekStart + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week1 = isoWeekStart(Date.UTC(year, 0, 4));
  const week = 1 + Math.round((weekStart - week1) / WEEK_MS);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
export function createAggregates(ctx: FactContext): Pick<FactStore,"heatmap"|"skillWeek"|"stats"> {
return { heatmap(f: Filter, tz: string, weekStart: 0 | 1, bucketHours: 1 | 2 | 4): HeatmapDto {
      const buckets = 24 / bucketHours;
      const grid = Array.from({ length: 7 }, () => new Array<number>(buckets).fill(0));
      for (const s of loadSessions(ctx, f, true)) {
        const { dow, hour } = localDowHour(s.startedAt, tz);
        grid[dow]![Math.floor(hour / bucketHours)]! += 1;
      }
      const cells: HeatmapDto["cells"] = [];
      for (let i = 0; i < 7; i++) {
        const dow = (weekStart + i) % 7;
        for (let b = 0; b < buckets; b++) cells.push({ dow, hour: b * bucketHours, count: grid[dow]![b]! });
      }
      const rowTotals = grid.map((row) => row.reduce((a, n) => a + n, 0));
      const colTotals = Array.from({ length: buckets }, (_, b) => grid.reduce((a, row) => a + row[b]!, 0));
      return { tz, weekStart, bucketHours, cells, rowTotals, colTotals };
    }, skillWeek(f: Filter): SkillWeekDto {
      const lastWeek = isoWeekStart(f.to !== undefined ? f.to - 1 : ctx.now());
      const starts = Array.from({ length: 8 }, (_, i) => lastWeek - (7 - i) * WEEK_MS);
      const from = starts[0]!;
      const to = lastWeek + WEEK_MS;
      const rows = ctx.table("events").filter((e): e is typeof e & { skill_uri: string } => e.kind === "load" && e.skill_uri !== null
        && e.ts >= from && e.ts < to && (!f.runtime?.length || f.runtime.includes(e.runtime))
        && (!f.skill?.length || f.skill.includes(e.skill_uri)));
      rows.sort(f.skill?.length ? (a, b) => compareSql(a.skill_uri, b.skill_uri) || sourceOrder(a, b) : eventOrder);
      const skills = skillMeta(ctx);
      const counts = new Map<string, number[]>();
      for (const r of rows) {
        const idx = Math.floor((r.ts - from) / WEEK_MS);
        const arr = counts.get(r.skill_uri) ?? new Array<number>(8).fill(0);
        arr[idx]! += 1;
        counts.set(r.skill_uri, arr);
      }
      const out = [...counts.entries()]
        .map(([uri, c]) => ({ uri, name: metaFor(skills, uri).name, counts: c }))
        .sort((a, b) => b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0) || a.name.localeCompare(b.name));
      return { weeks: starts.map(isoWeekLabel), rows: out };
    },
  stats(f: Filter = {}) {
    const events = ctx.table("events");
    const attributionRate = Object.fromEntries(RUNTIMES.map(r => [r, null])) as Record<RuntimeId,number|null>;
    const runtimes = [...new Set(events.map(e => e.runtime))].sort(compareSql);
    for (const runtime of runtimes) {
      const mcp = events.filter(e => e.runtime === runtime && e.source === "mcp");
      if(mcp.length) attributionRate[runtime] = mcp.filter(e => e.session_id !== "unattributed").length/mcp.length;
    }
    const orphan = events.filter(e => e.source === "mcp" && e.session_id === "unattributed"
      && (f.from === undefined || e.ts >= f.from) && (f.to === undefined || e.ts < f.to)
      && (!f.runtime?.length || f.runtime.includes(e.runtime)));
    const searches = events.filter(e => e.kind === "search");
    const abstained = searches.filter(e => parseJson<Record<string,unknown>>(e.data_json,{}).abstained).length;
    const cutoff = ctx.now() - 56*DAY_MS;
    const used = new Set(events.filter(e => e.kind === "load" && e.skill_uri !== null && e.ts >= cutoff).map(e => e.skill_uri));
    const unused = ctx.table("skills").filter(s => s.removed_at === null && !used.has(s.uri)).sort((a,b) => compareSql(a.name,b.name));
    const last = events.reduce<number | null>((value, e) => value === null ? e.ts : Math.max(value, e.ts), null);
    return { attributionRate, abstainRate: searches.length ? abstained/searches.length : 0,
      unusedSkills: unused.map(s => s.uri), ...(last !== null ? {lastEventTs: last} : {}),
      lastEventByRuntime: Object.fromEntries(runtimes.map(r => [r, events.filter(e => e.runtime === r).reduce((ts, e) => Math.max(ts, e.ts), -Infinity)])),
      ingest: { accepted: ctx.runtime.ingest.accepted, rejected: ctx.runtime.ingest.rejected, dropped: ctx.runtime.ingest.dropped,
        ...(ctx.runtime.ingest.lastError ? { lastError: { ...ctx.runtime.ingest.lastError } } : {}) },
      unattributed: {searches: orphan.filter(e => e.kind === "search").length, loads: orphan.filter(e => e.kind === "load").length},
      automatedSessions: loadSessions(ctx,{...f,automated:"only"}).length };
  }
}; }
