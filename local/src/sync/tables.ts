import { z } from "zod";

/** Source facts only: meta is daemon configuration/counters; FTS is a rebuildable index. */
export const targetTables = [
  "skills", "sessions", "events", "loads", "eval_cases", "otel_spans",
  "herdr_workspaces", "herdr_tabs", "herdr_panes", "pane_sessions",
  "workflow_specs", "flows", "flow_steps", "load_candidates", "recording_clock",
] as const;
export const tableSchema = z.enum(targetTables);
export type TargetTable = z.infer<typeof tableSchema>;
export const scalarSchema = z.union([z.string(), z.number().finite(), z.null()]);
export const valuesSchema = z.record(z.string(), scalarSchema).readonly();
export const mutationSchema = z.strictObject({
  table: tableSchema,
  key: z.string(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  operation: z.enum(["upsert", "delete"]),
  sourceOrder: z.number().int().nullable(),
  values: valuesSchema.nullable(),
  beforeValues: valuesSchema.nullable().default(null),
}).readonly();
export type Mutation = z.infer<typeof mutationSchema>;

export class SyncError extends Error {
  constructor(readonly code:
    | "transaction_active" | "invalid_cut" | "record_too_large" | "invalid_limits"
    | "snapshot_expired" | "consent_required" | "content_not_allowed" | "range_not_allowed"
    | "scope_required" | "outbox_full" | "ack_out_of_order" | "invalid_stream",
  ) {
    super(code);
    this.name = "SyncError";
  }
}
