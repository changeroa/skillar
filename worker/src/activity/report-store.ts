import {
  ANALYSIS_VERSION, reportReferenceSchema, reportRequestSchema, reportScopeOf, reportScopeSchema, sourceRevisionSchema,
} from "../../../shared/activity-query.ts";
import type { ReportReference, ReportRequest } from "../../../shared/activity-query.ts";
import { contentKinds } from "../../../shared/activity-schema.ts";
import { contentScope, requireContentConsent, requireContentReadConsent } from "./content-consent.ts";
import { activeFence, contentDigest } from "./content-db.ts";
import { ReportError, reportIdentity, reportJobSchema } from "./report-types.ts";
import type { ReportEnv, ReportJob } from "./report-types.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";

export const REPORT_PART_BYTES = 128 * 1024;
const encoder = new TextEncoder();
export const referenceOf = (job: ReportJob) => reportReferenceSchema.parse({
  deviceId: job.device_id, sourceDomain: job.source_domain, generation: job.generation, jobId: job.job_id,
});
export const revisionOf = (job: ReportJob) => ({
  sequence: job.input_sequence, journalThrough: job.input_cut,
});
export async function reportWrite<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("tenant_fenced")) throw new ActivityLedgerError("tenant_fenced");
      for (const code of ["report_conflict", "report_integrity"] as const) {
        if (error.message.includes(code)) throw new ReportError(code);
      }
    }
    throw error;
  }
}
export async function sourceRevision(env: ReportEnv, principal: IngestPrincipal, sourceDomain: string) {
  await activeFence(env.ACTIVITY, principal);
  const row = await env.ACTIVITY.prepare(`SELECT sequence,journal_through AS journalThrough
    FROM device_streams WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?`)
    .bind(principal.accountId, principal.generation, principal.deviceId, sourceDomain).first();
  if (row === null) throw new ReportError("source_missing", 404);
  return sourceRevisionSchema.parse(row);
}
export async function authorizeReport(env: ReportEnv, principal: IngestPrincipal, job: ReportJob) {
  reportIdentity(principal, referenceOf(job));
  await activeFence(env.ACTIVITY, principal);
  if (job.expires_at <= Date.now()) throw new ReportError("report_expired", 410);
  const scope = reportScopeSchema.parse(JSON.parse(job.scope_json));
  return requireContentReadConsent(env.ACCOUNTS, principal, contentScope(scope, contentKinds));
}
export async function loadReport(env: ReportEnv, principal: IngestPrincipal, input: unknown) {
  const reference = reportReferenceSchema.parse(input);
  const identity = reportIdentity(principal, reference);
  await activeFence(env.ACTIVITY, principal);
  const row = await env.ACTIVITY.prepare(`SELECT * FROM report_jobs
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=?`)
    .bind(...identity).first();
  if (row === null) throw new ReportError("report_missing", 404);
  const job = reportJobSchema.parse(row);
  await authorizeReport(env, principal, job);
  return job;
}
/** Intent precedes encrypted R2. Duplicate request IDs retain the first pinned revision. */
export async function prepareReport(
  env: ReportEnv, principal: IngestPrincipal, input: unknown,
  runtime: { sequence: number; sourceSequence: number; sourceCut: number; capturedAtMs: number },
) {
  const request = reportRequestSchema.parse(input);
  const reference = reportReferenceSchema.parse({
    deviceId: request.deviceId, sourceDomain: request.sourceDomain,
    generation: request.generation, jobId: request.requestId,
  });
  const identity = reportIdentity(principal, reference);
  await activeFence(env.ACTIVITY, principal);
  const consent = await requireContentConsent(env.ACCOUNTS, principal, contentScope(request, contentKinds));
  // Validate timezone even for a query without a current time-cell filter.
  new Intl.DateTimeFormat("en-US", { timeZone: request.tz });
  const bytes = encoder.encode(JSON.stringify(request));
  const hash = await contentDigest(bytes);
  const existing = await env.ACTIVITY.prepare(`SELECT * FROM report_jobs
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=?`)
    .bind(...identity).first();
  if (existing === null) {
    const revision = await sourceRevision(env, principal, request.sourceDomain);
    if (runtime.sourceSequence > revision.sequence || runtime.sourceCut > revision.journalThrough) {
      throw new ReportError("source_gap");
    }
    const now = Date.now(), days = Math.min(consent.retention.contentDays, consent.retention.projectionDays);
    const expires = Math.min(8_640_000_000_000_000, now + days * 86_400_000);
    await reportWrite(() => env.ACTIVITY.prepare(`INSERT INTO report_jobs
      (account_id,generation,device_id,source_domain,job_id,request_hash,scope_json,request_bytes,request_chunks,
        input_sequence,input_cut,input_runtime_sequence,input_runtime_captured_at,analysis_version,state,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'preparing',?,?)
      ON CONFLICT(account_id,generation,device_id,source_domain,job_id) DO NOTHING`)
      .bind(...identity, hash, JSON.stringify(reportScopeOf(request)), bytes.length,
        Math.ceil(bytes.length / REPORT_PART_BYTES), runtime.sourceSequence, runtime.sourceCut,
        runtime.sequence, runtime.capturedAtMs, ANALYSIS_VERSION, now, expires).run());
  }
  const job = await loadReport(env, principal, reference);
  if (job.request_hash !== hash || job.request_bytes !== bytes.length) throw new ReportError("report_conflict");
  return { request, job, bytes };
}
export async function queueReport(env: ReportEnv, principal: IngestPrincipal, job: ReportJob) {
  await authorizeReport(env, principal, job);
  await reportWrite(() => env.ACTIVITY.prepare(`UPDATE report_jobs SET state='queued'
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=? AND state='preparing'`)
    .bind(...reportIdentity(principal, referenceOf(job))).run());
}
export async function claimReport(env: ReportEnv, principal: IngestPrincipal, job: ReportJob) {
  await authorizeReport(env, principal, job);
  if (job.state === "complete") return job;
  if (job.state === "failed") throw new ReportError("report_conflict");
  const now = Date.now();
  const row = await reportWrite(() => env.ACTIVITY.prepare(`UPDATE report_jobs
    SET state='running',lease_fence=lease_fence+1,lease_until=?
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=?
      AND state IN ('queued','running') AND lease_until<=? RETURNING *`)
    .bind(now + 15 * 60_000, ...reportIdentity(principal, referenceOf(job)), now).first());
  if (row === null) throw new ReportError("report_busy", 503);
  return reportJobSchema.parse(row);
}
export async function releaseReport(env: ReportEnv, principal: IngestPrincipal, job: ReportJob) {
  await reportWrite(() => env.ACTIVITY.prepare(`UPDATE report_jobs SET lease_until=0
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=?
      AND state='running' AND lease_fence=?`)
    .bind(...reportIdentity(principal, referenceOf(job)), job.lease_fence).run());
}
export async function boundReportExpiry(
  env: ReportEnv, principal: IngestPrincipal, job: ReportJob, inputExpires: number,
) {
  const expires = Math.min(job.expires_at, inputExpires);
  if (expires <= Date.now()) throw new ReportError("report_expired", 410);
  const id = reportIdentity(principal, referenceOf(job));
  const results = await reportWrite(() => env.ACTIVITY.batch([
    env.ACTIVITY.prepare(`UPDATE report_jobs SET expires_at=?
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=?
        AND state='running' AND lease_fence=? AND lease_until>?`)
      .bind(expires, ...id, job.lease_fence, Date.now()),
    env.ACTIVITY.prepare(`UPDATE report_objects SET expires_at=min(expires_at,?)
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=?
        AND EXISTS(SELECT 1 FROM report_jobs j WHERE j.account_id=report_objects.account_id
          AND j.generation=report_objects.generation AND j.device_id=report_objects.device_id
          AND j.source_domain=report_objects.source_domain AND j.job_id=report_objects.job_id
          AND j.state='running' AND j.lease_fence=? AND j.lease_until>?)`)
      .bind(expires, ...id, job.lease_fence, Date.now()),
  ]));
  if (results[0]?.meta.changes !== 1) throw new ReportError("report_fenced");
  return { ...job, expires_at: expires };
}
export async function completeReport(
  env: ReportEnv, principal: IngestPrincipal, job: ReportJob,
  result: { readonly parts: number; readonly bytes: number; readonly hash: string },
) {
  await authorizeReport(env, principal, job);
  const row = await reportWrite(() => env.ACTIVITY.prepare(`UPDATE report_jobs
    SET state='complete',result_chunks=?,result_bytes=?,result_hash=?,lease_until=0
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=?
      AND state='running' AND lease_fence=? AND lease_until>? RETURNING *`)
    .bind(result.parts, result.bytes, result.hash, ...reportIdentity(principal, referenceOf(job)),
      job.lease_fence, Date.now()).first());
  if (row === null) throw new ReportError("report_fenced");
  return reportJobSchema.parse(row);
}
export async function verifyRequest(bytes: Uint8Array, job: ReportJob): Promise<ReportRequest> {
  if (bytes.length !== job.request_bytes || await contentDigest(bytes) !== job.request_hash) {
    throw new ReportError("report_integrity");
  }
  const request = reportRequestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (request.requestId !== job.job_id ||
      JSON.stringify(reportScopeOf(request)) !== job.scope_json) throw new ReportError("report_integrity");
  return request;
}
