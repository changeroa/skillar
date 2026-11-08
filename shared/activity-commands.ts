import { z } from "zod";
import {
  accountIdSchema, deviceIdSchema, revisionSchema, sourceDomainSchema, sourceIdSchema,
  timestampSchema, MAX_BATCH_BYTES,
} from "./activity-schema.js";
import { dashboardSourceSchema } from "./activity-dashboard.js";

// Keep the Local workflow/spec.ts wire schema intact without importing Node crypto.
const slug = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const commandWorkflowStepSchema = z.strictObject({
  id: slug(64), skills: z.array(z.string().min(1).max(128)).max(10),
  together: z.boolean().default(false),
  expectTools: z.array(z.string().min(1).max(128)).default([]),
  doneWhen: z.string().max(500).optional(),
});
export const commandWorkflowSpecSchema = z.strictObject({
  name: slug(64), steps: z.array(commandWorkflowStepSchema).min(1).max(50),
}).refine(spec => new Set(spec.steps.map(step => step.id)).size === spec.steps.length, {
  message: "step ids must be unique", path: ["steps"],
});
export const sourceOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflow.put"), spec: commandWorkflowSpecSchema }),
  z.strictObject({
    kind: z.literal("flow.create"), workspaceId: sourceIdSchema.max(128), tabId: sourceIdSchema.max(128).optional(),
    spec: z.strictObject({ name: z.string().min(1).max(64), version: revisionSchema.min(1).max(1_000_000).optional() }),
    label: z.string().max(200).optional(),
  }),
  z.strictObject({
    kind: z.literal("flow.map-step"), flowId: sourceIdSchema, paneId: sourceIdSchema.max(128), stepId: z.string().min(1).max(64),
  }),
  z.strictObject({ kind: z.literal("flow.end"), flowId: sourceIdSchema }),
  z.strictObject({
    kind: z.literal("eval.add"), query: z.string().min(1).max(64_000),
    expectedUri: z.string().max(2048).optional(), fromTraceId: z.string().max(512).optional(),
  }),
]).readonly();
const commandId = z.string().uuid();
const payloadHash = z.string().regex(/^[a-f0-9]{64}$/);
const bounded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length <= MAX_BATCH_BYTES;
export const sourceCommandRequestSchema = z.strictObject({
  profile: dashboardSourceSchema, commandId, baseRevision: revisionSchema, operation: sourceOperationSchema,
}).refine(bounded, "command exceeds 256 KiB").readonly();
export const sourceCommandSchema = z.strictObject({
  accountId: accountIdSchema, generation: revisionSchema.min(1),
  deviceId: deviceIdSchema, sourceDomain: sourceDomainSchema,
  commandId, baseRevision: revisionSchema, operation: sourceOperationSchema,
  payloadHash, expiresAtMs: timestampSchema, consentVersion: revisionSchema.min(1),
}).readonly();
export const commandResultSchema = z.strictObject({
  commandId, payloadHash, state: z.enum(["applied", "conflict", "rejected"]),
  sourceRevision: revisionSchema, result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().max(64_000).nullable(),
}).refine(bounded, "result exceeds 256 KiB").readonly();
export const commandStatusSchema = z.strictObject({
  commandId, state: z.enum(["pending", "applied", "conflict", "rejected"]),
  baseRevision: revisionSchema, sourceRevision: revisionSchema.nullable(),
  result: z.record(z.string(), z.unknown()).nullable(), error: z.string().nullable(),
}).readonly();
export const commandStatusRequestSchema = z.strictObject({
  profile: dashboardSourceSchema, commandId,
}).readonly();
export const commandPollRequestSchema = z.strictObject({ sourceDomain: sourceDomainSchema }).readonly();
export const commandPollResponseSchema = z.strictObject({ command: sourceCommandSchema.nullable() }).readonly();
export const commandAckSchema = z.strictObject({
  sourceDomain: sourceDomainSchema, ...commandResultSchema.unwrap().shape,
}).refine(bounded, "ack exceeds 256 KiB").readonly();
export type SourceOperation = z.infer<typeof sourceOperationSchema>;
export type SourceCommandRequest = z.infer<typeof sourceCommandRequestSchema>;
export type SourceCommand = z.infer<typeof sourceCommandSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
export type CommandStatus = z.infer<typeof commandStatusSchema>;
export type CommandStatusRequest = z.infer<typeof commandStatusRequestSchema>;
export type CommandPollRequest = z.infer<typeof commandPollRequestSchema>;
export type CommandPollResponse = z.infer<typeof commandPollResponseSchema>;
export type CommandAck = z.infer<typeof commandAckSchema>;

/** JSON keys sort by code unit; arrays retain order; no locale-dependent ordering. */
export function canonicalCommandJson(value: unknown): string {
  const json = JSON.stringify(value, (_key, part: unknown) => {
    if (part !== null && typeof part === "object" && !Array.isArray(part)) {
      return Object.fromEntries(Object.entries(part).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return part;
  });
  if (json === undefined) throw new TypeError("command_json_required");
  return json;
}

/** SHA-256 of this UTF-8 string is payloadHash; parsing applies workflow defaults. */
export function canonicalCommandPayload(input: SourceCommandRequest): string {
  return canonicalCommandJson(sourceCommandRequestSchema.parse(input));
}
