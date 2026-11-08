import { z } from "zod";
import {
  ActivityContractError, backfillReferenceSchema, contentKindSchema, deviceIdSchema,
  revisionSchema, timeRangeSchema, timestampSchema,
} from "./activity-schema.js";
import type { ContentKind } from "./activity-schema.js";

export const retentionSchema = z.strictObject({
  contentDays: revisionSchema.min(1).default(30),
  projectionDays: revisionSchema.min(1).default(30),
  backupDays: z.number().int().min(0).max(30).default(30),
}).readonly();
const scopeSchema = z.strictObject({
  deviceId: deviceIdSchema,
  projectIds: z.array(z.string().min(1).max(512)).min(1).max(1000).readonly(),
  rootIds: z.array(z.string().min(1).max(512)).max(1000).readonly(),
}).readonly();
const common = {
  version: revisionSchema.min(1),
  scope: scopeSchema,
  retention: retentionSchema.default({ contentDays: 30, projectionDays: 30, backupDays: 30 }),
  // Explicit historical consent applies independently to metadata and content.
  backfill: backfillReferenceSchema.unwrap().extend({ range: timeRangeSchema }).readonly().optional(),
};
export const consentSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("local-only") }),
  z.strictObject({
    ...common, mode: z.literal("metadata"), grantedAtMs: timestampSchema,
  }),
  z.strictObject({
    ...common, mode: z.literal("managed-content"), grantedAtMs: timestampSchema,
    serverProcessingAcknowledged: z.literal(true),
    contentKinds: z.array(contentKindSchema).min(1).max(7).readonly(),
    externalModelTransfer: z.literal(false).default(false),
  }),
]).readonly();
export type Consent = z.infer<typeof consentSchema>;
export const defaultConsent: Consent = consentSchema.parse({ mode: "local-only" });

export type UploadScope = {
  readonly deviceId: string;
  readonly projectId: string;
  readonly rootId: string | null;
  readonly consentVersion: number;
  readonly fromMs: number;
  readonly toMs: number;
  readonly contentKinds: readonly ContentKind[];
  readonly backfill: {
    readonly version: number;
    readonly snapshotId: string;
    readonly journalCut: number;
  } | null;
};

export function authorizeUpload(consent: Consent, upload: UploadScope): void {
  switch (consent.mode) {
    case "local-only":
      throw new ActivityContractError("consent_required");
    case "metadata":
    case "managed-content": {
      if (upload.deviceId !== consent.scope.deviceId ||
          upload.consentVersion !== consent.version ||
          !consent.scope.projectIds.includes(upload.projectId) ||
          (upload.rootId !== null && !consent.scope.rootIds.includes(upload.rootId))) {
        throw new ActivityContractError("consent_required");
      }
      if (upload.toMs <= upload.fromMs) throw new ActivityContractError("range_not_allowed");
      if (upload.contentKinds.length > 0) {
        if (consent.mode !== "managed-content" ||
            upload.contentKinds.some(kind => !consent.contentKinds.includes(kind))) {
          throw new ActivityContractError("content_not_allowed");
        }
      }
      if (upload.backfill !== null) {
        if (consent.backfill === undefined ||
            upload.backfill.version !== consent.backfill.version ||
            upload.backfill.snapshotId !== consent.backfill.snapshotId ||
            upload.backfill.journalCut !== consent.backfill.journalCut ||
            upload.fromMs < consent.backfill.range.fromMs ||
            upload.toMs > consent.backfill.range.toMs) {
          throw new ActivityContractError("range_not_allowed");
        }
      } else if (upload.fromMs < consent.grantedAtMs) {
        throw new ActivityContractError("range_not_allowed");
      }
      return;
    }
    default: {
      const exhaustive: never = consent;
      return exhaustive;
    }
  }
}
