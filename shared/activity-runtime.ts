import { z } from "zod";
import { activityBatchSchema, revisionSchema, timestampSchema } from "./activity-schema.js";
import { contentChunkRefSchema, plaintextHashSchema } from "./activity-content.js";

export const ingestCountersSchema = z.strictObject({
  accepted: revisionSchema, rejected: revisionSchema, dropped: revisionSchema,
  lastError: z.strictObject({ ts: timestampSchema, code: z.string().min(1).max(512) }).optional(),
});
export const analysisRuntimeSchema = z.strictObject({
  schemaVersion: z.literal(1), capturedAtMs: timestampSchema,
  activeRequests: z.array(z.string().min(1).max(512)).max(10000),
  ingest: ingestCountersSchema, tz: z.string().min(1).max(100),
}).readonly();
export type AnalysisRuntime = z.infer<typeof analysisRuntimeSchema>;
export const runtimeCommitSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...activityBatchSchema.unwrap().pick({
    deviceId: true, sourceDomain: true, generation: true, consentVersion: true,
    projectId: true, rootId: true, range: true, backfill: true,
  }).shape,
  batchId: z.string().uuid(), sequence: revisionSchema.min(1), sourceCut: revisionSchema,
  capturedAtMs: timestampSchema, chunks: z.array(contentChunkRefSchema).min(1).max(128),
  contentHash: plaintextHashSchema, totalBytes: revisionSchema.min(1).max(16 * 1024 * 1024),
}).readonly();
export type RuntimeCommit = z.infer<typeof runtimeCommitSchema>;
