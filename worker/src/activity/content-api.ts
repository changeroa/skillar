import { z } from "zod";
import {
  accountIdSchema, ActivityContractError, deviceIdSchema, MAX_BATCH_BYTES, sourceDomainSchema,
} from "../../../shared/activity-schema.ts";
import { ContentContractError } from "../../../shared/activity-content.ts";
import { ContentConsentError } from "./content-consent.ts";
import { sweepContent } from "./content-db.ts";
import type { ContentEnv } from "./content-env.ts";
import type { ReportEnv } from "./report-types.ts";
import { ReportError } from "./report-types.ts";
import { dispatchPendingReports, reportResult, reportStatus, startReport } from "./report-api.ts";
import { sweepReports } from "./report-objects.ts";
import { commitRuntime, readRuntimeContext } from "./runtime-api.ts";
import { RuntimeError } from "./runtime-store.ts";
import { ContentStorageError } from "./content-keys.ts";
import { storeContentChunk } from "./content-objects.ts";
import { acceptContentBatch } from "./content-service.ts";
import { exportContent } from "./export-service.ts";
import { ManagedCryptoError } from "./crypto.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";
import {
  beginMigration, completeMigration, exportMigration, migrationStatus,
  rollbackMigration, stageMigrationPage, MigrationError,
} from "./migrations.ts";
import { MigrationContractError } from "../../../shared/activity-sync.ts";
import { dashboardServicePaths } from "../../../shared/activity-dashboard.ts";
import { dashboardProfiles } from "./dashboard-profiles.ts";
import { DashboardEvalError, storeDashboardEvalCase } from "./dashboard-eval.ts";
import { sweepDashboardEvalCases } from "./dashboard-eval-cleanup.ts";

const internalPrincipalSchema = z.strictObject({
  kind: z.literal("device"), accountId: accountIdSchema, deviceId: deviceIdSchema,
  generation: z.number().int().positive(), shardId: z.literal("activity-00"),
  issuer: z.enum(["https://skillar.sh", "https://skillar-site.pages.dev"]),
  sessionId: z.null(),
  scopes: z.array(z.enum(["activity:read", "activity:ingest"])).min(1).readonly(),
}).readonly();
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const runtimeReadSchema = z.strictObject({
  sourceDomain: sourceDomainSchema, sequence: z.number().int().positive().optional(),
});
const migrationHandlers = new Map<string,
  (env: ContentEnv, principal: IngestPrincipal, input: unknown) => Promise<unknown>>([
  ["/v1/activity/migrations/begin", beginMigration],
  ["/v1/activity/migrations/status", migrationStatus],
  ["/v1/activity/migrations/page", stageMigrationPage],
  ["/v1/activity/migrations/complete", completeMigration],
  ["/v1/activity/migrations/export", exportMigration],
  ["/v1/activity/migrations/rollback", rollbackMigration],
]);
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
export async function activityContentRequest(request: Request, env: ReportEnv): Promise<Response> {
  const url = new URL(request.url);
  const readOnly = url.pathname === dashboardServicePaths.profiles || url.pathname === "/v1/activity/migrations/status" ||
    url.pathname === "/v1/activity/migrations/export" || url.pathname === "/v1/activity/export" ||
    url.pathname === "/v1/activity/query" || url.pathname === "/v1/activity/reports/status" ||
    url.pathname === "/v1/activity/reports/result" || url.pathname === "/v1/activity/context/read";
  if (!readOnly && env.ACTIVITY_INGEST_ENABLED !== "true") {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  if (url.origin !== "https://activity.internal" || request.method !== "POST") {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  try {
    const identity = request.headers.get("x-skillar-principal");
    if (identity === null) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (url.pathname === dashboardServicePaths.profiles) {
      return Response.json(await dashboardProfiles(env, JSON.parse(identity)), { headers });
    }
    const principal = internalPrincipalSchema.parse(JSON.parse(identity));
    const path = url.pathname;
    if (path === dashboardServicePaths.evalCases) {
      return Response.json(await storeDashboardEvalCase(env, principal, await body(request)), { status: 201, headers });
    }
    if (path === "/v1/activity/query") {
      return Response.json(await startReport(env, principal, await body(request)), { status: 202, headers });
    }
    if (path === "/v1/activity/reports/status") {
      return Response.json(await reportStatus(env, principal, await body(request)), { headers });
    }
    if (path === "/v1/activity/reports/result") {
      return Response.json(await reportResult(env, principal, await body(request)), { headers });
    }
    if (path === "/v1/activity/context") {
      return Response.json(await commitRuntime(env, principal, await body(request)), { headers });
    }
    if (path === "/v1/activity/context/read") {
      return Response.json(await readRuntimeContext(env, principal, runtimeReadSchema.parse(await body(request))), { headers });
    }
    if (path === "/v1/activity/export") {
      return Response.json(await exportContent(env, principal, await body(request)), { headers });
    }
    const migration = migrationHandlers.get(path);
    if (migration !== undefined) {
      return Response.json(await migration(env, principal, await body(request)), { headers });
    }
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
        error instanceof ContentConsentError || error instanceof ContentHttpError ||
        error instanceof MigrationError || error instanceof MigrationContractError ||
        error instanceof ReportError || error instanceof RuntimeError || error instanceof DashboardEvalError) {
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
  scheduled(_event: ScheduledController, env: ReportEnv, context: ExecutionContext) {
    context.waitUntil(Promise.all([
      sweepContent(env.ACTIVITY, env.ACTIVITY_RAW), sweepReports(env), dispatchPendingReports(env),
      sweepDashboardEvalCases(env),
    ]));
  },
};
