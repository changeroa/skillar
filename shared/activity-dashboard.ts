import { z } from "zod";
import { deviceIdSchema, sourceDomainSchema } from "./activity-schema.js";
import { consentSchema } from "./activity-consent.js";
import { activityQuerySchema } from "./activity-query.js";

/** Browser requests use the Google session; no device bearer reaches the browser. */
export const dashboardPaths = {
  profiles: "/api/dashboard/profiles",
  status: "/api/dashboard/status",
  query: "/api/dashboard/query",
  reportStatus: "/api/dashboard/reports/status",
  reportResult: "/api/dashboard/reports/result",
  evalCases: "/api/dashboard/eval-cases",
} as const;
export const dashboardServicePaths = {
  profiles: "/v1/activity/dashboard/profiles",
  evalCases: "/v1/activity/dashboard/eval-cases",
} as const;
export const dashboardSourceSchema = z.strictObject({
  deviceId: deviceIdSchema, sourceDomain: sourceDomainSchema,
}).readonly();
export type DashboardSource = z.infer<typeof dashboardSourceSchema>;
const timestamp = z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000);
export const dashboardSourceHeadSchema = dashboardSourceSchema.unwrap().extend({
  sourceSequence: z.number().int().nonnegative(),
  journalThrough: z.number().int().nonnegative(),
  runtimeSequence: z.number().int().positive().nullable(),
  capturedAtMs: timestamp.nullable(), receivedAtMs: timestamp.nullable(),
}).readonly();
export const dashboardDeviceSchema = z.strictObject({
  deviceId: deviceIdSchema, createdAt: timestamp, revokedAt: timestamp.nullable(),
  consentVersion: z.number().int().nonnegative(), consent: consentSchema,
}).readonly();
export const dashboardProfileSchema = dashboardSourceHeadSchema.unwrap().extend({
  availability: z.enum(["local-only", "metadata-only", "partial", "awaiting-runtime", "ready", "revoked"]),
}).readonly();
export const dashboardProfilesSchema = z.strictObject({
  schemaVersion: z.literal(1), ingestEnabled: z.boolean(),
  devices: z.array(dashboardDeviceSchema).readonly(), profiles: z.array(dashboardProfileSchema).readonly(),
}).readonly();
export type DashboardProfiles = z.infer<typeof dashboardProfilesSchema>;
export type DashboardProfile = z.infer<typeof dashboardProfileSchema>;
export const dashboardQuerySchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(),
  query: activityQuerySchema, tz: z.string().min(1).max(100).default("UTC"),
}).readonly();
export const dashboardReferenceSchema = z.strictObject({
  profile: dashboardSourceSchema, jobId: z.string().uuid(),
}).readonly();
export const dashboardResultPartRequestSchema = dashboardReferenceSchema.unwrap().extend({
  part: z.number().int().nonnegative().max(4095),
}).readonly();
export const dashboardReportStatusSchema = z.object({
  schemaVersion: z.literal(1), jobId: z.string().uuid(),
  state: z.enum(["preparing", "queued", "running", "complete", "failed"]),
  generatedAt: timestamp, sourceCapturedAt: timestamp, sourceReceivedAt: timestamp.nullable(),
  inputRevision: z.object({
    sequence: z.number().int().nonnegative(), journalThrough: z.number().int().nonnegative(),
    runtimeSequence: z.number().int().positive(),
  }).readonly(),
  analysisVersion: z.number().int().positive(), stale: z.boolean(), pending: z.boolean(),
  error: z.string().nullable(),
  result: z.object({
    parts: z.number().int().positive().max(4096), bytes: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  }).nullable(),
}).readonly();
export type DashboardReportStatus = z.infer<typeof dashboardReportStatusSchema>;
export const dashboardResultPartSchema = z.strictObject({
  index: z.number().int().nonnegative(), bytes: z.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/), body: z.string().max(200_000),
}).readonly();
export const dashboardEvalInputSchema = z.strictObject({
  query: z.string().min(1).max(64_000), expectedUri: z.string().max(2048).optional(),
  fromTraceId: z.string().max(512).optional(),
}).readonly();
export const dashboardEvalRequestSchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(), input: dashboardEvalInputSchema,
}).readonly();
export const dashboardEvalReceiptSchema = z.strictObject({
  caseId: z.string().min(1), state: z.literal("stored"), retainedUntilMs: timestamp,
}).readonly();
