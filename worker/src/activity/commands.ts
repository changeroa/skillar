import { z } from "zod";
import { deploymentOriginSchema, isDeploymentOrigin } from "../../../shared/deployment-origin.ts";
import { accountIdSchema, ActivityContractError, deviceIdSchema, MAX_BATCH_BYTES } from "../../../shared/activity-schema.ts";
import type { ContentEnv } from "./content-env.ts";
import { ContentConsentError } from "./content-consent.ts";
import { ContentStorageError } from "./content-keys.ts";
import { ManagedCryptoError } from "./crypto.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";
import { CommandError } from "./commands-store.ts";
import { acknowledgeCommand, enqueueCommand, pollCommand, readCommandStatus } from "./commands-ledger.ts";

const principalSchema = z.strictObject({
  kind: z.literal("device"), accountId: accountIdSchema, deviceId: deviceIdSchema,
  generation: z.number().int().positive(), shardId: z.literal("activity-00"),
  issuer: deploymentOriginSchema, sessionId: z.null(),
  scopes: z.array(z.enum(["activity:read", "activity:ingest"])).min(1).readonly(),
}).readonly();
const handlers = new Map<string, (env: ContentEnv, principal: IngestPrincipal, input: unknown) => Promise<unknown>>([
  ["/v1/activity/commands/enqueue", enqueueCommand],
  ["/v1/activity/commands/status", readCommandStatus],
  ["/v1/activity/commands/poll", pollCommand],
  ["/v1/activity/commands/ack", acknowledgeCommand],
]);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
class CommandHttpError extends Error {
  constructor(readonly status: 413 | 415, readonly code: string) { super(code); }
}
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json") || request.body === null) {
    throw new CommandHttpError(415, "json_required");
  }
  const reader = request.body.getReader(), parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > MAX_BATCH_BYTES) {
        await reader.cancel();
        throw new CommandHttpError(413, "batch_too_large");
      }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Internal service binding only; Pages replaces identity headers after authentication. */
export async function commandsRequest(request: Request, env: ContentEnv): Promise<Response | null> {
  const url = new URL(request.url), handler = handlers.get(url.pathname);
  if (handler === undefined) return null;
  if (url.origin !== "https://activity.internal" || request.method !== "POST" ||
      url.pathname !== "/v1/activity/commands/status" && env.ACTIVITY_INGEST_ENABLED !== "true") {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  try {
    const identity = request.headers.get("x-skillar-principal");
    if (identity === null) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const principal = principalSchema.parse(JSON.parse(identity));
    if (!isDeploymentOrigin(principal.issuer, env)) throw new ActivityLedgerError("forbidden");
    const value = await handler(env, principal, await body(request));
    return Response.json(value, { status: url.pathname.endsWith("/enqueue") ? 202 : 200, headers });
  } catch (error) {
    if (error instanceof CommandError || error instanceof CommandHttpError ||
        error instanceof ActivityLedgerError || error instanceof ContentConsentError ||
        error instanceof ContentStorageError) {
      return Response.json({ error: error.code }, { status: error.status, headers });
    }
    if (error instanceof ActivityContractError) {
      return Response.json({ error: error.code }, { status: 403, headers });
    }
    if (error instanceof ManagedCryptoError) {
      return Response.json({ error: "command_integrity" }, { status: 409, headers });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) {
      return Response.json({ error: "invalid_request" }, { status: 400, headers });
    }
    if (error instanceof Error) {
      return Response.json({ error: "command_unavailable" }, { status: 503, headers });
    }
    throw error;
  }
}
