import { z } from "zod";
import { AuthenticationError } from "./auth.ts";
import {
  activityConfig, activityError, browserPrincipal, noStore,
} from "./activity-auth.ts";
import type { ActivityEnv } from "./activity-auth.ts";
import { connectorScopeSchema } from "./activity-auth.ts";
import { privateSkillPagesRequest } from "./private-skills.ts";
import {
  exchangeDeviceGrant, issueDeviceGrant, readDevicePrincipal, revokeDevice,
} from "./device-auth.ts";
import { currentDeviceConsent, readDeviceConsent, setDeviceConsent } from "./activity-consent.ts";
import { ActivityRequestError, readBody } from "./activity-body.ts";
import { dashboardRequest } from "./activity-dashboard.ts";
import { eventRequest } from "./activity-events.ts";
import { privatePackPagesRequest } from "./private-packs.ts";
import { activityDeletionRequest } from "./activity-deletion.ts";

const grantRequestSchema = z.strictObject({
  scopes: z.array(connectorScopeSchema).min(1).max(4).readonly(),
});
const exchangeSchema = z.strictObject({ grant: z.string().min(32).max(128) });
const deviceListSchema = z.array(z.strictObject({
  deviceId: z.string(), createdAt: z.number(), revokedAt: z.number().nullable(),
}));

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
    if (path === "/v1/devices/self" && request.method === "GET") {
      return Response.json({
        accountId: principal.accountId, deviceId: principal.deviceId,
        generation: principal.generation, shardId: principal.shardId,
        scopes: principal.scopes,
        ingestEnabled: env.ACTIVITY_INGEST_ENABLED === "true" && env.ACTIVITY_SERVICE !== undefined,
        ...await currentDeviceConsent(env, principal),
      }, { headers: noStore });
    }
    const migration = /^\/v1\/activity\/migrations\/(begin|status|page|complete|export|rollback)$/.exec(path);
    const report = /^\/v1\/activity\/reports\/(status|result)$/.test(path);
    const command = /^\/v1\/activity\/commands\/(poll|ack)$/.test(path);
    if ((path === "/v1/activity/chunks" || path === "/v1/activity/batches" ||
        path === "/v1/activity/export" || path === "/v1/activity/query" ||
        path === "/v1/activity/context" || path === "/v1/activity/context/read" ||
        report || command || migration !== null) &&
        request.method === "POST") {
      const readOnly = path === "/v1/activity/export" || path === "/v1/activity/query" ||
        path === "/v1/activity/context/read" || report ||
        migration?.[1] === "status" || migration?.[1] === "export";
      if ((!readOnly && env.ACTIVITY_INGEST_ENABLED !== "true") || env.ACTIVITY_SERVICE === undefined) {
        return activityError(404, "not_found");
      }
      if (!principal.scopes.includes(readOnly ? "activity:read" : "activity:ingest")) {
        return activityError(403, "insufficient_scope");
      }
      // The internal Worker has no public routes. Forward only server-created
      // identity, never caller-supplied headers, cookies or authorization.
      const headers = new Headers({
        "content-type": request.headers.get("content-type") ?? "",
        "x-skillar-principal": JSON.stringify({
          ...principal,
          scopes: principal.scopes.filter(scope => scope === "activity:read" || scope === "activity:ingest"),
        }),
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
  if (path === "/api/changes" || path.startsWith("/api/events/")) return eventRequest(request, env, principal);
  if (path.startsWith("/api/dashboard/")) return dashboardRequest(request, env, principal);
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
    const path = new URL(request.url).pathname;
    if (path.replace(/\/$/, "") === "/api/activity/deletion") {
      return await activityDeletionRequest(request, env);
    }
    if (path.startsWith("/api/packs/") || path.startsWith("/v1/packs/")) {
      return await privatePackPagesRequest(request, env);
    }
    if (path === "/api/skills" || path.startsWith("/api/skills/") ||
        path === "/v1/skills" || path.startsWith("/v1/skills/")) {
      return await privateSkillPagesRequest(request, env);
    }
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
