import { z } from "zod";
import type { ContentEnv } from "./content-env.ts";
import type { IngestPrincipal } from "./types.ts";
import type { ReportReference } from "../../../shared/activity-query.ts";
import { accountIdSchema } from "../../../shared/activity-schema.ts";

export interface ReportEnv extends ContentEnv {
  readonly REPORT_FLOW?: Workflow<ReportParams>;
}
export type ReportParams = ReportReference & { readonly accountId: string };
export class ReportError extends Error {
  constructor(readonly code:
    | "source_missing" | "source_gap" | "report_missing" | "report_conflict"
    | "report_pending" | "report_expired" | "report_busy" | "report_fenced"
    | "report_integrity" | "report_pressure" | "analysis_version" | "report_unavailable" | "spec_not_found",
  readonly status: 403 | 404 | 409 | 410 | 503 = 409) {
    super(code);
    this.name = "ReportError";
  }
}
export const reportJobSchema = z.object({
  account_id: z.string(), generation: z.number().int(), device_id: z.string(), source_domain: z.string(),
  job_id: z.string().uuid(), request_hash: z.string(), scope_json: z.string(),
  request_bytes: z.number().int(), request_chunks: z.number().int(),
  input_sequence: z.number().int(), input_cut: z.number().int(), analysis_version: z.number().int(),
  input_runtime_sequence: z.number().int().positive(), input_runtime_captured_at: z.number().int(),
  state: z.enum(["preparing", "queued", "running", "complete", "failed"]),
  created_at: z.number().int(), expires_at: z.number().int(),
  lease_fence: z.number().int(), lease_until: z.number().int(),
  result_chunks: z.number().int().nullable(), result_bytes: z.number().int().nullable(),
  result_hash: z.string().nullable(), error_code: z.string().nullable(),
});
export type ReportJob = z.infer<typeof reportJobSchema>;
export function reportPrincipal(params: ReportParams): IngestPrincipal {
  return {
    kind: "device", accountId: accountIdSchema.parse(params.accountId), generation: params.generation,
    deviceId: params.deviceId, shardId: "activity-00", scopes: ["activity:read"],
  };
}
export function reportIdentity(principal: IngestPrincipal, reference: ReportReference) {
  if (principal.kind !== "device" || principal.shardId !== "activity-00" ||
      principal.deviceId !== reference.deviceId || principal.generation !== reference.generation ||
      !principal.scopes.includes("activity:read")) throw new ReportError("report_fenced", 403);
  return [principal.accountId, principal.generation, principal.deviceId, reference.sourceDomain, reference.jobId];
}
