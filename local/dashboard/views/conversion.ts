import { searchResult } from "../../src/request-status.js";
import type { TraceStep } from "../../src/types.js";

const str = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const candidateUris = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(candidate => str((candidate as Record<string, unknown> | null)?.uri)).filter((uri): uri is string => uri !== undefined)
    : [];


/**
 * 검색 후보로 표시된 횟수를 스킬 URI별로 센다 (스킬 화면 "검색 후보" 열).
 * 한 검색에서 같은 URI는 1회만 세고, skill_request가 추적하는 원시 search 이벤트는 건너뛴다.
 */
export function searchCandidateCounts(steps: readonly TraceStep[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const tracked = new Set(
    steps.filter(step => step.kind === "skill_request").map(step => str(step.detail.requestId)).filter((id): id is string => id !== undefined),
  );
  const seen = new Set<string>();
  steps.forEach((step, index) => {
    const data = step.detail as Record<string, unknown>;
    let key: string, uris: string[];
    if (step.kind === "skill_request" && data.operation === "search") {
      if (data.status === "in_progress" || searchResult(data).result !== "candidates_found") return;
      key = str(data.traceId) ?? str(data.requestId) ?? `wrapped-search-${index}`;
      uris = candidateUris(data.candidates);
      const first = str(data.firstCandidateUri) ?? uris[0];
      if (!uris.length && first) uris = [first];
    } else if (step.kind === "search") {
      if (tracked.has(str(data.requestId) ?? "")) return;
      key = str(data.traceId) ?? str(data.trace_id) ?? `search-${index}`;
      uris = candidateUris(data.candidates);
    } else return;
    if (seen.has(key)) return;
    seen.add(key);
    for (const uri of new Set(uris)) counts.set(uri, (counts.get(uri) ?? 0) + 1);
  });
  return counts;
}

/** 읽은 스킬 URI → 매니페스트 다이제스트 (버전 표시용). 같은 URI의 나중 읽기가 앞 읽기를 덮어쓴다. */
export function loadDigests(steps: readonly TraceStep[]): ReadonlyMap<string, string> {
  const digests = new Map<string, string>();
  for (const step of steps) {
    if (step.kind !== "load") continue;
    const data = step.detail as Record<string, unknown>;
    const uri = str(data.uri), digest = str(data.manifestDigest);
    if (uri && digest) digests.set(uri, digest);
  }
  return digests;
}
