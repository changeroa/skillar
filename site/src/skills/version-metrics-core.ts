/** J3: per-version read metrics for the hosted skill compare tab. Pure, testable core. */

export const VERSION_METRICS_SESSION_CAP = 20;
export const VERSION_METRICS_PERIODS = [7, 30] as const;

/** Loads observed by the hosting MCP are tagged skill://private/<skillId>/<digest>/<path> (worker private-mcp handler). */
export const PRIVATE_LOAD_URI = /^skill:\/\/private\/([^/]+)\/([a-f0-9]{64})\//;

export function privateVersionUri(skillId: string, digest: string): string {
  return `skill://private/${skillId}/${digest}/SKILL.md`;
}

/** 11/02 request statuses a finished or observed load request can hold (never not_attempted). */
export type LoadStatus = "in_progress" | "succeeded" | "failed" | "cancelled" | "unknown";
export const COUNTED_STATUSES: readonly LoadStatus[] = ["succeeded", "failed", "cancelled", "in_progress", "unknown"];
export const LOAD_STATUS_LABEL: Record<LoadStatus, string> = {
  succeeded: "성공", failed: "실패", cancelled: "취소됨", in_progress: "진행 중", unknown: "알 수 없음",
};

export type LoadRecord = {
  readonly id: string;
  readonly status: LoadStatus;
  readonly uri?: string;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly errorCode?: string;
};

/** One trace step as the dashboard query API returns it. */
export type TraceStepLike = {
  readonly ts: number;
  readonly kind: string;
  readonly detail: Record<string, unknown>;
};

const str = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const LOAD_STATUSES: readonly string[] = ["in_progress", "succeeded", "failed", "cancelled", "unknown"];

/**
 * Load-only mirror of local/src/request-status.ts requestRecords (11/02 model; that module lives
 * outside the strict site program, so the rules are restated here and parity-tested against it):
 * - skill_request steps track a request by id; a late start never overwrites a terminal outcome.
 * - Historical in_progress reads as unknown: only the executing process may call it in_progress.
 * - Untracked load steps are completed observations: succeeded.
 * - Untracked error steps count as failed only for load tools, never for supporting-file reads.
 * Keep in sync with requestRecords; site/test/j3-version-metrics.test.mjs asserts parity.
 */
export function loadRecordsFromSteps(steps: readonly TraceStepLike[]): LoadRecord[] {
  const records = new Map<string, LoadRecord>();
  const tracked = new Set(
    steps.filter(step => step.kind === "skill_request").map(step => str(step.detail["requestId"])).filter(Boolean),
  );
  for (const [index, step] of steps.entries()) {
    const data = step.detail;
    if (step.kind === "skill_request") {
      const id = str(data["requestId"]);
      if (id === undefined || data["operation"] !== "load") continue;
      const status = data["status"];
      if (typeof status !== "string" || !LOAD_STATUSES.includes(status)) continue;
      const previous = records.get(id);
      if (status === "in_progress" && previous?.endedAt !== undefined) continue;
      const uri = str(data["uri"]) ?? str(data["firstCandidateUri"]);
      const errorCode = str(data["errorCode"]);
      records.set(id, {
        id,
        status: status === "in_progress" ? "unknown" : status as LoadStatus,
        startedAt: previous?.startedAt ?? (typeof data["startedAt"] === "number" ? data["startedAt"] : step.ts),
        ...(status !== "in_progress" ? { endedAt: step.ts } : {}),
        ...(uri !== undefined ? { uri } : {}),
        ...(errorCode !== undefined ? { errorCode } : {}),
      });
      continue;
    }
    const requestId = str(data["requestId"]);
    if (requestId !== undefined && tracked.has(requestId)) continue;
    if (step.kind === "load") {
      const uri = str(data["uri"]);
      records.set(`step-${index}`, { id: `step-${index}`, status: "succeeded", endedAt: step.ts, ...(uri !== undefined ? { uri } : {}) });
    } else if (step.kind === "error") {
      const uri = str(data["uri"]);
      const tool = data["tool"];
      const isLoad = tool === "load_skill" ||
        tool === "resources/read" && data["resourceKind"] !== "supporting_file" && uri?.endsWith("/SKILL.md") === true;
      if (!isLoad) continue;
      const code = str(data["code"]);
      records.set(`step-${index}`, {
        id: `step-${index}`, status: "failed", endedAt: step.ts,
        ...(uri !== undefined ? { uri } : {}), ...(code !== undefined ? { errorCode: code } : {}),
      });
    }
  }
  return [...records.values()];
}

