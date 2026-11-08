import { z } from "zod";
import {
  dashboardEvalReceiptSchema, dashboardEvalRequestSchema, dashboardPaths,
  dashboardProfilesSchema, dashboardQuerySchema, dashboardReferenceSchema,
  dashboardReportStatusSchema, dashboardResultPartRequestSchema, dashboardResultPartSchema,
  dashboardServicePaths,
} from "../../shared/dist/activity-dashboard.js";
import type { DashboardSource } from "../../shared/dist/activity-dashboard.js";
import { contentKinds } from "../../shared/dist/activity-schema.js";
import { reportRequestSchema } from "../../shared/dist/activity-query.js";
import {
  activityError, browserPrincipal, devicePrincipalSchema, noStore, sourceNamespace,
} from "./activity-auth.ts";
import type { ActivityEnv, BrowserPrincipal } from "./activity-auth.ts";
import { currentDeviceConsent } from "./activity-consent.ts";
import { readBody } from "./activity-body.ts";
import {
  sourceCommandRequestSchema, commandStatusRequestSchema, commandStatusSchema,
} from "../../shared/dist/activity-commands.js";

async function ownedConsent(env: ActivityEnv, principal: BrowserPrincipal, profile: DashboardSource) {
  const owned = await sourceNamespace(principal, { ...profile, sourceId: "dashboard" }, env.ACCOUNTS);
  return owned === null ? null : currentDeviceConsent(env, { ...principal, deviceId: profile.deviceId });
}

/** The private service sees only server-created identity, never browser credentials. */
async function service(
  env: ActivityEnv, principal: BrowserPrincipal, path: string, input: unknown, profile?: DashboardSource,
) {
  if (env.ACTIVITY_SERVICE === undefined) return activityError(503, "dashboard_unavailable");
  const identity = profile === undefined ? principal : devicePrincipalSchema.parse({
    ...principal, kind: "device", sessionId: null, deviceId: profile.deviceId, scopes: ["activity:read"],
  });
  return env.ACTIVITY_SERVICE.fetch(new Request(`https://activity.internal${path}`, {
    method: "POST", headers: {
      "content-type": "application/json", "x-skillar-principal": JSON.stringify(identity),
    }, body: JSON.stringify(input),
  }));
}

/** Buffer before rechecking session/consent so logout cannot release an in-flight private result. */
async function release(
  request: Request, env: ActivityEnv, principal: BrowserPrincipal, response: Response,
  schema: z.ZodType, profile?: DashboardSource, consentVersion?: number,
): Promise<Response> {
  const body: unknown = await response.json();
  const current = await browserPrincipal(request, env);
  if (current === null || current.accountId !== principal.accountId ||
      current.generation !== principal.generation || current.sessionId !== principal.sessionId) {
    return activityError(401, "unauthorized");
  }
  if (profile !== undefined) {
    const consent = await ownedConsent(env, current, profile);
    if (consent === null) return activityError(404, "not_found");
    if (consent.version !== consentVersion) return activityError(409, "consent_conflict");
  }
  if (!response.ok) {
    const error = z.object({ error: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/) }).safeParse(body);
    return activityError(response.status, error.success ? error.data.error : "dashboard_unavailable");
  }
  return Response.json(schema.parse(body), { status: response.status, headers: noStore });
}

