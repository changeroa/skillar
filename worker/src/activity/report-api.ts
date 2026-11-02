import { z } from "zod";
import { reportReferenceSchema, reportRequestSchema } from "../../../shared/activity-query.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";
import { ContentConsentError, contentScope, requireContentConsent } from "./content-consent.ts";
import { contentKinds } from "../../../shared/activity-schema.ts";
import { readReportPart, writeReportDocument } from "./report-objects.ts";
import { reportInstanceId } from "./report-runner.ts";
import {
  loadReport, prepareReport, queueReport, referenceOf, reportWrite, revisionOf, sourceRevision,
} from "./report-store.ts";
import { ReportError, reportIdentity, reportJobSchema, reportPrincipal } from "./report-types.ts";
import type { ReportEnv, ReportJob, ReportParams } from "./report-types.ts";
import { latestRuntimeRevision } from "./runtime-api.ts";

async function ensureWorkflow(env: ReportEnv, job: ReportJob) {
  if (!env.REPORT_FLOW) throw new ReportError("report_unavailable", 503);
  const params: ReportParams = { ...referenceOf(job), accountId: job.account_id };
  const id = await reportInstanceId(params);
  try {
    const instance = await env.REPORT_FLOW.create({
      id, params, retention: { successRetention: "1 day", errorRetention: "1 day" },
    });
    if (instance.id !== id) throw new ReportError("report_integrity");
    return instance;
  } catch (error) {
    if (error instanceof ReportError) throw error;
    // A lost create response and a duplicate ID are settled by the durable instance, not by a retry delay.
    try {
      const instance = await env.REPORT_FLOW.get(id);
      await instance.status();
      return instance;
    } catch (lookupError) {
      if (lookupError instanceof Error) throw new ReportError("report_unavailable", 503);
      throw lookupError;
    }
  }
}
async function statusOf(env: ReportEnv, principal: IngestPrincipal, original: ReportJob) {
  let job = original;
  if (job.state === "queued" || job.state === "running") {
    const instance = await ensureWorkflow(env, job);
    const status = await instance.status();
    if (status.status === "errored" || status.status === "terminated") {
      await reportWrite(() => env.ACTIVITY.prepare(`UPDATE report_jobs SET state='failed',
        error_code='report_processing_unavailable',lease_until=0
        WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=?
          AND state IN ('queued','running')`)
        .bind(...reportIdentity(principal, referenceOf(job))).run());
      job = await loadReport(env, principal, referenceOf(job));
    }
  }
  const current = await sourceRevision(env, principal, job.source_domain);
  const runtime = z.object({ sequence: z.number().int(), received_at_ms: z.number().nullable() }).parse(await env.ACTIVITY.prepare(
    `SELECT COALESCE(max(sequence),0) AS sequence,
      max(CASE WHEN sequence=? THEN received_at_ms END) AS received_at_ms FROM runtime_contexts
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?`,
  ).bind(job.input_runtime_sequence, principal.accountId, principal.generation, principal.deviceId, job.source_domain).first());
  return {
    schemaVersion: 1, jobId: job.job_id, state: job.state,
    generatedAt: job.created_at, sourceCapturedAt: job.input_runtime_captured_at,
    sourceReceivedAt: runtime.received_at_ms,
    inputRevision: { ...revisionOf(job), runtimeSequence: job.input_runtime_sequence },
    analysisVersion: job.analysis_version,
    stale: current.sequence !== job.input_sequence || current.journalThrough !== job.input_cut ||
      runtime.sequence !== job.input_runtime_sequence || runtime.received_at_ms === null ||
      Date.now() - runtime.received_at_ms > 60_000,
    pending: job.state !== "complete" && job.state !== "failed",
    error: job.error_code,
    result: job.state === "complete" ? {
      parts: job.result_chunks, bytes: job.result_bytes, hash: job.result_hash,
    } : null,
  };
}
export async function startReport(env: ReportEnv, principal: IngestPrincipal, input: unknown) {
  const request = reportRequestSchema.parse(input);
  if (!env.REPORT_FLOW) throw new ReportError("report_unavailable", 503);
  await requireContentConsent(env.ACCOUNTS, principal, contentScope(request, contentKinds));
  const runtime = await latestRuntimeRevision(env, principal, request.sourceDomain);
  if (runtime === null) throw new ReportError("report_pending", 503);
  const prepared = await prepareReport(env, principal, request, runtime);
  if (prepared.job.state === "preparing") {
    await writeReportDocument(env, principal, prepared.job, "request", prepared.bytes);
    await queueReport(env, principal, prepared.job);
  }
  return statusOf(env, principal, await loadReport(env, principal, referenceOf(prepared.job)));
}
export async function reportStatus(env: ReportEnv, principal: IngestPrincipal, input: unknown) {
  return statusOf(env, principal, await loadReport(env, principal, input));
}
const resultRequest = reportReferenceSchema.unwrap().extend({ part: z.number().int().nonnegative() });
export async function reportResult(env: ReportEnv, principal: IngestPrincipal, input: unknown) {
  const { part, ...reference } = resultRequest.parse(input);
  const job = await loadReport(env, principal, reference);
  if (job.state !== "complete") throw new ReportError("report_pending");
  if (job.result_chunks === null || part >= job.result_chunks) throw new ReportError("report_missing", 404);
  const result = await readReportPart(env, principal, job, "result", part);
  let binary = "";
  for (let offset = 0; offset < result.bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...result.bytes.subarray(offset, offset + 0x8000));
  }
  return { index: part, bytes: result.bytes.length, hash: result.hash, body: btoa(binary) };
}
/** Recover queued dispatch after a crash; no plaintext request or result enters the Workflow parameters. */
export async function dispatchPendingReports(env: ReportEnv) {
  if (!env.REPORT_FLOW) return { dispatched: 0 };
  const rows = z.array(reportJobSchema).parse((await env.ACTIVITY.prepare(
    `SELECT j.* FROM report_jobs j JOIN tenant_fences f ON f.account_id=j.account_id
      AND f.generation=j.generation AND f.state='active' WHERE j.expires_at>? AND
      (j.state IN ('queued','running') AND j.lease_until<=? OR j.state='preparing' AND
        j.request_chunks=(SELECT count(*) FROM report_objects o WHERE o.account_id=j.account_id
          AND o.generation=j.generation AND o.device_id=j.device_id AND o.source_domain=j.source_domain
          AND o.job_id=j.job_id AND o.role='request' AND o.state IN ('stored','committed')))
      ORDER BY j.dispatch_order,j.created_at,j.job_id LIMIT 20`,
  ).bind(Date.now(), Date.now()).all()).results);
  let dispatched = 0;
  for (const row of rows) {
    const principal = reportPrincipal({ ...referenceOf(row), accountId: row.account_id });
    try {
      await reportWrite(() => env.ACTIVITY.prepare(`UPDATE report_jobs
        SET dispatch_order=(SELECT COALESCE(max(dispatch_order),0)+1 FROM report_jobs)
        WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=?`)
        .bind(...reportIdentity(principal, referenceOf(row))).run());
      const job = await loadReport(env, principal, referenceOf(row));
      if (job.state === "preparing") await queueReport(env, principal, job);
      await statusOf(env, principal, await loadReport(env, principal, referenceOf(job)));
      dispatched++;
    } catch (error) {
      if (!(error instanceof ActivityLedgerError || error instanceof ContentConsentError ||
          error instanceof ReportError)) throw error;
    }
  }
  return { dispatched };
}
