import { createFactStore } from "../../../shared/activity-facts.ts";
import { buildFlows, buildFlowReport, buildSessionReport, buildSkillUsage } from "../../../shared/activity-reports.ts";
import type { ReportRequest } from "../../../shared/activity-query.ts";
import type { ContentRow } from "../../../shared/activity-content.ts";
import type { AnalysisRuntime } from "../../../shared/activity-runtime.ts";
import { ReportError } from "./report-types.ts";

/** Query assembly is shared with SQLite; this adapter supplies only pinned source facts and runtime state. */
export function executeReport(
  request: ReportRequest, rows: readonly ContentRow[], runtime: AnalysisRuntime, generatedAt: number,
) {
  const store = createFactStore(rows, { runtime, tz: request.tz, now: () => generatedAt });
  const query = request.query;
  switch (query.kind) {
    case "skills": return store.skills();
    case "workflow-versions": {
      const versions = store.workflowSpecVersions(query.name);
      if (versions.length === 0) throw new ReportError("spec_not_found", 404);
      return versions.map(row => ({
        id: row.id, name: row.name, version: row.version, digest: row.digest,
        createdMs: row.createdMs, steps: row.spec.steps,
      }));
    }
    case "sessions": return store.sessions(query.filter);
    case "trace": return store.trace(query.sessionId);
    case "flow": return store.flow(query.filter, query.unit, query.top);
    case "heatmap": return store.heatmap(query.filter, query.tz, query.weekStart, query.bucketHours);
    case "skill-week": return store.skillWeek(query.filter);
    case "stats": return store.stats(query.filter);
    case "flows": return buildFlows(store, query, generatedAt);
    case "flow-report": return buildFlowReport(store, query.flowId, query, generatedAt);
    case "session-report": return buildSessionReport(store, query.sessionId, query.automated, generatedAt);
    case "skill-usage": return buildSkillUsage(store, query, generatedAt);
    default: {
      const exhaustive: never = query;
      return exhaustive;
    }
  }
}
