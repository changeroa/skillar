import { z } from "zod";
import { AuthenticationError } from "./auth.ts";
import {
  activityConfig, activityError, browserPrincipal, noStore,
} from "./activity-auth.ts";
import type { ActivityEnv } from "./activity-auth.ts";
import {
  exchangeDeviceGrant, issueDeviceGrant, readDevicePrincipal, revokeDevice,
} from "./device-auth.ts";
import { readDeviceConsent, setDeviceConsent } from "./activity-consent.ts";

const grantRequestSchema = z.strictObject({
  scopes: z.array(z.enum(["activity:read", "activity:ingest"])).min(1).max(2).readonly(),
});
const exchangeSchema = z.strictObject({ grant: z.string().min(32).max(128) });
const deviceListSchema = z.array(z.strictObject({
  deviceId: z.string(), createdAt: z.number(), revokedAt: z.number().nullable(),
}));

class ActivityRequestError extends Error {}

async function readBody(request: Request, maxBytes = 4096): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json") || request.body === null) {
    throw new ActivityRequestError("invalid_body");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ActivityRequestError("body_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    return value;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new ActivityRequestError("invalid_body");
    }
    throw error;
  }
}

async function handle(request: Request, env: ActivityEnv): Promise<Response> {
  if (env.ACTIVITY_ENABLED !== "true") return activityError(404, "not_found");
  const config = activityConfig(request, env);
  if (config === null) return activityError(403, "invalid_host");
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin) return activityError(403, "invalid_origin");
  const path = url.pathname.replace(/\/$/, "");

  if (path === "/v1/devices/exchange" && request.method === "POST") {
    const { grant } = exchangeSchema.parse(await readBody(request));
    const result = await exchangeDeviceGrant(grant, env, config.PUBLIC_ORIGIN);
    return result === null ? activityError(401, "invalid_grant") :
      Response.json(result, { headers: noStore });
  }
  if (path.startsWith("/v1/")) {
    const principal = await readDevicePrincipal(request, env);
    if (principal === null) return activityError(401, "unauthorized");
    if ((path === "/v1/activity/chunks" || path === "/v1/activity/batches") &&
        request.method === "POST") {
      if (env.ACTIVITY_INGEST_ENABLED !== "true" || env.ACTIVITY_SERVICE === undefined) {
        return activityError(404, "not_found");
      }
      if (!principal.scopes.includes("activity:ingest")) {
        return activityError(403, "insufficient_scope");
      }
      // The internal Worker has no public routes. Forward only server-created
      // identity, never caller-supplied headers, cookies or authorization.
      const headers = new Headers({
        "content-type": request.headers.get("content-type") ?? "",
        "x-skillar-principal": JSON.stringify(principal),
      });
      const forwarded = new Request(`https://activity.internal${path}`, request);
      return env.ACTIVITY_SERVICE.fetch(new Request(forwarded, { headers }));
    }
    if (path === "/v1/activity/status" && request.method === "GET") {
      if (!principal.scopes.includes("activity:read")) return activityError(403, "insufficient_scope");
      return Response.json({
        accountId: principal.accountId, deviceId: principal.deviceId,
        generation: principal.generation, shardId: principal.shardId,
        stage: "foundation", dashboardConnected: false,
      }, { headers: noStore });
    }
    return activityError(404, "not_found");
  }
  const principal = await browserPrincipal(request, env);
  if (principal === null) return activityError(401, "unauthorized");
  if (path === "/api/activity/status" && request.method === "GET") {
    return Response.json({
      accountId: principal.accountId, generation: principal.generation,
      shardId: principal.shardId, stage: "foundation", dashboardConnected: false,
    }, { headers: noStore });
  }
  if (path === "/api/devices" && request.method === "GET") {
    const rows = await env.ACCOUNTS.prepare(`SELECT device_id AS deviceId,
      created_at AS createdAt, revoked_at AS revokedAt FROM devices
      WHERE account_id=? ORDER BY device_id`).bind(principal.accountId).all();
    return Response.json({ devices: deviceListSchema.parse(rows.results) }, { headers: noStore });
  }
  if (!principal.scopes.includes("device:manage")) return activityError(403, "insufficient_scope");
  const consent = /^\/api\/devices\/([^/]+)\/consent$/.exec(path);
  if (consent?.[1] !== undefined) {
    const deviceId = decodeURIComponent(consent[1]);
    if (request.method === "GET") return readDeviceConsent(principal, deviceId, env);
    if (request.method === "POST") {
      return setDeviceConsent(principal, deviceId, await readBody(request, 256 * 1024), env);
    }
  }
  if (path === "/api/devices/grants" && request.method === "POST") {
    const { scopes } = grantRequestSchema.parse(await readBody(request));
    return Response.json(await issueDeviceGrant(principal, scopes, env), { status: 201, headers: noStore });
  }
  const revoke = /^\/api\/devices\/([^/]+)\/revoke$/.exec(path);
  if (revoke?.[1] !== undefined && request.method === "POST") {
    const deviceId = z.string().min(1).max(512).parse(decodeURIComponent(revoke[1]));
    const changed = await revokeDevice(principal, deviceId, env);
    return changed ? Response.json({ revoked: true }, { headers: noStore }) : activityError(404, "not_found");
  }
  return activityError(404, "not_found");
}

export async function activityRequest(request: Request, env: ActivityEnv): Promise<Response> {
  try {
    return await handle(request, env);
  } catch (error) {
    if (error instanceof AuthenticationError) return activityError(401, "unauthorized");
    if (error instanceof z.ZodError || error instanceof ActivityRequestError || error instanceof URIError) {
      return activityError(400, "invalid_request");
    }
    // HTTP boundary: fail closed without logging secrets or database internals.
    if (error instanceof Error) return activityError(503, "activity_unavailable");
    throw error;
  }
}
