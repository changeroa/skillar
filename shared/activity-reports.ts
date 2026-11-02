// MIT. Shared DTO assembly for local SQLite and asynchronous cloud fact snapshots.
export {
  AnalysisReportError, buildFlows, buildFlowReport, buildSessionReport, buildSkillUsage,
  compareFlow, encodeFlowCursor,
} from "./reports/assembly.js";
export type { ReportStore } from "./reports/assembly.js";
