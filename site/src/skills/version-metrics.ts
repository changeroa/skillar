import { z } from "zod";
import {
  dashboardPaths, dashboardReportStatusSchema, dashboardResultPartSchema,
  type DashboardProfile, type DashboardSource,
} from "../../../shared/dist/activity-dashboard.js";
import {
  aggregateVersionMetrics, loadRecordsFromSteps, privateVersionUri,
  VERSION_METRICS_SESSION_CAP,
  type LoadRecord, type SessionCandidate, type TraceStepLike, type VersionMetrics,
} from "./version-metrics-core.ts";

/** Failure from the activity query API; message is user-facing Korean, never server text. */
export class VersionMetricsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "VersionMetricsError";
    this.status = status;
  }
}

export function isMetricsUnauthorized(error: unknown): boolean {
  return error instanceof VersionMetricsError && error.status === 401;
}

type SessionRowLike = {
  readonly id: string;
  readonly runtime: string;
  readonly startedAt: number;
  readonly firstPrompt?: string | undefined;
};

const sessionRowSchema = z.looseObject({
  id: z.string(), runtime: z.string(), startedAt: z.number(), firstPrompt: z.string().optional(),
});
const sessionsPayloadSchema = z.array(sessionRowSchema);
const traceStepSchema = z.looseObject({ ts: z.number(), kind: z.string(), detail: z.record(z.string(), z.unknown()) });
const tracePayloadSchema = z.array(traceStepSchema);

const envelopeSchema = z.looseObject({
  generatedAt: z.number(),
  inputRevision: z.looseObject({ sequence: z.number(), journalThrough: z.number(), runtimeSequence: z.number() }),
  analysisVersion: z.number(),
  sourceCapturedAt: z.number(),
  sourceReceivedAt: z.number().nullable(),
  pending: z.literal(false),
  payload: z.unknown(),
});

const MAX_POLLS = 120;
const POLL_INTERVAL_MS = 1000;

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason instanceof Error ? signal.reason : new DOMException("취소되었습니다.", "AbortError")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function post(path: string, body: object, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST", credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
      signal, headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new VersionMetricsError(0, "활동 기록 요청이 skillar에 도달하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.");
  }
  if (response.status === 401) throw new VersionMetricsError(401, "활동 기록을 보려면 다시 로그인해 주세요.");
  if (!response.ok) {
    throw new VersionMetricsError(response.status,
      response.status >= 500 ? "활동 기록 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요." :
      response.status === 403 ? "이 기기나 동의 설정으로는 기록을 볼 수 없습니다. 대시보드에서 출처와 동의 설정을 확인해 주세요." :
      "활동 기록 요청을 완료하지 못했습니다. 다시 시도해 주세요.");
  }
  return response.json();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)),
    byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Assemble one cloud report with the same integrity checks as local/dashboard cloud-report. */
async function readReportPayload(status: z.output<typeof dashboardReportStatusSchema>, profile: DashboardSource, signal: AbortSignal): Promise<unknown> {
  const result = status.result;
  if (result === null || result.bytes > 512 * 1024 * 1024) {
    throw new VersionMetricsError(0, "활동 기록 보고서 구성 정보가 올바르지 않습니다.");
  }
  const bytes = new Uint8Array(result.bytes);
  let offset = 0;
  for (let index = 0; index < result.parts; index++) {
    const value = dashboardResultPartSchema.parse(await post(dashboardPaths.reportResult, { profile, jobId: status.jobId, part: index }, signal));
    if (value.index !== index || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.body)) {
      throw new VersionMetricsError(0, "활동 기록 보고서의 일부 데이터가 올바르지 않습니다.");
    }
    const chunk = Uint8Array.from(atob(value.body), char => char.charCodeAt(0));
    if (chunk.length !== value.bytes || offset + chunk.length > bytes.length || await sha256Hex(chunk) !== value.hash) {
      throw new VersionMetricsError(0, "활동 기록 보고서의 일부 데이터 검증에 실패했습니다.");
    }
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== result.bytes || await sha256Hex(bytes) !== result.hash) {
    throw new VersionMetricsError(0, "활동 기록 보고서 검증에 실패했습니다.");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const envelope = envelopeSchema.parse(JSON.parse(text));
  if (envelope.generatedAt !== status.generatedAt || envelope.analysisVersion !== status.analysisVersion ||
      envelope.inputRevision.sequence !== status.inputRevision.sequence ||
      envelope.inputRevision.journalThrough !== status.inputRevision.journalThrough ||
      envelope.inputRevision.runtimeSequence !== status.inputRevision.runtimeSequence ||
      envelope.sourceCapturedAt !== status.sourceCapturedAt || envelope.sourceReceivedAt !== status.sourceReceivedAt) {
    throw new VersionMetricsError(0, "활동 기록 보고서 버전 검증에 실패했습니다.");
  }
  return envelope.payload;
}

