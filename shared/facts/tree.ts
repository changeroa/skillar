import { compareSql, eventOrder, parseJson, sqlRow, type FactContext } from "./base.js";
import { matchedSpans } from "./spans.js";
import { executionEventScope } from "./execution.js";
import type { TreeFlowData } from "../activity-analysis.js";
import type { FactStore } from "./types.js";

export function createTreeReads(ctx: FactContext): Pick<FactStore, "treeSessionData" | "treeFlowData"> {
  return {
    treeSessionData(sessionId, scope) {
      const session = ctx.table("sessions").find(s => s.id === sessionId);
      if (!session) return undefined;
      const owned = new Set(scope?.eventIds), prior = new Set(scope?.priorEventIds), spanKeys = new Set(scope?.spanKeys ?? []);
      const events = ctx.table("events").filter(e => e.session_id === sessionId).sort(eventOrder)
        .filter(e => !scope || e.ts < scope.from || e.ts === scope.from && e.kind === "prompt" && prior.has(e.id) || owned.has(e.id))
        .map(e => ({ id: e.id, ts: e.ts, kind: e.kind, source: e.source, turnKey: e.turn_key, callId: e.call_id,
          spanId: e.span_id, skillUri: e.skill_uri, text: e.text, textLength: e.text_length,
          data: parseJson<Record<string, unknown>>(e.data_json, {}) }));
      const spans = matchedSpans(ctx, [session]).filter(s => scope?.to == null || s.start_ms !== null && s.start_ms < scope.to ||
        spanKeys.has(JSON.stringify([s.trace_id, s.span_id])))
        .map(s => ({ traceId: s.trace_id, spanId: s.span_id, name: s.name, runtime: s.runtime, receivedAt: s.received_at,
          ...(s.parent_span_id !== null ? { parentSpanId: s.parent_span_id } : {}),
          ...(s.conversation_id !== null ? { conversationId: s.conversation_id } : {}),
          ...(s.turn_key !== null ? { turnKey: s.turn_key } : {}), ...(s.call_id !== null ? { callId: s.call_id } : {}),
          ...(s.start_ms !== null ? { startMs: s.start_ms } : {}), ...(s.end_ms !== null ? { endMs: s.end_ms } : {}) }));
      return { id: session.id, runtime: session.runtime, startedAt: session.started_at,
        endedAt: scope?.sessionEnds?.[sessionId] ?? session.ended_at, events, spans };
    },
    treeFlowData(id, scope) {
      const flow = ctx.table("flows").find(f => f.id === id);
      const workspaceId = flow?.workspace_id ?? id;
      const workspace = ctx.table("herdr_workspaces").find(w => w.id === workspaceId);
      if (!workspace) return undefined;
      const topology = (r: { id: string; label: string | null; created_ms: number | null; closed_ms: number | null }) =>
        sqlRow({ id: r.id, label: r.label, createdMs: r.created_ms, closedMs: r.closed_ms });
      const order = (a: { created_ms: number | null; id: string }, b: { created_ms: number | null; id: string }) =>
        compareSql(a.created_ms, b.created_ms) || compareSql(a.id, b.id);
      const allPanes = ctx.table("herdr_panes"), allTabs = ctx.table("herdr_tabs");
      if (flow) {
        const { paneIds, links } = scope ?? executionEventScope(ctx, flow);
        const panes = paneIds.flatMap(id => {
          const p = allPanes.find(p => p.id === id);
          return p ? [sqlRow({ ...topology(p), tabId: p.tab_id })] : [];
        });
        const tabs = [...new Set(panes.map(p => p.tabId))].flatMap(id => {
          const t = allTabs.find(t => t.id === id);
          return t ? [topology(t)] : [];
        });
        // Local SQL returns nullable tab_id verbatim despite the historical TreeFlowData declaration.
        return { id: flow.id, workspaceId, label: flow.label ?? workspace.label, registered: true, tabs, panes, links } as TreeFlowData;
      }
      const tabs = allTabs.filter(t => t.workspace_id === workspaceId).sort(order).map(topology);
      const panes = allPanes.filter(p => p.workspace_id === workspaceId).sort(order).map(p => sqlRow({ ...topology(p), tabId: p.tab_id }));
      const links = ctx.table("pane_sessions").filter(l => panes.some(p => p.id === l.pane_id))
        .sort((a, b) => compareSql(a.first_seen_ms, b.first_seen_ms) || compareSql(a.agent_session_value, b.agent_session_value))
        .map(l => sqlRow({ paneId: l.pane_id, sessionId: l.session_id, agentSessionValue: l.agent_session_value,
          source: l.source, firstSeenMs: l.first_seen_ms, lastSeenMs: l.last_seen_ms }));
      return { id: workspaceId, workspaceId, label: workspace.label, registered: false, tabs, panes, links } as TreeFlowData;
    },
  };
}
