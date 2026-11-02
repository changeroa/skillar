import { compareSql, eventOrder, parseJson, sourceOrder, type FactContext } from "./base.js";
import type { FactStore, SessionRef, SkillEntry } from "./types.js";
import { reconcileLoads } from "./reconciliation.js";

export function createLookups(ctx: FactContext): Pick<FactStore, "getLoad" | "latestLoad" | "traceSession" |
  "hasSourceKey" | "findEventByToolUseId" | "openSessions" | "evalCases" | "reconcileLoads"> {
  return {
    getLoad(loadId) {
      const row = ctx.table("loads").find(l => l.load_id === loadId);
      return row ? { uri: row.uri, manifestDigest: row.manifest_digest,
        resources: parseJson<SkillEntry["resources"]>(row.resources_json, []) } : undefined;
    },
    latestLoad(uri) {
      return ctx.table("loads").filter(l => l.uri === uri)
        .sort((a, b) => b.created_at - a.created_at || sourceOrder(b, a))[0]?.load_id;
    },
    traceSession(traceId) {
      return ctx.table("events").filter(e => e.trace_id === traceId && e.session_id !== "unattributed").sort(eventOrder)[0]?.session_id;
    },
    hasSourceKey: sourceKey => ctx.table("events").some(e => e.source_key === sourceKey),
    findEventByToolUseId(toolUseId) {
      return ctx.table("events").filter(e => e.tool_use_id === toolUseId).sort((a, b) => eventOrder(b, a))[0]?.id;
    },
    openSessions(runtime, since) {
      const events = ctx.table("events");
      return ctx.table("sessions").filter(s => s.runtime === runtime && s.ended_at === null)
        // Local SQLite's GROUP BY sorter uses descending BINARY keys beside ORDER BY last_activity DESC.
        .sort((a, b) => compareSql(b.id, a.id)).map(s => {
          const ref: SessionRef = { runtime: s.runtime };
          if (s.runtime_session_id !== null) ref.runtimeSessionId = s.runtime_session_id;
          if (s.conversation_id !== null) ref.conversationId = s.conversation_id;
          if (s.client_name !== null) ref.clientName = s.client_name;
          if (s.cwd !== null) ref.cwd = s.cwd;
          const lastActivityAt = events.filter(e => e.session_id === s.id).reduce((max, e) => Math.max(max, e.ts), s.started_at);
          return { id: s.id, startedAt: s.started_at, lastActivityAt, ref };
        }).filter(s => s.lastActivityAt >= since).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    },
    evalCases() {
      return ctx.table("eval_cases").sort((a, b) => a.created_at - b.created_at || sourceOrder(a, b))
        .map(r => r.expected_uri === null ? { query: r.query } : { query: r.query, expectedUri: r.expected_uri });
    },
    reconcileLoads: opts => reconcileLoads(ctx, opts),
  };
}