export async function runQuery(profile: DashboardSource, query: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  let status = dashboardReportStatusSchema.parse(await post(dashboardPaths.query, {
    profile, requestId: crypto.randomUUID(), query, tz: "Asia/Seoul",
  }, signal));
  const jobId = status.jobId;
  for (let polls = 0; ;) {
    if (status.jobId !== jobId) throw new VersionMetricsError(0, "활동 기록 보고서 식별 정보가 변경되었습니다.");
    switch (status.state) {
      case "failed":
        throw new VersionMetricsError(0, "활동 기록 보고서 생성에 실패했습니다. 출처를 사용할 수 있는지 확인하고 다시 시도해 주세요.");
      case "complete":
        if (status.pending) throw new VersionMetricsError(0, "활동 기록 보고서의 완료 상태가 올바르지 않습니다.");
        return readReportPayload(status, profile, signal);
      case "preparing": case "queued": case "running":
        if (polls++ >= MAX_POLLS) throw new VersionMetricsError(0, "활동 기록 보고서가 아직 준비 중입니다. 새로고침해 다시 시도해 주세요.");
        await wait(POLL_INTERVAL_MS, signal);
        status = dashboardReportStatusSchema.parse(await post(dashboardPaths.reportStatus, { profile, jobId }, signal));
        break;
    }
  }
}

async function querySessions(profile: DashboardSource, uri: string, from: number, to: number, signal: AbortSignal): Promise<readonly SessionRowLike[]> {
  const payload = await runQuery(profile, { kind: "sessions", filter: { from, to, skill: [uri] } }, signal);
  return sessionsPayloadSchema.parse(payload);
}

async function queryTrace(profile: DashboardSource, sessionId: string, signal: AbortSignal): Promise<readonly TraceStepLike[]> {
  const payload = await runQuery(profile, { kind: "trace", sessionId }, signal);
  return tracePayloadSchema.parse(payload);
}

export function loadRecords(payload: readonly TraceStepLike[]): readonly LoadRecord[] {
  return loadRecordsFromSteps(payload);
}

/**
 * J3: read load-request metrics for one hosted skill version across every ready activity source.
 * Sessions beyond the cap are reported as truncated, never silently dropped; failed traces are
 * excluded and counted, never tallied as zero loads. Auth failures abort the whole read.
 */
export async function readVersionMetrics(
  profiles: readonly DashboardProfile[], skillId: string, digest: string,
  from: number, to: number, signal: AbortSignal,
  cap = VERSION_METRICS_SESSION_CAP,
): Promise<VersionMetrics> {
  const uri = privateVersionUri(skillId, digest);
  const perSource = await Promise.all(profiles.map(async (profile) => {
    const source: DashboardSource = { deviceId: profile.deviceId, sourceDomain: profile.sourceDomain };
    const rows = await querySessions(source, uri, from, to, signal);
    return { source, rows };
  }));
  const candidates: SessionCandidate[] = [];
  const candidateSource = new Map<string, DashboardSource>();
  for (const { source, rows } of perSource) {
    for (const row of rows) {
      const key = `${source.deviceId}/${source.sourceDomain}/${row.id}`;
      candidates.push({ key, sessionId: row.id, runtime: row.runtime, startedAt: row.startedAt, firstPrompt: row.firstPrompt ?? null });
      candidateSource.set(key, source);
    }
  }
  const ordered = [...candidates].sort((a, b) => b.startedAt - a.startedAt || a.key.localeCompare(b.key));
  const sample = ordered.slice(0, cap);
  const traces = new Map<string, { readonly kind: "ok"; readonly steps: readonly TraceStepLike[] } | { readonly kind: "failed" }>();
  await Promise.all(sample.map(async (row) => {
    const source = candidateSource.get(row.key);
    if (source === undefined) { traces.set(row.key, { kind: "failed" }); return; }
    try {
      traces.set(row.key, { kind: "ok", steps: await queryTrace(source, row.sessionId, signal) });
    } catch (error) {
      if (isMetricsUnauthorized(error) || (error instanceof DOMException && error.name === "AbortError")) throw error;
      traces.set(row.key, { kind: "failed" });
    }
  }));
  return aggregateVersionMetrics(digest, profiles.length, candidates, skillId, traces, cap);
}
