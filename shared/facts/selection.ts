import { requestRecords, summarizeRequests, hasStatus, type RequestRecord, type RequestSummary } from "./request-status.js";
import { automationOf, NO_ACTIVITY } from "./automation.js";
import { compareSql, parseJson, storeError, eventOrder, sourceOrder, type Event as EvRow, type FactContext } from "./base.js";
import type { AdoptionState, Attribution, Candidate, EventKind, Filter, RuntimeId, SkillUri } from "./types.js";
export type SessionInfo = {
  id: string; runtime: RuntimeId; startedAt: number; endedAt?: number; firstPrompt?: string; events: EvRow[];
  loaded: SkillUri[]; exposed: SkillUri[]; firstTop?: SkillUri; state: AdoptionState; attribution: Attribution["method"]; texts: string[];
  automated?: string; requests: RequestSummary; requestRecords: RequestRecord[];
};
const fmtCache = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
export function localDowHour(ts: number, tz: string): { dow: number; hour: number } {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" });
    } catch {
      throw storeError("invalid_tz", `unknown time zone: ${tz}`);
    }
    fmtCache.set(tz, fmt);
  }
  let dow = 0;
  let hour = 0;
  for (const p of fmt.formatToParts(ts)) {
    if (p.type === "weekday") dow = WEEKDAYS[p.value] ?? 0;
    else if (p.type === "hour") hour = Number(p.value) % 24;
  }
  return { dow, hour };
}
function candidatesOf(data: Record<string, unknown>): Candidate[] {
  return Array.isArray(data.candidates) ? (data.candidates as Candidate[]) : [];
}
export function adoptionState(events: { kind: EventKind; data: Record<string, unknown> }[]): AdoptionState {
  if (events.some((e) => e.kind === "load")) return "loaded";
  const searches = events.filter((e) => e.kind === "search");
  if (searches.some((e) => candidatesOf(e.data).length >= 1)) return "exposed_only";
  if (searches.some((e) => e.data.abstained !== undefined && e.data.abstained !== null)) return "no_match";
  const firstSearch = events.findIndex((e) => e.kind === "search");
  if (firstSearch >= 0 && events.slice(firstSearch + 1).some((e) => e.kind === "error")) return "aborted";
  return "not_used";
}
function automationIdOf(firstPrompt: string | undefined, active: boolean): string | undefined {
  return automationOf(firstPrompt) ?? (active ? undefined : NO_ACTIVITY);
}
export function loadSessions(ctx: FactContext, f: Filter, ignoreCellFilter = false): SessionInfo[] {
    const rows = ctx.table("sessions").filter(r => (f.from === undefined || r.started_at >= f.from)
      && (f.to === undefined || r.started_at < f.to) && (!f.runtime?.length || f.runtime.includes(r.runtime)));
    // The local query scans sessions_runtime_started, sessions_started, or the rowid table, respectively.
    if (f.runtime?.length) rows.sort((a,b) => compareSql(a.runtime,b.runtime) || a.started_at-b.started_at || sourceOrder(a,b));
    else if (f.from !== undefined || f.to !== undefined) rows.sort((a,b) => a.started_at-b.started_at || sourceOrder(a,b));
    const ids = new Set(rows.map(r => r.id));
    const events = ctx.table("events").filter(e => ids.has(e.session_id) && e.kind !== "llm_call" && e.kind !== "tool_call").sort(eventOrder);
    const bySession = new Map<string, EvRow[]>();
    for (const e of events) {
      const list = bySession.get(e.session_id);
      if (list) list.push(e); else bySession.set(e.session_id, [e]);
    }
    const tz = f.tz ?? ctx.tz;
    const out: SessionInfo[] = [];
    for (const r of rows) {
      const evs = bySession.get(r.id) ?? [];
      const parsed = evs.map((e) => ({ kind: e.kind, data: parseJson<Record<string, unknown>>(e.data_json, {}) }));
      const loaded: SkillUri[] = [];
      const exposed: SkillUri[] = [];
      let firstTop: SkillUri | undefined;
      const texts: string[] = [];
      evs.forEach((e, i) => {
        const data = parsed[i]!.data;
        if (e.kind === "load") {
          const uri = e.skill_uri ?? (typeof data.uri === "string" ? data.uri : undefined);
          if (uri && !loaded.includes(uri)) loaded.push(uri);
        } else if (e.kind === "search") {
          const cands = [...candidatesOf(data)].sort((a, b) => a.rank - b.rank);
          if (firstTop === undefined && cands[0]) firstTop = cands[0].uri;
          for (const c of cands) if (!exposed.includes(c.uri)) exposed.push(c.uri);
          if (typeof data.query === "string") texts.push(data.query);
        } else if (e.kind === "prompt" && e.text) texts.push(e.text);
      });
      const attributed = evs.find((e) => e.attribution_method !== "none");
      const records = requestRecords(evs.map((e, i) => ({ id: e.id, ts: e.ts, kind: e.kind, data: parsed[i]!.data, ...(e.skill_uri ? { skillUri: e.skill_uri } : {}) })), new Set(ctx.runtime.activeRequests));
      const requests = summarizeRequests(records);
      const info: SessionInfo = {
        requests, requestRecords: records,
        id: r.id, runtime: r.runtime as RuntimeId, startedAt: r.started_at, events: evs, loaded, exposed, state: adoptionState(parsed),
        attribution: attributed?.attribution_method ?? "none", texts,
        ...(r.ended_at !== null ? { endedAt: r.ended_at } : {}),
        ...(r.first_prompt !== null ? { firstPrompt: r.first_prompt } : {}),
        ...(firstTop !== undefined ? { firstTop } : {}),
      };
      // A session with no prompt and no skill activity (e.g. a thread the Codex daemon reopened) tells nothing about usage.
      const active = loaded.length > 0 || exposed.length > 0
        || evs.some((e) => e.kind === "prompt" || e.kind === "native_skill" || e.kind === "read_file" || e.kind === "skill_request" || e.kind === "search");
      const automated = automationIdOf(info.firstPrompt, active);
      if (automated !== undefined) info.automated = automated;
      if (f.automated === undefined && automated !== undefined) continue;
      if (f.automated === "only" && automated === undefined) continue;
      if (f.searchStatus?.length && !f.searchStatus.some((status) => hasStatus(requests.search, status))) continue;
      if (f.loadStatus?.length && !f.loadStatus.some((status) => hasStatus(requests.load, status))) continue;
      if (f.searchResult?.length && !f.searchResult.some((result) => requests.search.results[result] > 0)) continue;
      if (f.state && f.state.length > 0 && !f.state.includes(info.state)) continue;
      if (f.skill && f.skill.length > 0 && !f.skill.some((u) => loaded.includes(u) || exposed.includes(u) || records.some((r) => r.uri === u))) continue;
      if (f.q) {
        const q = f.q.toLowerCase();
        if (![info.firstPrompt ?? "", ...texts].some((t) => t.toLowerCase().includes(q))) continue;
      }
      if (!ignoreCellFilter && (f.dow !== undefined || f.hour !== undefined)) {
        const local = localDowHour(r.started_at, tz);
        if (f.dow !== undefined && local.dow !== f.dow) continue;
        if (f.hour !== undefined) {
          const span = f.hourSpan ?? 1;
          if (local.hour < f.hour || local.hour >= f.hour + span) continue;
        }
      }
      out.push(info);
    }
    return out;
  }
