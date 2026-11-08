import { z } from "zod";
import { accountIdSchema } from "./activity-schema.js";
import { deploymentOriginSchema } from "./deployment-origin.js";

/** Account-wide invalidations contain no source keys or private content. */
export const eventPaths = {
  changes: "/api/changes",
  websocket: "/api/events/ws",
  stream: "/api/events/stream",
  lease: "/api/events/lease",
} as const;
export const eventServicePaths = {
  changes: "/v1/activity/events/changes",
  websocket: "/v1/activity/events/ws",
  stream: "/v1/activity/events/stream",
  lease: "/v1/activity/events/lease",
  revoke: "/v1/activity/events/revoke",
} as const;
export const EVENT_LEASE_MS = 5 * 60 * 1000;
export const EVENT_SSE_LIFETIME_MS = 5_000;
export const EVENT_SSE_COOLDOWN_MS = 120_000;
export const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const EVENT_PAGE_SIZE = 100;
const integer = z.number().int().nonnegative().safe();
/** Only a private service binding may supply this server-created authority. */
export const eventPrincipalSchema = z.strictObject({
  kind: z.literal("browser"),
  accountId: accountIdSchema,
  generation: integer.positive(),
  shardId: z.literal("activity-00"),
  issuer: deploymentOriginSchema,
  sessionId: z.string().min(32).max(128),
  deviceId: z.null(),
  scopes: z.array(z.enum(["activity:read", "device:manage"])).readonly(),
}).readonly();
export type EventPrincipal = z.infer<typeof eventPrincipalSchema>;
export const invalidationSchema = z.strictObject({
  generation: integer.positive(),
  seq: integer.positive(),
  invalidationKind: z.enum(["activity", "runtime", "report", "migration", "consent", "skills"]),
}).readonly();
export type AccountInvalidation = z.infer<typeof invalidationSchema>;
/** SHA-256(account ID + account-wide scope), generation, then sequence. */
export const eventCursorSchema = z.string().max(98)
  .regex(/^[a-f0-9]{64}\.[1-9]\d*\.(?:0|[1-9]\d*)$/)
  .refine(value => value.split(".").slice(1).every(part => Number.isSafeInteger(Number(part))));
export const replaySchema = z.strictObject({
  state: z.enum(["ok", "resync_required"]),
  head: integer,
  cursor: eventCursorSchema,
  changes: z.array(invalidationSchema).max(EVENT_PAGE_SIZE).readonly(),
  hasMore: z.boolean(),
}).readonly();
export type AccountReplay = z.infer<typeof replaySchema>;
export const eventLeaseRequestSchema = z.strictObject({
  connectionId: z.string().uuid(),
}).readonly();
export const eventLeaseSchema = eventLeaseRequestSchema.unwrap().extend({
  expiresAtMs: integer,
}).readonly();
export const eventReadySchema = eventLeaseSchema.unwrap().extend({
  type: z.literal("ready"),
  cursor: eventCursorSchema,
}).readonly();
export const eventResetSchema = z.strictObject({
  type: z.literal("resync_required"),
  cursor: eventCursorSchema,
}).readonly();
export const eventMessageSchema = z.union([eventReadySchema, eventResetSchema, invalidationSchema]);

export async function eventCursorScope(accountId: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(JSON.stringify(["account-wide-v1", accountId])));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function eventCursor(scope: string, generation: number, seq: number): string {
  return eventCursorSchema.parse(`${scope}.${generation}.${seq}`);
}
