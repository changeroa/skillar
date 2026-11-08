/** Status belongs to one request; a session is a collection, never a winning status. */
export const REQUEST_STATUSES = ["not_attempted", "in_progress", "succeeded", "failed", "cancelled", "unknown"] as const;
export type RequestStatus = typeof REQUEST_STATUSES[number];
export type Operation = "search" | "load";
export type SearchResult = "candidates_found" | "no_candidates";
export const NO_CANDIDATE_REASONS = ["empty_query", "no_overlap", "below_threshold", "explicit_only"] as const;
export type NoCandidateReason = typeof NO_CANDIDATE_REASONS[number];
export type RequestRecord = {
  id: string; operation: Operation; status: Exclude<RequestStatus, "not_attempted">;
  startedAt?: number; endedAt?: number; uri?: string; result?: SearchResult; reason?: NoCandidateReason;
  errorCode?: string;
};
export type OperationSummary = {
  total: number;
  counts: Record<Exclude<RequestStatus, "not_attempted">, number>;
  results: Record<SearchResult, number>;
  reasons: Partial<Record<NoCandidateReason, number>>;
};
export type RequestSummary = Record<Operation, OperationSummary>;

// A start event alone proves only that a request once started. Only the process executing it
// may call it in_progress. After a restart/import it is unknown, not failed or cancelled.
export const activeRequests = new Set<string>();

type Event = { id: string; ts: number; kind: string; skillUri?: string; data: Record<string, unknown> };
const str = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
export function searchResult(data: Record<string, unknown>): Pick<RequestRecord, "result" | "reason"> {
  const abstained = data.abstained as { reason?: unknown } | undefined;
  const reason = NO_CANDIDATE_REASONS.find((r) => r === abstained?.reason);
  // Use total, not this page's size: an empty page is not a search with no candidates.
  if (typeof data.total === "number" && data.total > 0 || Array.isArray(data.candidates) && data.candidates.length > 0) return { result: "candidates_found" };
  if (reason || data.total === 0) return { result: "no_candidates", ...(reason ? { reason } : {}) };
  return {};
}

export function requestRecords(events: readonly Event[], active: ReadonlySet<string> = activeRequests): RequestRecord[] {
  const records = new Map<string, RequestRecord>();
  const tracked = new Set(events.filter((e) => e.kind === "skill_request").map((e) => str(e.data.requestId)).filter(Boolean));
  for (const event of events) {
    const { data } = event;
    if (event.kind === "skill_request") {
      const id = str(data.requestId);
      const operation = data.operation;
      if (!id || operation !== "search" && operation !== "load") continue;
      const status = data.status;
      if (!REQUEST_STATUSES.includes(status as RequestStatus) || status === "not_attempted") continue;
      const previous = records.get(id);
      // Out-of-order delivery of a start must not overwrite a terminal outcome.
      if (status === "in_progress" && previous?.endedAt !== undefined) continue;
      records.set(id, {
        id, operation, status: status === "in_progress" ? active.has(id) ? "in_progress" : "unknown" : status as RequestRecord["status"],
        startedAt: previous?.startedAt ?? (typeof data.startedAt === "number" ? data.startedAt : event.ts),
        ...(status !== "in_progress" ? { endedAt: event.ts } : {}),
        ...(str(data.uri) ?? str(data.firstCandidateUri) ? { uri: str(data.uri) ?? str(data.firstCandidateUri) } : {}),
        ...(operation === "search" && status === "succeeded" ? searchResult(data) : {}),
        ...(str(data.errorCode) ? { errorCode: str(data.errorCode) } : {}),
      });
      continue;
    }
    if (tracked.has(str(data.requestId))) continue;
    // Historical completed search/load observations are still useful. Generic errors,
    // native skill activation, and supporting-file reads do not prove a load attempt.
    if (event.kind === "search" || event.kind === "load") {
      records.set(event.id, { id: event.id, operation: event.kind, status: "succeeded", endedAt: event.ts,
        ...(event.kind === "search" ? { ...searchResult(data), uri: Array.isArray(data.candidates) ? str(data.candidates[0]?.uri) : undefined } : { uri: event.skillUri ?? str(data.uri) }) });
    } else if (event.kind === "error") {
      const uri = event.skillUri ?? str(data.uri);
      const operation = data.tool === "search_skills" ? "search"
        : data.tool === "load_skill" || data.tool === "resources/read" && data.resourceKind !== "supporting_file" && uri?.endsWith("/SKILL.md") ? "load" : undefined;
      if (operation) records.set(event.id, { id: event.id, operation, status: "failed", endedAt: event.ts,
        ...(uri ? { uri } : {}), ...(str(data.code) ? { errorCode: str(data.code) } : {}) });
    }
  }
  return [...records.values()];
}

export function summarizeRequests(records: readonly RequestRecord[]): RequestSummary {
  const empty = (): OperationSummary => ({ total: 0, counts: { in_progress: 0, succeeded: 0, failed: 0, cancelled: 0, unknown: 0 },
    results: { candidates_found: 0, no_candidates: 0 }, reasons: {} });
  const summary = { search: empty(), load: empty() };
  for (const record of records) {
    const group = summary[record.operation];
    group.total++;
    group.counts[record.status]++;
    if (record.result) group.results[record.result]++;
    if (record.reason) group.reasons[record.reason] = (group.reasons[record.reason] ?? 0) + 1;
  }
  return summary;
}

export function hasStatus(summary: OperationSummary, status: RequestStatus): boolean {
  return status === "not_attempted" ? summary.total === 0 : summary.counts[status] > 0;
}