export type LoadTally = {
  readonly total: number;
  readonly counts: Record<LoadStatus, number>;
};

export function emptyTally(): LoadTally {
  return { total: 0, counts: { succeeded: 0, failed: 0, cancelled: 0, in_progress: 0, unknown: 0 } };
}

/** Count load requests whose URI names exactly this skill version. Other versions are ignored. */
export function countLoads(records: readonly LoadRecord[], skillId: string, digest: string): LoadTally {
  const counts: Record<LoadStatus, number> = { succeeded: 0, failed: 0, cancelled: 0, in_progress: 0, unknown: 0 };
  let total = 0;
  for (const record of records) {
    if (record.uri === undefined) continue;
    const match = PRIVATE_LOAD_URI.exec(record.uri);
    if (match === null || match[1] !== skillId || match[2] !== digest) continue;
    counts[record.status] += 1;
    total += 1;
  }
  return { total, counts };
}

export type VersionSessionEntry = {
  readonly key: string;
  readonly sessionId: string;
  readonly runtime: string;
  readonly startedAt: number;
  readonly firstPrompt: string | null;
  /** Loads of this version in the session; null when the trace could not be read (excluded from totals). */
  readonly loadCount: number | null;
};

export type SessionCandidate = {
  readonly key: string;
  readonly sessionId: string;
  readonly runtime: string;
  readonly startedAt: number;
  readonly firstPrompt: string | null;
};

export function sortCandidates(rows: readonly SessionCandidate[]): SessionCandidate[] {
  return [...rows].sort((a, b) => b.startedAt - a.startedAt || a.key.localeCompare(b.key));
}

export type VersionMetrics = {
  readonly digest: string;
  readonly sources: number;
  /** Sessions naming this version in the period, across every ready source. */
  readonly sessionsTotal: number;
  /** Sessions actually sampled (at most VERSION_METRICS_SESSION_CAP). */
  readonly sessionsSampled: number;
  /** Sampled sessions whose trace could not be read; never counted as zero loads. */
  readonly sessionsExcluded: number;
  readonly truncated: boolean;
  readonly loadTotal: number;
  readonly counts: Record<LoadStatus, number>;
  readonly sessions: readonly VersionSessionEntry[];
};

export type TraceOutcome =
  | { readonly kind: "ok"; readonly steps: readonly TraceStepLike[] }
  | { readonly kind: "failed" };

export function aggregateVersionMetrics(
  digest: string, sources: number, candidates: readonly SessionCandidate[],
  skillId: string, traces: ReadonlyMap<string, TraceOutcome>, cap = VERSION_METRICS_SESSION_CAP,
): VersionMetrics {
  const ordered = sortCandidates(candidates);
  const sample = ordered.slice(0, cap);
  const counts: Record<LoadStatus, number> = { succeeded: 0, failed: 0, cancelled: 0, in_progress: 0, unknown: 0 };
  let loadTotal = 0;
  let excluded = 0;
  const sessions: VersionSessionEntry[] = [];
  for (const row of sample) {
    const outcome = traces.get(row.key);
    if (outcome === undefined || outcome.kind === "failed") {
      excluded += 1;
      sessions.push({ ...row, loadCount: null });
      continue;
    }
    const { total, counts: perSession } = countLoads(loadRecordsFromSteps(outcome.steps), skillId, digest);
    for (const status of COUNTED_STATUSES) counts[status] += perSession[status];
    loadTotal += total;
    sessions.push({ ...row, loadCount: total });
  }
  return {
    digest, sources, sessionsTotal: ordered.length, sessionsSampled: sample.length,
    sessionsExcluded: excluded, truncated: ordered.length > sample.length,
    loadTotal, counts, sessions,
  };
}

export type SampleNoteInput = {
  readonly sources: number;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly sessionsTotal: number;
  readonly sessionsSampled: number;
  readonly sessionsExcluded: number;
};

/** Honest sample scope: never reads as a full-period result when truncated or partially failed. */
export function sampleNote(input: SampleNoteInput): string {
  const base = `출처 ${input.sources}개 · ${input.fromLabel} ~ ${input.toLabel} KST · 세션 ${input.sessionsTotal}개`;
  const sampled = input.sessionsTotal > input.sessionsSampled ? ` 중 최근 ${input.sessionsSampled}개만 집계` : " 전부 집계";
  const excluded = input.sessionsExcluded > 0 ? ` · 조회 실패로 제외 ${input.sessionsExcluded}개` : "";
  return `${base}${sampled}${excluded} · 읽기 URI가 기록된 세션만 포함`;
}
