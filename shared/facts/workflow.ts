import { compareSql, eventOrder, nameFromUri, parseJson, type FactContext, type Tables } from "./base.js";
import { executionEventScope } from "./execution.js";
import type { FactStore, WorkflowSpec, WorkflowSpecRow } from "./types.js";
import { listFlows } from "./workflow-list.js";

function specOf(row: Tables["workflow_specs"]): WorkflowSpecRow {
  return { id: row.id, name: row.name, version: row.version, digest: row.digest, createdMs: row.created_ms,
    spec: parseJson<WorkflowSpec>(row.body_json, { name: "unknown", steps: [] }) };
}

export function createWorkflowReads(ctx: FactContext, outside: FactStore["outsideHerdrSessions"]): Pick<FactStore,
  "workflowSpecs" | "workflowSpecVersions" | "workflowSpec" | "getFlow" | "flowSteps" | "listFlows" |
  "flowSessionIds" | "flowEventScope" | "flowUnattributedLoads" | "flowPaneUsage"> {
  const reads: ReturnType<typeof createWorkflowReads> = {
    workflowSpecs() {
      const specs = ctx.table("workflow_specs");
      return specs.filter(s => !specs.some(other => other.name === s.name && other.version > s.version))
        .sort((a, b) => compareSql(a.name, b.name)).map(specOf);
    },
    workflowSpecVersions(name) {
      return ctx.table("workflow_specs").filter(s => s.name === name).sort((a, b) => b.version - a.version).map(specOf);
    },
    workflowSpec(name, version) {
      return reads.workflowSpecVersions(name).find(s => version === undefined || s.version === version);
    },
    getFlow(id) {
      const row = ctx.table("flows").find(f => f.id === id);
      if (!row) return undefined;
      const spec = ctx.table("workflow_specs").find(s => s.id === row.spec_id);
      return { id: row.id, workspaceId: row.workspace_id ?? "", registeredMs: row.registered_ms ?? 0,
        ...(row.tab_id !== null ? { tabId: row.tab_id } : {}), ...(row.label !== null ? { label: row.label } : {}),
        ...(row.ended_ms !== null ? { endedMs: row.ended_ms } : {}), ...(spec ? { spec: specOf(spec) } : {}) };
    },
    flowSteps(flowId) {
      return ctx.table("flow_steps").filter(s => s.flow_id === flowId)
        .sort((a, b) => compareSql(a.registered_ms, b.registered_ms) || compareSql(a.pane_id, b.pane_id))
        .map(r => ({ paneId: r.pane_id, stepId: r.step_id, registeredMs: r.registered_ms ?? 0 }));
    },
    listFlows: q => listFlows(ctx, q, outside),
    flowSessionIds(flowId, scope) {
      const members = scope ?? reads.flowEventScope(flowId);
      return [...new Set(members?.links.flatMap(l => l.sessionId === null ? [] : [l.sessionId]))].sort();
    },
    flowEventScope(flowId) {
      const flow = ctx.table("flows").find(f => f.id === flowId);
      return flow ? executionEventScope(ctx, { ...flow, workspace_id: flow.workspace_id ?? "" }) : undefined;
    },
    flowUnattributedLoads(flowId, sessionIds, supplied) {
      const flow = ctx.table("flows").find(f => f.id === flowId);
      const scope = supplied ?? (flow ? executionEventScope(ctx, { ...flow, workspace_id: flow.workspace_id ?? "" }, sessionIds) : undefined);
      if (!scope) return { count: 0, uris: [] };
      const candidates = new Set(ctx.table("load_candidates").filter(c => sessionIds.includes(c.session_id)).map(c => c.load_id));
      const rows = ctx.table("events").filter(e => scope.eventIds.includes(e.id) && e.kind === "load" && e.source === "mcp" &&
        e.session_id === "unattributed" && e.attribution_reason === "ambiguous" && e.skill_uri !== null && candidates.has(e.id));
      return { count: rows.length, uris: [...new Set(rows.flatMap(e => e.skill_uri === null ? [] : [e.skill_uri]))].sort() };
    },
    flowPaneUsage(flowId, opts = {}) {
      const members = opts.scope ?? reads.flowEventScope(flowId);
      if (!members) return [];
      const eventIds = new Set(members.eventIds);
      const events = ctx.table("events").filter(e => eventIds.has(e.id)).sort(eventOrder);
      return members.paneIds.map(paneId => {
        const skills: string[] = [], tools: string[] = [];
        const sessions = new Set(members.links.filter(l => l.paneId === paneId).flatMap(l => l.sessionId === null ? [] : [l.sessionId]));
        for (const sessionId of sessions) {
          if (opts.excludeSessions?.includes(sessionId)) continue;
          for (const e of events.filter(e => e.session_id === sessionId)) {
            const data = parseJson<Record<string, unknown>>(e.data_json, {});
            if (e.kind === "load" || e.kind === "native_skill") {
              const uri = e.skill_uri ?? (typeof data.uri === "string" ? data.uri : undefined);
              const name = e.kind === "native_skill" && typeof data.name === "string" && data.name !== "" ? data.name :
                uri === undefined ? undefined : nameFromUri(uri);
              if (name !== undefined && !skills.includes(name)) skills.push(name);
            }
            if (e.kind === "tool_call") {
              const name = [data.name, data.tool, data.toolName].find(v => typeof v === "string" && v !== "");
              if (typeof name === "string" && !tools.includes(name)) tools.push(name);
            }
          }
        }
        return { paneId, skills, tools };
      });
    },
  };
  return reads;
}
