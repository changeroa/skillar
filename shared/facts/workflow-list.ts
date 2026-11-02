import { compareSql, type FactContext } from "./base.js";
import { executionEventScope } from "./execution.js";
import type { FactStore, FlowListQuery, FlowListRow } from "./types.js";

export function listFlows(ctx: FactContext, q: FlowListQuery, outside: FactStore["outsideHerdrSessions"]): FlowListRow[] {
  const to = q.to ?? ctx.now() + 1;
  const unlinked = outside({ from: q.from ?? to - 7 * 86_400_000, to, limit: 100, automated: q.automated ?? "exclude" });
  const flows = ctx.table("flows"), workspaces = ctx.table("herdr_workspaces"), specs = ctx.table("workflow_specs");
  const entries: FlowListRow[] = flows.map(f => {
    const spec = specs.find(s => s.id === f.spec_id);
    return { id: f.id, kind: "flow", workspaceId: f.workspace_id ?? "", tabId: f.tab_id,
      label: f.label ?? workspaces.find(w => w.id === f.workspace_id)?.label ?? null,
      orderMs: f.registered_ms ?? 0, startedMs: f.registered_ms, endedMs: f.ended_ms,
      spec: spec ? { id: spec.id, name: spec.name, version: spec.version ?? 1 } : null, paneIds: [], links: [] };
  });
  entries.push(...workspaces.filter(w => !flows.some(f => f.workspace_id === w.id)).map(w => ({
    id: w.id, kind: "workspace" as const, workspaceId: w.id, tabId: null, label: w.label,
    orderMs: w.created_ms ?? 0, startedMs: w.created_ms, endedMs: w.closed_ms, spec: null, paneIds: [], links: [],
  })));
  if (unlinked[0] !== undefined) entries.push({
    id: "outside", kind: "outside_herdr", workspaceId: "", tabId: null, label: "outside herdr",
    orderMs: unlinked[0].activityMs, startedMs: unlinked[0].activityMs, endedMs: null, spec: null, paneIds: [],
    links: unlinked.map(s => ({ paneId: "", sessionId: s.id, source: "unlinked" })),
  });
  return entries.filter(r => (q.from === undefined || r.orderMs >= q.from) && (q.to === undefined || r.orderMs < q.to) &&
    (!q.cursor || r.orderMs < q.cursor.orderMs || r.orderMs === q.cursor.orderMs && compareSql(r.id, q.cursor.id) > 0))
    .sort((a, b) => b.orderMs - a.orderMs || compareSql(a.id, b.id))
    .slice(0, Math.max(1, Math.min(1000, Math.floor(q.limit)))).map(row => {
      if (row.kind === "outside_herdr") return row;
      if (row.kind === "flow") {
        const flow = flows.find(f => f.id === row.id);
        if (flow) {
          const execution = executionEventScope(ctx, { ...flow, workspace_id: row.workspaceId }, [], false);
          return { ...row, paneIds: execution.paneIds, links: execution.links.map(l => ({
            paneId: l.paneId, sessionId: l.sessionId, source: l.source,
          })) };
        }
      }
      const paneIds = ctx.table("herdr_panes").filter(p => p.workspace_id === row.workspaceId)
        .sort((a, b) => compareSql(a.created_ms, b.created_ms) || compareSql(a.id, b.id)).map(p => p.id);
      const links = ctx.table("pane_sessions").filter(l => paneIds.includes(l.pane_id))
        .sort((a, b) => compareSql(a.first_seen_ms, b.first_seen_ms) || compareSql(a.agent_session_value, b.agent_session_value))
        .map(l => ({ paneId: l.pane_id, sessionId: l.session_id, source: l.source }));
      return { ...row, paneIds, links };
    });
}
