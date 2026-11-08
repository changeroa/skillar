import { z } from "zod";
import { createHash } from "node:crypto";
import { mutationSchema, SyncError } from "./tables.js";
import type { Mutation, TargetTable } from "./tables.js";

// The standalone local package cannot import TS outside its rootDir or depend on
// an unpublished sibling package. Keep this boundary aligned with shared/activity-consent;
// contract tests exercise both parsers. These are NOT new HTTP wire contracts.
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identity = z.string().min(1).max(512).refine(value => !value.includes("\0"));
const timestamp = z.number().int().min(-8640000000000000).max(8640000000000000);
const range = z.strictObject({ fromMs: timestamp, toMs: timestamp })
  .refine(value => value.toMs > value.fromMs);
const backfill = z.strictObject({
  version: revision.min(1), snapshotId: identity, journalCut: revision,
});
export const contentKinds = [
  "prompt", "query", "args", "error", "path", "span-attributes", "private-skills",
] as const;
const kind = z.enum(contentKinds);
const common = {
  version: revision.min(1), grantedAtMs: timestamp,
  scope: z.strictObject({
    deviceId: identity,
    projectIds: z.array(z.string().min(1).max(512)).min(1).max(1000).readonly(),
    rootIds: z.array(z.string().min(1).max(512)).max(1000).readonly(),
  }),
  retention: z.strictObject({
    contentDays: revision.min(1).default(30), projectionDays: revision.min(1).default(30),
    backupDays: z.number().int().min(0).max(30).default(30),
  }).default({ contentDays: 30, projectionDays: 30, backupDays: 30 }),
  backfill: backfill.extend({ range }).optional(),
};
export const consentSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("local-only") }),
  z.strictObject({ ...common, mode: z.literal("metadata") }),
  z.strictObject({ ...common, mode: z.literal("managed-content"),
    serverProcessingAcknowledged: z.literal(true),
    contentKinds: z.array(kind).min(1).max(7).readonly(),
    externalModelTransfer: z.literal(false).default(false) }),
]);
export type Consent = z.infer<typeof consentSchema>;
export const uploadScopeSchema = z.strictObject({
  deviceId: identity, projectId: identity, rootId: identity.nullable(),
  consentVersion: revision.min(1), fromMs: timestamp, toMs: timestamp,
  contentKinds: z.array(kind).readonly(), backfill: backfill.nullable(),
});
export type UploadScope = z.infer<typeof uploadScopeSchema>;

export function authorizeUpload(consent: Consent, scope: UploadScope): void {
  if (consent.mode === "local-only") throw new SyncError("consent_required");
  if (scope.deviceId !== consent.scope.deviceId || scope.consentVersion !== consent.version ||
      !consent.scope.projectIds.includes(scope.projectId) ||
      (scope.rootId !== null && !consent.scope.rootIds.includes(scope.rootId))) {
    throw new SyncError("consent_required");
  }
  if (scope.toMs <= scope.fromMs) throw new SyncError("range_not_allowed");
  if (scope.contentKinds.length > 0 && (consent.mode !== "managed-content" ||
      scope.contentKinds.some(value => !consent.contentKinds.includes(value)))) {
    throw new SyncError("content_not_allowed");
  }
  if (scope.backfill !== null) {
    const historical = consent.backfill;
    if (historical === undefined || historical.version !== scope.backfill.version ||
        historical.snapshotId !== scope.backfill.snapshotId ||
        historical.journalCut !== scope.backfill.journalCut ||
        scope.fromMs < historical.range.fromMs || scope.toMs > historical.range.toMs) {
      throw new SyncError("range_not_allowed");
    }
  } else if (scope.fromMs < consent.grantedAtMs) throw new SyncError("range_not_allowed");
}

// Closed metadata projection. Arbitrary JSON/text, labels, names, URIs, digests,
// paths, runtime attributes and spec bodies never pass through this allowlist.
const metadataColumns: Readonly<Record<TargetTable, readonly string[]>> = {
  skills: ["mtime_ms", "removed_at"],
  sessions: ["started_at", "ended_at"],
  events: ["ts", "text_length"],
  loads: ["created_at"],
  eval_cases: ["created_at"],
  otel_spans: ["start_ms", "end_ms", "received_at"],
  herdr_workspaces: ["created_ms", "closed_ms"],
  herdr_tabs: ["created_ms", "closed_ms"],
  herdr_panes: ["created_ms", "closed_ms", "last_seen_ms"],
  pane_sessions: ["first_seen_ms", "last_seen_ms"],
  workflow_specs: ["version", "created_ms"],
  flows: ["registered_ms", "ended_ms", "start_order", "end_order"],
  flow_steps: ["registered_ms"],
  load_candidates: ["ts"],
  recording_clock: ["singleton", "position"],
};

const timeColumns: Readonly<Record<TargetTable, readonly string[]>> = {
  skills: ["mtime_ms", "removed_at"], sessions: ["started_at", "ended_at"],
  events: ["ts"], loads: ["created_at"], eval_cases: ["created_at"],
  otel_spans: ["start_ms", "end_ms", "received_at"],
  herdr_workspaces: ["created_ms", "closed_ms"], herdr_tabs: ["created_ms", "closed_ms"],
  herdr_panes: ["created_ms", "closed_ms", "last_seen_ms"],
  pane_sessions: ["first_seen_ms", "last_seen_ms"], workflow_specs: ["created_ms"],
  flows: ["registered_ms", "ended_ms"], flow_steps: ["registered_ms"],
  load_candidates: ["ts"], recording_clock: [],
};

/**
 * Full row images need all raw-content kinds: JSON columns can contain any of
 * them at arbitrary depth. Partial grants get metadata, never regex redaction.
 * Metadata source keys are hashed with their table tag: PKs can be file URIs
 * or user-chosen text. Before-images are local authorization evidence only.
 */
export function transformMutation(input: Mutation, scope: UploadScope): Mutation {
  const mutation = mutationSchema.parse(input);
  for (const column of timeColumns[mutation.table]) {
    const value = (mutation.values ?? mutation.beforeValues)?.[column];
    if (typeof value === "number" && (value < scope.fromMs || value >= scope.toMs)) {
      throw new SyncError("range_not_allowed");
    }
  }
  if (scope.contentKinds.length > 0) {
    if (contentKinds.some(value => !scope.contentKinds.includes(value))) {
      throw new SyncError("content_not_allowed");
    }
    return { ...mutation, beforeValues: null };
  }
  const key = createHash("sha256").update(mutation.table).update("\0").update(mutation.key).digest("hex");
  if (mutation.values === null) return { ...mutation, key, beforeValues: null };
  const values: Record<string, number | null> = {};
  for (const column of metadataColumns[mutation.table]) {
    const value = mutation.values[column];
    if (value !== undefined) values[column] = z.number().finite().nullable().parse(value);
  }
  return { ...mutation, key, values, beforeValues: null };
}

/** Caller resolves source project/root membership, not a self-asserted upload label. */
export type RecordScope = {
  readonly projectId: string; readonly rootId: string | null;
};
