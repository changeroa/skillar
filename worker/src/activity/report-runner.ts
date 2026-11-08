import { ANALYSIS_VERSION, reportReferenceSchema } from "../../../shared/activity-query.ts";
import { AnalysisReportError } from "../../../shared/activity-reports.ts";
import { contentDigest } from "./content-db.ts";
import { executeReport } from "./report-execute.ts";
import { readReportRequest } from "./report-objects.ts";
import { writeReportResult } from "./report-result.ts";
import { inputBatchExpiry, loadFactRows } from "./report-source.ts";
import {
  boundReportExpiry, claimReport, completeReport, loadReport, referenceOf, releaseReport,
  reportWrite, revisionOf, verifyRequest,
} from "./report-store.ts";
import { ReportError, reportIdentity, reportPrincipal } from "./report-types.ts";
import type { ReportEnv, ReportParams } from "./report-types.ts";
import { readRuntimeContext } from "./runtime-api.ts";
import { findRuntime, runtimeCommit } from "./runtime-store.ts";

/** No Oracle or VM binding is consulted. One source revision completes entirely in the core Worker. */
export async function runReport(env: ReportEnv, params: ReportParams) {
  const principal = reportPrincipal(params), reference = reportReferenceSchema.parse({
    deviceId: params.deviceId, sourceDomain: params.sourceDomain, generation: params.generation, jobId: params.jobId,
  });
  let job = await loadReport(env, principal, reference);
  if (job.state === "complete" || job.state === "failed") return { jobId: job.job_id, state: job.state };
  job = await claimReport(env, principal, job);
  try {
    if (job.analysis_version !== ANALYSIS_VERSION) throw new ReportError("analysis_version");
    const request = await verifyRequest(await readReportRequest(env, principal, job), job);
    const runtimeRow = await findRuntime(env.ACTIVITY, principal, job.source_domain, job.input_runtime_sequence);
    if (runtimeRow === null) throw new ReportError("source_gap");
    const commit = runtimeCommit(runtimeRow);
    const runtimeExpiry = await inputBatchExpiry(env, principal, job.source_domain,
      commit.batchId, commit.consentVersion, true);
    const runtime = await readRuntimeContext(env, principal, {
      sourceDomain: job.source_domain, sequence: job.input_runtime_sequence,
    });
    if (runtime.sourceSequence !== job.input_sequence || runtime.sourceCut !== job.input_cut ||
        runtime.capturedAtMs !== job.input_runtime_captured_at) throw new ReportError("source_gap");
    const snapshot = await loadFactRows(env, principal, request, revisionOf(job));
    job = await boundReportExpiry(env, principal, job, Math.min(snapshot.expiresAt, runtimeExpiry));
    const payload = executeReport(request, snapshot.rows, runtime.context, job.created_at);
    const result = await writeReportResult(env, principal, job, {
      generatedAt: job.created_at,
      inputRevision: { ...revisionOf(job), runtimeSequence: job.input_runtime_sequence },
      analysisVersion: job.analysis_version, coverage: snapshot.coverage,
      sourceCapturedAt: job.input_runtime_captured_at, sourceReceivedAt: runtime.receivedAtMs, pending: false, payload,
    });
    await completeReport(env, principal, job, result);
    return { jobId: job.job_id, state: "complete" };
  } catch (error) {
    if (error instanceof AnalysisReportError ||
        (error instanceof ReportError && error.status !== 503)) {
      await reportWrite(() => env.ACTIVITY.prepare(`UPDATE report_jobs
        SET state='failed',error_code=?,lease_until=0
        WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=?
          AND state='running' AND lease_fence=?`)
        .bind(error.code, ...reportIdentity(principal, referenceOf(job)), job.lease_fence).run());
      return { jobId: job.job_id, state: "failed", error: error.code };
    }
    await releaseReport(env, principal, job);
    // Workflow retries must never persist exception messages containing query or source text.
    throw new Error("report_processing_unavailable");
  }
}
export async function reportInstanceId(params: ReportParams) {
  return contentDigest(new TextEncoder().encode(JSON.stringify([
    params.accountId, params.generation, params.deviceId, params.sourceDomain, params.jobId,
  ])));
}
