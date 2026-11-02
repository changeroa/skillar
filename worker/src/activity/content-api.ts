import { z } from "zod";
import {
  accountIdSchema, ActivityContractError, deviceIdSchema, MAX_BATCH_BYTES,
} from "../../../shared/activity-schema.ts";
import { ContentContractError } from "../../../shared/activity-content.ts";
import { ContentConsentError } from "./content-consent.ts";
import { sweepContent } from "./content-db.ts";
import type { ContentEnv } from "./content-env.ts";
import { ContentStorageError } from "./content-keys.ts";
import { storeContentChunk } from "./content-objects.ts";
import { acceptContentBatch } from "./content-service.ts";
import { ManagedCryptoError } from "./crypto.ts";
import { ActivityLedgerError } from "./types.ts";

const internalPrincipalSchema = z.strictObject({
  kind: z.literal("device"), accountId: accountIdSchema, deviceId: deviceIdSchema,
  generation: z.number().int().positive(), shardId: z.literal("activity-00"),
  issuer: z.enum(["https://skillar.sh", "https://skillar-site.pages.dev"]),
  sessionId: z.null(),
  scopes: z.array(z.enum(["activity:read", "activity:ingest"])).min(1).readonly(),
}).readonly();
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
class ContentHttpError extends Error {
  constructor(readonly status: 400 | 413 | 415, readonly code: string) {
    super(code);
    this.name = "ContentHttpError";
  }
}
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json") || request.body === null) {
    throw new ContentHttpError(415, "json_required");
  }
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BATCH_BYTES) {
        await reader.cancel();
        throw new ContentHttpError(413, "batch_too_large");
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/**
 * Service-binding entrypoint only: routes=[], workers_dev=false, preview_urls=false.
 * Pages authenticates the device and replaces identity headers before forwarding.
 */
export async function activityContentRequest(request: Request, env: ContentEnv): Promise<Response> {
  if (env.ACTIVITY_INGEST_ENABLED !== "true") {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  if (new URL(request.url).origin !== "https://activity.internal" || request.method !== "POST") {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  try {
    const identity = request.headers.get("x-skillar-principal");
    if (identity === null) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const principal = internalPrincipalSchema.parse(JSON.parse(identity));
    const path = new URL(request.url).pathname;
    if (path === "/v1/activity/chunks") {
      return Response.json(await storeContentChunk(env, principal, await body(request)), {
        status: 201, headers,
      });
    }
    if (path === "/v1/activity/batches") {
      return Response.json(await acceptContentBatch(env, principal, await body(request)), { headers });
    }
    return Response.json({ error: "not_found" }, { status: 404, headers });
  } catch (error) {
    if (error instanceof ActivityLedgerError || error instanceof ContentStorageError ||
        error instanceof ContentConsentError || error instanceof ContentHttpError) {
      return Response.json({ error: error.code }, { status: error.status, headers });
    }
    if (error instanceof ActivityContractError) {
      return Response.json({ error: error.code }, { status: 403, headers });
    }
    if (error instanceof ContentContractError || error instanceof ManagedCryptoError) {
      return Response.json({ error: error.code }, { status: 400, headers });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) {
      return Response.json({ error: "invalid_request" }, { status: 400, headers });
    }
    // HTTP boundary: no body, token, crypto material or database details in logs.
    if (error instanceof Error) {
      return Response.json({ error: "content_unavailable" }, { status: 503, headers });
    }
    throw error;
  }
}

export default {
  fetch: activityContentRequest,
  scheduled(_event: ScheduledController, env: ContentEnv, context: ExecutionContext) {
    context.waitUntil(sweepContent(env.ACTIVITY, env.ACTIVITY_RAW));
  },
};
