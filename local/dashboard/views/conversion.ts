import { searchResult } from "../../src/request-status.js";
import type { TraceStep } from "../../src/types.js";

export type SearchLoadConversion = { readonly searches: number; readonly converted: number };

const str = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const candidateUris = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(candidate => str((candidate as Record<string, unknown> | null)?.uri)).filter((uri): uri is string => uri !== undefined)
    : [];

type CandidateSearch = { key: string; ts: number; candidates: ReadonlySet<string> };

/**
 * 후보→읽기 전환 (docs/ux/phase2-why.md J2의 귀속 기준): 같은 세션에서 후보를 표시한 검색보다
 * 뒤에 일어난, 그 후보와 같은 스킬의 첫 읽기에 귀속한다. 중복 귀속 금지: 읽기 1건은 가장 최근의
 * 해당 검색 한 건에만 귀속되고(마지막 접점), 검색 1건은 여러 읽기와 연결돼도 1회만 센다.
 * 작업 성공률이 아니라 화면 표시용 귀속 지표이며, 읽기로 이어지지 않은 검색을 실패로 세지 않는다.
 */
export function searchLoadConversion(steps: readonly TraceStep[]): SearchLoadConversion {
  const searches = new Map<string, CandidateSearch>();
  const loads: { ts: number; uri: string }[] = [];
  // Mirror requestRecords: raw search/load events whose requestId a skill_request already tracks are skipped.
  const tracked = new Set(
    steps.filter(step => step.kind === "skill_request").map(step => str(step.detail.requestId)).filter((id): id is string => id !== undefined),
  );
  steps.forEach((step, index) => {
    const data = step.detail as Record<string, unknown>;
    if (step.kind === "skill_request" && data.operation === "search") {
      if (data.status === "in_progress" || searchResult(data).result !== "candidates_found") return;
      const key = str(data.traceId) ?? str(data.requestId) ?? `wrapped-search-${index}`;
      if (searches.has(key)) return;
      const uris = candidateUris(data.candidates);
      const first = str(data.firstCandidateUri) ?? uris[0];
      const candidates = new Set(uris.length ? uris : first ? [first] : []);
      if (candidates.size) searches.set(key, { key, ts: step.ts, candidates });
      return;
    }
    if (step.kind === "skill_request" && data.operation === "load") {
      const uri = str(data.uri);
      if (uri && data.status === "succeeded") loads.push({ ts: step.ts, uri });
      return;
    }
    if (step.kind === "search") {
      if (tracked.has(str(data.requestId) ?? "")) return;
      const key = str(data.traceId) ?? str(data.trace_id) ?? `search-${index}`;
      if (searches.has(key)) return;
      const candidates = new Set(candidateUris(data.candidates));
      if (candidates.size) searches.set(key, { key, ts: step.ts, candidates });
      return;
    }
    if (step.kind === "load") {
      if (tracked.has(str(data.requestId) ?? "")) return;
      const uri = str(data.uri);
      if (uri) loads.push({ ts: step.ts, uri });
    }
  });
  const orderedSearches = [...searches.values()].sort((a, b) => a.ts - b.ts);
  const converted = new Set<string>();
  for (const load of [...loads].sort((a, b) => a.ts - b.ts)) {
    // Last touch: the most recent search that showed this candidate owns the load.
    for (let index = orderedSearches.length - 1; index >= 0; index--) {
      const search = orderedSearches[index];
      if (search.ts < load.ts && search.candidates.has(load.uri)) { converted.add(search.key); break; }
    }
  }
  return { searches: searches.size, converted: converted.size };
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
