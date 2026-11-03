import { z } from "zod";
import {
  activityBatchSchema, revisionSchema, timestampSchema,
} from "./activity-schema.js";

export const ANALYSIS_VERSION = 1;
const runtime = z.enum(["claude-code", "codex", "gemini", "cursor", "omo", "gajae", "openclaw", "unknown"]);
const status = z.enum(["not_attempted", "in_progress", "succeeded", "failed", "cancelled", "unknown"]);
const automated = z.enum(["exclude", "include", "only"]);
export const activityFilterSchema = z.strictObject({
  from: timestampSchema.optional(), to: timestampSchema.optional(),
  runtime: z.array(runtime).optional(), skill: z.array(z.string()).optional(),
  state: z.array(z.enum(["loaded", "exposed_only", "no_match", "aborted", "not_used"])).optional(),
  dow: z.number().int().min(0).max(6).optional(), hour: z.number().int().min(0).max(23).optional(),
  hourSpan: z.number().int().min(1).max(24).optional(), q: z.string().optional(),
  searchStatus: z.array(status).optional(), loadStatus: z.array(status).optional(),
  searchResult: z.array(z.enum(["candidates_found", "no_candidates"])).optional(),
  automated: z.enum(["include", "only"]).optional(),
});
const filter = activityFilterSchema.default({});
const range = { from: timestampSchema, to: timestampSchema };
export const activityQuerySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("skills") }),
  z.strictObject({ kind: z.literal("workflow-versions"), name: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("sessions"), filter }),
  z.strictObject({ kind: z.literal("trace"), sessionId: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("flow"), filter,
    unit: z.enum(["first_load", "all_loads", "search_requests", "load_requests"]).default("first_load"),
    top: z.number().int().min(1).max(100).default(20),
  }),
  z.strictObject({
    kind: z.literal("heatmap"), filter, tz: z.string().min(1).max(100),
    weekStart: z.union([z.literal(0), z.literal(1)]).default(1),
    bucketHours: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
  }),
  z.strictObject({ kind: z.literal("skill-week"), filter }),
  z.strictObject({ kind: z.literal("stats"), filter }),
  z.strictObject({
    kind: z.literal("flows"), from: timestampSchema.optional(), to: timestampSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20), automated: automated.default("exclude"),
    cursor: z.strictObject({ orderMs: timestampSchema, id: z.string().min(1) }).optional(),
  }),
  z.strictObject({
    kind: z.literal("flow-report"), flowId: z.string().min(1),
    from: timestampSchema.optional(), to: timestampSchema.optional(),
    limit: z.number().int().min(1).max(100).default(100), automated: automated.default("exclude"),
  }),
  z.strictObject({
    kind: z.literal("session-report"), sessionId: z.string().min(1), automated: automated.default("exclude"),
  }),
  z.strictObject({
    kind: z.literal("skill-usage"), ...range,
    detailLimit: z.number().int().min(0).max(100).default(20), automated: automated.default("exclude"),
  }),
]);
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
export const reportScopeSchema = activityBatchSchema.unwrap().pick({
  deviceId: true, sourceDomain: true, generation: true, consentVersion: true,
  projectId: true, rootId: true, range: true, backfill: true,
});
export const reportRequestSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: z.string().uuid(),
  ...reportScopeSchema.shape, tz: z.string().min(1).max(100).default("UTC"),
  query: activityQuerySchema,
}).readonly();
export type ReportRequest = z.infer<typeof reportRequestSchema>;
export function reportScopeOf(request: ReportRequest) {
  const { schemaVersion: _version, requestId: _request, tz: _tz, query: _query, ...scope } = request;
  return scope;
}
export const sourceRevisionSchema = z.strictObject({
  sequence: revisionSchema, journalThrough: revisionSchema,
}).readonly();
export type SourceRevision = z.infer<typeof sourceRevisionSchema>;
export const reportReferenceSchema = z.strictObject({
  deviceId: reportScopeSchema.shape.deviceId, sourceDomain: reportScopeSchema.shape.sourceDomain,
  generation: reportScopeSchema.shape.generation, jobId: z.string().uuid(),
}).readonly();
export type ReportReference = z.infer<typeof reportReferenceSchema>;
