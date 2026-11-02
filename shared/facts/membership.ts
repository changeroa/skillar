import { automationOf, NO_ACTIVITY } from "./automation.js";
import { compareSql, parseJson, sqlRow, type FactContext } from "./base.js";
import { loadSessions } from "./selection.js";
import type { FactStore } from "./types.js";

export function createMembership(ctx: FactContext): Pick<FactStore,
  "sessions" | "sessionAutomation" | "outsideHerdrSessions" | "outsideHerdrSessionIds"> {
  const queries: Pick<FactStore, "sessions" | "sessionAutomation" | "outsideHerdrSessions" | "outsideHerdrSessionIds"> = {
    sessions(f) {
      return loadSessions(ctx, f).sort((a, b) => b.startedAt - a.startedAt).map(s => ({
        id: s.id, runtime: s.runtime, startedAt: s.startedAt, requests: s.requests,
        skills: s.loaded.length > 0 ? s.loaded : s.firstTop ? [s.firstTop] : [],
        state: s.state, attribution: s.attribution,
        ...(s.endedAt !== undefined ? { endedAt: s.endedAt } : {}),
        ...(s.firstPrompt !== undefined ? { firstPrompt: s.firstPrompt } : {}),
        ...(s.automated !== undefined ? { automated: s.automated } : {}),
      }));
    },
    sessionAutomation(ids) {
      const active = new Set<string>();
      const wanted = new Set(ids);
      for (const e of ctx.table("events").filter(e => wanted.has(e.session_id))) {
        const data = parseJson<Record<string, unknown>>(e.data_json, {});
        const counts = e.kind === "search" ? Array.isArray(data.candidates) && data.candidates.length > 0
          : e.kind === "load" ? e.skill_uri !== null || typeof data.uri === "string"
          : ["prompt", "native_skill", "read_file"].includes(e.kind);
        if (counts) active.add(e.session_id);
      }
      const out: Record<string, string> = {};
      for (const row of ctx.table("sessions").filter(s => wanted.has(s.id))) {
        const automated = automationOf(row.first_prompt ?? undefined) ?? (active.has(row.id) ? undefined : NO_ACTIVITY);
        if (automated !== undefined) out[row.id] = automated;
      }
      return out;
    },
    outsideHerdrSessions({ from, to, limit, automated }) {
      const linked = new Set(ctx.table("pane_sessions").filter(l => (l.source ?? "") !== "unlinked").map(l => l.session_id));
      const latest = new Map<string, number>();
      for (const e of ctx.table("events")) latest.set(e.session_id, Math.max(latest.get(e.session_id) ?? e.ts, e.ts));
      const rows = ctx.table("sessions").filter(s => !linked.has(s.id)).map(s => sqlRow({
        id: s.id, activityMs: Math.max(s.started_at, s.ended_at ?? s.started_at, latest.get(s.id) ?? s.started_at),
      })).filter(s => s.activityMs >= from && s.activityMs < to)
        .sort((a, b) => b.activityMs - a.activityMs || compareSql(a.id, b.id));
      const automation = automated === "include" ? {} : queries.sessionAutomation(rows.map(s => s.id));
      return rows.filter(s => automated === "include" ||
        (automated === "only" ? automation[s.id] !== undefined : automation[s.id] === undefined))
        .slice(0, Math.max(1, Math.min(100, Math.floor(limit))));
    },
    outsideHerdrSessionIds({ from, to, limit }) {
      const linked = new Set(ctx.table("pane_sessions").map(l => l.session_id));
      return ctx.table("sessions").filter(s => s.started_at >= from && s.started_at < to && !linked.has(s.id))
        .sort((a, b) => b.started_at - a.started_at || compareSql(a.id, b.id))
        .slice(0, Math.max(1, Math.min(100, Math.floor(limit)))).map(s => s.id);
    },
  };
  return queries;
}