export async function dashboardRequest(
  request: Request, env: ActivityEnv, principal: BrowserPrincipal,
): Promise<Response> {
  if (!principal.scopes.includes("activity:read")) return activityError(403, "insufficient_scope");
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path === dashboardPaths.status && request.method === "GET") {
    return Response.json({ ok: true, version: "cloud", transport: "snapshot" }, { headers: noStore });
  }
  if (path === dashboardPaths.profiles && request.method === "GET") {
    const response = await service(env, principal, dashboardServicePaths.profiles, {});
    const checked = await release(request, env, principal, response, dashboardProfilesSchema);
    if (!checked.ok) return checked;
    const profiles = dashboardProfilesSchema.parse(await checked.json());
    return Response.json({
      ...profiles, ingestEnabled: profiles.ingestEnabled && env.ACTIVITY_INGEST_ENABLED === "true",
    }, { headers: noStore });
  }
  if (request.method !== "POST") return activityError(404, "not_found");
  if (![dashboardPaths.query, dashboardPaths.reportStatus, dashboardPaths.reportResult,
    dashboardPaths.evalCases, "/api/dashboard/commands", "/api/dashboard/commands/status"]
    .some(route => route === path)) return activityError(404, "not_found");
  if ((path === dashboardPaths.evalCases || path === "/api/dashboard/commands") &&
      env.ACTIVITY_INGEST_ENABLED !== "true") {
    return activityError(404, "not_found");
  }
  const input = await readBody(request, 256 * 1024);
  const parsed = path === dashboardPaths.query ? dashboardQuerySchema.parse(input) :
    path === "/api/dashboard/commands" ? sourceCommandRequestSchema.parse(input) :
    path === "/api/dashboard/commands/status" ? commandStatusRequestSchema.parse(input) :
    path === dashboardPaths.reportResult ? dashboardResultPartRequestSchema.parse(input) :
    path === dashboardPaths.evalCases ? dashboardEvalRequestSchema.parse(input) :
    dashboardReferenceSchema.parse(input);
  const { profile } = parsed;
  const saved = await ownedConsent(env, principal, profile);
  if (saved === null) return activityError(404, "not_found");
  const consent = saved.consent;
  if (consent.mode !== "managed-content") return activityError(403, "consent_required");
  const needed = path === dashboardPaths.evalCases ? ["query"] : contentKinds;
  if (!needed.every(kind => consent.contentKinds.some(allowed => allowed === kind)) ||
      !consent.scope.projectIds.includes(`device:${profile.deviceId}`)) {
    return activityError(403, "content_not_allowed");
  }
  let servicePath: string;
  let body: unknown;
  let schema: z.ZodType;
  switch (path) {
    case "/api/dashboard/commands":
      body = sourceCommandRequestSchema.parse(input);
      servicePath = "/v1/activity/commands/enqueue";
      schema = commandStatusSchema;
      break;
    case "/api/dashboard/commands/status":
      body = commandStatusRequestSchema.parse(input);
      servicePath = "/v1/activity/commands/status";
      schema = commandStatusSchema;
      break;
    case dashboardPaths.query: {
      const query = dashboardQuerySchema.parse(input);
      const backfill = consent.backfill;
      body = reportRequestSchema.parse({
        schemaVersion: 1, requestId: query.requestId, ...profile,
        generation: principal.generation, consentVersion: saved.version,
        projectId: `device:${profile.deviceId}`, rootId: null,
        range: backfill?.range ?? { fromMs: consent.grantedAtMs, toMs: 8_640_000_000_000_000 },
        backfill: backfill === undefined ? null : {
          version: backfill.version, snapshotId: backfill.snapshotId, journalCut: backfill.journalCut,
        },
        tz: query.tz, query: query.query,
      });
      servicePath = "/v1/activity/query";
      schema = dashboardReportStatusSchema;
      break;
    }
    case dashboardPaths.evalCases:
      body = dashboardEvalRequestSchema.parse(input);
      servicePath = dashboardServicePaths.evalCases;
      schema = dashboardEvalReceiptSchema;
      break;
    case dashboardPaths.reportResult: {
      const result = dashboardResultPartRequestSchema.parse(input);
      body = { ...profile, generation: principal.generation, jobId: result.jobId, part: result.part };
      servicePath = "/v1/activity/reports/result";
      schema = dashboardResultPartSchema;
      break;
    }
    default: {
      const reference = dashboardReferenceSchema.parse(input);
      body = { ...profile, generation: principal.generation, jobId: reference.jobId };
      servicePath = "/v1/activity/reports/status";
      schema = dashboardReportStatusSchema;
    }
  }
  const response = await service(env, principal, servicePath, body, profile);
  return release(request, env, principal, response, schema, profile, saved.version);
}
