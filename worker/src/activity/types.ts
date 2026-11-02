import { z } from "zod";
import type { AccountId, DeviceId, SourceDomain } from "../../../shared/activity-schema.ts";

export type StreamIdentity = {
  readonly accountId: AccountId;
  readonly generation: number;
  readonly deviceId: DeviceId;
  readonly sourceDomain: SourceDomain;
};
// Only the verified P2 device principal may supply this internal argument.
// This is not an HTTP payload or a trusted identity-header format.
export type IngestPrincipal = {
  readonly kind: "device";
  readonly accountId: AccountId;
  readonly deviceId: DeviceId;
  readonly generation: number;
  readonly shardId: "activity-00";
  readonly scopes: readonly ("activity:read" | "activity:ingest" | "device:manage")[];
};
export const receiptSchema = z.strictObject({
  batchId: z.string(), payloadHash: z.string().length(64), sequence: z.number().int(),
  durableAt: z.number().int(), projectedThrough: z.number().int(),
  changeSeq: z.number().int(), state: z.literal("projected"),
}).readonly();
export type IngestReceipt = z.infer<typeof receiptSchema>;

export class ActivityLedgerError extends Error {
  readonly status: 403 | 409;
  readonly code: "tenant_fenced" | "batch_conflict" | "sequence_gap" | "forbidden";
  constructor(code: ActivityLedgerError["code"]) {
    super(code);
    this.name = "ActivityLedgerError";
    this.code = code;
    this.status = code === "tenant_fenced" || code === "forbidden" ? 403 : 409;
  }
}
