import { z } from "zod";

const identity = z.string().min(1).max(512).refine(value => !value.includes("\0"));
export const accountIdSchema = identity.brand<"AccountId">();
export const deviceIdSchema = identity.brand<"DeviceId">();
export const sourceDomainSchema = identity.brand<"SourceDomain">();
export const sourceIdSchema = identity.brand<"SourceId">();
export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const timestampSchema = z.number().int().min(-8640000000000000).max(8640000000000000);
export const recordingOrdersSchema = z.record(sourceDomainSchema, revisionSchema).readonly();
export const timeRangeSchema = z.strictObject({
  fromMs: timestampSchema, toMs: timestampSchema,
}).refine(value => value.toMs > value.fromMs).readonly();
export const backfillReferenceSchema = z.strictObject({
  version: revisionSchema.min(1), snapshotId: identity, journalCut: revisionSchema,
}).readonly();
export type AccountId = z.infer<typeof accountIdSchema>;
export type DeviceId = z.infer<typeof deviceIdSchema>;
export type SourceDomain = z.infer<typeof sourceDomainSchema>;

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const runtime = z.enum(["claude-code", "codex", "gemini", "cursor", "omo", "gajae", "openclaw", "unknown"]);
export const sessionFactsSchema = z.strictObject({
  runtime, startedMs: timestampSchema, endedMs: timestampSchema.nullable(),
  automated: z.boolean().nullable(),
}).readonly();
export const eventFactsSchema = z.strictObject({
  sessionId: sourceIdSchema, kind: z.enum([
    "session_start", "session_end", "prompt", "search", "load", "read_file",
    "native_skill", "tool_call", "llm_call", "error", "skill_request",
  ]),
  timestampMs: timestampSchema, sourceOrder: revisionSchema.nullable(),
  recordingOrders: recordingOrdersSchema, sourceKey: sourceIdSchema.nullable(),
  status: z.enum(["in_progress", "succeeded", "failed", "cancelled", "unknown"]),
  inputTokens: count, outputTokens: count,
}).readonly();
export const spanFactsSchema = z.strictObject({
  traceId: sourceIdSchema, spanId: sourceIdSchema, parentSpanId: sourceIdSchema.nullable(),
  sessionId: sourceIdSchema.nullable(), startMs: timestampSchema.nullable(),
  endMs: timestampSchema.nullable(), recordingOrders: recordingOrdersSchema,
  inputTokens: count, outputTokens: count,
}).readonly();

const mutation = {
  key: sourceIdSchema, revision: revisionSchema,
};
export const metadataMutationSchema = z.discriminatedUnion("entity", [
  z.strictObject({ ...mutation, entity: z.literal("session"), facts: sessionFactsSchema }),
  z.strictObject({ ...mutation, entity: z.literal("event"), facts: eventFactsSchema }),
  z.strictObject({ ...mutation, entity: z.literal("span"), facts: spanFactsSchema }),
  z.strictObject({
    ...mutation, entity: z.literal("tombstone"),
    target: z.enum(["session", "event", "span"]),
  }),
]).readonly();
export type MetadataMutation = z.infer<typeof metadataMutationSchema>;

export const activityBatchSchema = z.strictObject({
  schemaVersion: z.literal(1), batchId: identity,
  // Account identity comes only from the verified principal, never this payload.
  deviceId: deviceIdSchema, sourceDomain: sourceDomainSchema,
  generation: revisionSchema.min(1), consentVersion: revisionSchema.min(1),
  projectId: identity, rootId: identity.nullable(), range: timeRangeSchema,
  backfill: backfillReferenceSchema.nullable(),
  sequence: revisionSchema.min(1),
  journal: z.strictObject({ from: revisionSchema, through: revisionSchema }).refine(
    range => range.through >= range.from,
  ).readonly(),
  mutations: z.array(metadataMutationSchema).min(1).max(100).readonly(),
}).readonly();
export type ActivityBatch = z.infer<typeof activityBatchSchema>;

export const contentKinds = [
  "prompt", "query", "args", "error", "path", "span-attributes", "private-skills",
] as const;
export const contentKindSchema = z.enum(contentKinds);
export type ContentKind = z.infer<typeof contentKindSchema>;
export const MAX_BATCH_BYTES = 256 * 1024;

export function parseActivityBatch(
  input: unknown, options: { readonly allowEmptyMetadata?: boolean } = {},
): ActivityBatch {
  // A P5 content manifest may carry source tables with no P1 metadata mutation.
  // The public v1 metadata path keeps its original nonempty contract.
  const parser = options.allowEmptyMetadata === true ? activityBatchSchema.unwrap().extend({
    mutations: z.array(metadataMutationSchema).max(100).readonly(),
  }).readonly() : activityBatchSchema;
  const value = parser.parse(input);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BATCH_BYTES) {
    throw new ActivityContractError("batch_too_large");
  }
  for (const mutation of value.mutations) {
    let times: readonly (number | null)[];
    switch (mutation.entity) {
      case "event": times = [mutation.facts.timestampMs]; break;
      case "session": times = [mutation.facts.startedMs, mutation.facts.endedMs]; break;
      case "span": times = [mutation.facts.startMs, mutation.facts.endMs]; break;
      case "tombstone": times = []; break;
      default: {
        const exhaustive: never = mutation;
        return exhaustive;
      }
    }
    if (times.some(time => time !== null && (time < value.range.fromMs || time >= value.range.toMs))) {
      throw new ActivityContractError("range_not_allowed");
    }
  }
  return value;
}

export class ActivityContractError extends Error {
  constructor(readonly code: "batch_too_large" | "consent_required" | "content_not_allowed" | "range_not_allowed") {
    super(code);
    this.name = "ActivityContractError";
  }
}
