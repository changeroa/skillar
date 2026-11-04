import { z } from "zod";
import { accountIdSchema, timestampSchema } from "./activity-schema.js";

export const deletionTargetSchema = z.strictObject({
  accountId: accountIdSchema,
  generation: z.number().int().positive().safe(),
}).readonly();
export type DeletionTarget = z.infer<typeof deletionTargetSchema>;
export const deletionRequestSchema = z.strictObject({
  generation: z.number().int().positive().safe(),
  confirmation: z.literal("DELETE"),
}).readonly();
export const deletionStateSchema = z.enum([
  "requested", "access_revoked", "live_purge_complete", "backup_expired",
]);
export const deletionStatusSchema = z.strictObject({
  generation: z.number().int().positive().safe(),
  state: deletionStateSchema,
  requestedAtMs: timestampSchema,
  accessRevokedAtMs: timestampSchema.nullable(),
  livePurgeAtMs: timestampSchema.nullable(),
  backupExpiresAtMs: timestampSchema,
  physicalPending: z.boolean(),
  localCopies: z.literal("not_deleted"),
  externalCopies: z.literal("not_controlled"),
}).readonly();
export type DeletionStatus = z.infer<typeof deletionStatusSchema>;
export const DELETION_BACKUP_HORIZON_MS = 30 * 86_400_000;
export const deletionServicePath = "/v1/activity/deletions/reconcile";
