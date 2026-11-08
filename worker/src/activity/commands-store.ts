import { z } from "zod";
import { consentSchema } from "../../../shared/activity-consent.ts";
import { contentKinds } from "../../../shared/activity-schema.ts";
import type { SourceCommandRequest } from "../../../shared/activity-commands.ts";
import {
  canonicalCommandPayload, commandResultSchema, commandStatusSchema, sourceCommandSchema, sourceCommandRequestSchema,
} from "../../../shared/activity-commands.ts";
import { activeFence, contentDigest } from "./content-db.ts";
import { ContentConsentError, requireContentConsent } from "./content-consent.ts";
import { readContentKey } from "./content-keys.ts";
import { decryptContent, encryptContent } from "./crypto.ts";
import type { ContentEnv } from "./content-env.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";

export class CommandError extends Error {
  constructor(readonly code: "command_conflict" | "command_missing" | "command_expired" | "command_integrity",
    readonly status: 404 | 409 | 410 = 409) {
    super(code);
    this.name = "CommandError";
  }
}
export const commandRowSchema = z.object({
  account_id: z.string(), generation: z.number().int(), device_id: z.string(),
  source_domain: z.string(), command_id: z.string(),
  payload_hash: z.string(), base_revision: z.number().int(),
  object_key: z.string(), bytes: z.number().int(), key_version: z.number().int(),
  consent_version: z.number().int(), created_at: z.number().int(), expires_at: z.number().int(),
  state: z.enum(["writing", "pending", "acking", "applied", "conflict", "rejected", "purging", "purged"]),
  outcome: z.enum(["applied", "conflict", "rejected"]).nullable(),
  source_revision: z.number().int().nullable(), result_hash: z.string().nullable(),
  result_bytes: z.number().int().nullable(), result_object_key: z.string().nullable(),
  acknowledged_at: z.number().int().nullable(),
}).readonly();
export type CommandRow = z.infer<typeof commandRowSchema>;
export const commandIdentity = (p: IngestPrincipal, source: string, id: string) =>
  [p.accountId, p.generation, p.deviceId, source, id] as const;

/** Full opaque result authority is required even before inspecting a queue row. */
export async function commandGrant(env: ContentEnv, principal: IngestPrincipal, row?: CommandRow, now = Date.now()) {
  if (!principal.scopes.includes("activity:read") || principal.scopes.includes("device:manage") ||
      principal.shardId !== "activity-00") throw new ActivityLedgerError("forbidden");
  await activeFence(env.ACTIVITY, principal);
  const saved = await env.ACCOUNTS.prepare(`SELECT c.version,c.consent_json FROM device_consents c
    JOIN accounts a ON a.account_id=c.account_id
    JOIN devices d ON d.account_id=c.account_id AND d.device_id=c.device_id
    WHERE c.account_id=? AND c.device_id=? AND c.generation=? AND a.state='active'
      AND a.auth_generation=? AND d.revoked_at IS NULL ORDER BY c.version DESC LIMIT 1`)
    .bind(principal.accountId, principal.deviceId, principal.generation, principal.generation).first();
  if (saved === null) throw new ContentConsentError();
  const current = z.object({ version: z.number().int(), consent_json: z.string() }).parse(saved);
  const consent = consentSchema.parse(JSON.parse(current.consent_json));
  if (consent.mode !== "managed-content" || consent.version !== current.version ||
      consent.scope.rootIds.length !== 0 || row !== undefined && row.consent_version !== current.version) {
    throw new ContentConsentError();
  }
  const from = row?.created_at ?? now;
  await requireContentConsent(env.ACCOUNTS, principal, {
    deviceId: principal.deviceId, projectId: `device:${principal.deviceId}`, rootId: null,
    consentVersion: current.version, fromMs: from, toMs: from + 1, backfill: null, contentKinds,
  });
  if (row !== undefined && (row.account_id !== principal.accountId || row.generation !== principal.generation ||
      row.device_id !== principal.deviceId)) throw new ActivityLedgerError("forbidden");
  if (row !== undefined && (row.expires_at <= now ||
      row.created_at + Math.min(30, consent.retention.contentDays, consent.retention.projectionDays) * 86_400_000 <= now ||
      row.state === "purging" || row.state === "purged")) throw new CommandError("command_expired", 410);
  return consent;
}
export async function commandWrite<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("tenant_fenced")) throw new ActivityLedgerError("tenant_fenced");
      if (error.message.includes("command_expired")) throw new CommandError("command_expired", 410);
      if (error.message.includes("command_conflict") ||
          error.message.includes("UNIQUE constraint failed: connector_commands")) throw new CommandError("command_conflict");
    }
    throw error;
  }
}
export async function loadCommand(env: ContentEnv, p: IngestPrincipal, source: string, id: string) {
  await commandGrant(env, p);
  const record = await env.ACTIVITY.prepare(`SELECT * FROM connector_commands
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND command_id=?`)
    .bind(...commandIdentity(p, source, id)).first();
  if (record === null) throw new CommandError("command_missing", 404);
  const row = commandRowSchema.parse(record);
  await commandGrant(env, p, row);
  return row;
}
type ObjectDescriptor = { readonly objectKey: string; readonly hash: string; readonly bytes: number };
const context = (p: IngestPrincipal, objectKey: string) =>
  ({ accountId: p.accountId, generation: p.generation, objectKey, revision: 0, schemaVersion: 1 });

export async function readCommandObject(env: ContentEnv, p: IngestPrincipal, row: CommandRow, object: ObjectDescriptor) {
  await commandGrant(env, p, row);
  const stored = await env.ACTIVITY_RAW.get(object.objectKey);
  if (stored === null) return null;
  const key = await readContentKey(env.ACTIVITY, p, env.CONTENT_KEYRING, row.key_version);
  const bytes = await decryptContent(key, context(p, object.objectKey), await stored.json());
  if (bytes.length !== object.bytes || await contentDigest(bytes) !== object.hash) {
    throw new CommandError("command_integrity");
  }
  await commandGrant(env, p, row);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export async function putCommandObject(
  env: ContentEnv, p: IngestPrincipal, row: CommandRow, object: ObjectDescriptor, bytes: Uint8Array,
) {
  await commandGrant(env, p, row);
  const key = await readContentKey(env.ACTIVITY, p, env.CONTENT_KEYRING, row.key_version);
  const envelope = await encryptContent(key, context(p, object.objectKey), new Uint8Array(bytes));
  // Immutable conditional PUT: an exact retry verifies the first writer's bytes.
  await env.ACTIVITY_RAW.put(object.objectKey, JSON.stringify(envelope), {
    onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" },
  });
  if (await readCommandObject(env, p, row, object) === null) throw new CommandError("command_integrity");
}
export const operationDescriptor = (row: CommandRow) =>
  ({ objectKey: row.object_key, hash: row.payload_hash, bytes: row.bytes });

export async function deliveredCommand(env: ContentEnv, p: IngestPrincipal, row: CommandRow) {
  const input: unknown = await readCommandObject(env, p, row, operationDescriptor(row));
  if (input === null) return null;
  // The canonical plaintext itself is the browser request, not just operation.
  const request = sourceCommandRequestSchema.parse(input);
  if (request.commandId !== row.command_id || request.baseRevision !== row.base_revision ||
      request.profile.deviceId !== row.device_id || request.profile.sourceDomain !== row.source_domain ||
      await contentDigest(new TextEncoder().encode(canonicalCommandPayload(request))) !== row.payload_hash) {
    throw new CommandError("command_integrity");
  }
  return sourceCommandSchema.parse({
    accountId: p.accountId, generation: p.generation, deviceId: p.deviceId, sourceDomain: row.source_domain,
    commandId: row.command_id, baseRevision: row.base_revision, operation: request.operation,
    payloadHash: row.payload_hash, expiresAtMs: row.expires_at, consentVersion: row.consent_version,
  });
}
export async function commandStatus(env: ContentEnv, p: IngestPrincipal, row: CommandRow) {
  await commandGrant(env, p, row);
  if (row.acknowledged_at === null) return commandStatusSchema.parse({
    commandId: row.command_id, state: "pending", baseRevision: row.base_revision,
    sourceRevision: null, result: null, error: null,
  });
  if (row.result_hash === null || row.result_bytes === null || row.result_object_key === null) {
    throw new CommandError("command_integrity");
  }
  const result = commandResultSchema.parse(await readCommandObject(env, p, row, {
    objectKey: row.result_object_key, hash: row.result_hash, bytes: row.result_bytes,
  }));
  if (result.commandId !== row.command_id || result.payloadHash !== row.payload_hash ||
      result.state !== row.outcome || result.sourceRevision !== row.source_revision) {
    throw new CommandError("command_integrity");
  }
  return commandStatusSchema.parse({
    commandId: row.command_id, state: result.state, baseRevision: row.base_revision,
    sourceRevision: result.sourceRevision, result: result.result, error: result.error,
  });
}

export function browserDevice(p: IngestPrincipal, request: Pick<SourceCommandRequest, "profile">): void {
  if (p.deviceId !== request.profile.deviceId) throw new ActivityLedgerError("forbidden");
}
export function connectorScopes(p: IngestPrincipal): void {
  if (!p.scopes.includes("activity:ingest") || !p.scopes.includes("activity:read")) {
    throw new ActivityLedgerError("forbidden");
  }
}
