import type { AbstainReason, EventKind, SearchMode, SkillUri, TraceStep } from "../../../src/types.js";
import type { SessionListRow } from "../../api";
import type { CandidateLike } from "../../components/candidates";

export type SearchDetail = {
  kind: "search"; traceId: string; chosen: SkillUri[]; query: string; mode: SearchMode; candidates: CandidateLike[];
  abstained?: { reason: AbstainReason; hint: string }; elapsedMs: number | undefined; total: number;
};
export type PromptDetail = { kind: "prompt"; text?: string; textLength?: number };
export type LoadDetail = { kind: "load"; uri: SkillUri; loadId: string; manifestDigest: string };
export type ReadDetail = { kind: "read_file"; skillUri: SkillUri; uri: SkillUri; bytes: number };
export type NativeDetail = { kind: "native_skill"; name: string; via: string };
export type LlmDetail = { kind: "llm_call"; model?: string; costUsd?: number; durationMs?: number; ttftMs?: number };
export type ToolDetail = { kind: "tool_call"; toolName?: string; success?: boolean; durationMs?: number; skillarMcp?: boolean; gisoolMcp?: boolean; args?: string; argsLength?: number; resultBytes?: number };
export type ErrorDetail = { kind: "error"; code: string; message: string };

export const PROMPT_FOLD_CHARS = 600;
export const SHORT_DIGEST_CHARS = 8;
export const TOOL_ARGS_PREVIEW_CHARS = 160;
export type ToolArgs = { captured: true; text: string; truncated: boolean } | { captured: false; length: number };
const COST_UNKNOWN = "비용 정보 없음";

export const KIND_LABEL: Record<EventKind, string> = {
  skill_request: "요청",
  session_start: "세션 시작",
  prompt: "요청문",
  search: "skillar 검색",
  load: "스킬 읽기",
  read_file: "자료 읽기",
  native_skill: "내장 스킬",
  llm_call: "모델 호출",
  tool_call: "도구 실행",
  session_end: "세션 종료",
  error: "오류",
};
export const MODE_LABEL: Record<SearchMode, string> = { discovery: "탐색", automatic: "자동", explicit: "직접 지정" };
export const ABSTAIN_LABEL: Record<AbstainReason, string> = {
  empty_query: "검색어 없음", no_overlap: "일치하는 표현 없음", below_threshold: "관련도 기준 미달", explicit_only: "직접 지정 전용",
};
export const NEVER_CONSULTED = "이 세션에는 skillar 검색 기록이 없습니다";
export const SPAN_KIND_LABEL = "스킬 활성 구간";

export type TraceCounts = { steps: number; searches: number; abstained: number; loads: number; reads: number; natives: number; errors: number };

export function traceCounts(steps: readonly TraceStep[]): TraceCounts {
  const counts: TraceCounts = { steps: steps.length, searches: 0, abstained: 0, loads: 0, reads: 0, natives: 0, errors: 0 };
  for (const step of steps) {
    switch (step.kind) {
      case "search": counts.searches += 1; if (step.detail.abstained) counts.abstained += 1; break;
      case "load": counts.loads += 1; break;
      case "read_file": counts.reads += 1; break;
      case "native_skill": counts.natives += 1; break;
      case "error": counts.errors += 1; break;
      default: break;
    }
  }
  return counts;
}

export function sessionBounds(steps: readonly TraceStep[], row?: Pick<SessionListRow, "startedAt" | "endedAt">): { startedAt?: number; endedAt?: number; lastTs?: number } {
  const first = steps[0];
  const last = steps[steps.length - 1];
  const end = steps.find((step) => step.kind === "session_end");
  return {
    startedAt: row?.startedAt ?? first?.ts,
    endedAt: row?.endedAt ?? end?.ts,
    lastTs: last?.ts,
  };
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60e3);
  if (minutes < 1) return "1분 미만";
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

export function formatOffset(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 10e3) return `+${(ms / 1e3).toFixed(1)}초`;
  if (ms < 60e3) return `+${Math.round(ms / 1e3)}초`;
  const totalSeconds = Math.round(ms / 1e3);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `+${minutes}분 ${String(totalSeconds % 60).padStart(2, "0")}초`;
  const hours = Math.floor(minutes / 60);
  return `+${hours}시간 ${String(minutes % 60).padStart(2, "0")}분`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** First SHORT_DIGEST_CHARS hex chars; catalog digests carry a `sha256:` prefix that is not part of the hash. */
export function shortDigest(digest: string): string {
  return digest ? digest.replace(/^sha256[:-]/, "").slice(0, SHORT_DIGEST_CHARS) : "";
}

/** Search latency as the timeline shows it: sub-millisecond keeps two decimals, under 100 ms one, above that whole ms. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

export function resourcePath(skillUri: string, uri: string): string {
  const dir = skillUri.replace(/\/SKILL\.md$/i, "");
  if (dir && uri.startsWith(`${dir}/`)) return uri.slice(dir.length + 1);
  return uri;
}

export function foldText(text: string, limit = PROMPT_FOLD_CHARS): { head: string; folded: boolean } {
  const chars = Array.from(text);
  if (chars.length <= limit) return { head: text, folded: false };
  return { head: chars.slice(0, limit).join(""), folded: true };
}

export function isSearchStep(step: TraceStep): step is TraceStep & { detail: SearchDetail } {
  return step.kind === "search";
}

export function searchDetail(step: TraceStep): SearchDetail {
  const detail = step.detail as Partial<SearchDetail>;
  return {
    kind: "search",
    traceId: typeof detail.traceId === "string" ? detail.traceId : "",
    chosen: Array.isArray(detail.chosen) ? detail.chosen : [],
    query: typeof detail.query === "string" ? detail.query : "",
    mode: detail.mode ?? "automatic",
    candidates: Array.isArray(detail.candidates) ? detail.candidates : [],
    abstained: detail.abstained,
    elapsedMs: typeof detail.elapsedMs === "number" && Number.isFinite(detail.elapsedMs) ? detail.elapsedMs : undefined,
    total: Number(detail.total ?? (Array.isArray(detail.candidates) ? detail.candidates.length : 0)),
  };
}

export function evalCasePayload(detail: Pick<SearchDetail, "query" | "traceId">): { query: string; fromTraceId?: string } {
  return detail.traceId ? { query: detail.query, fromTraceId: detail.traceId } : { query: detail.query };
}

export function firstPromptOf(steps: readonly TraceStep[], row?: Pick<SessionListRow, "firstPrompt">): string | undefined {
  if (row?.firstPrompt) return row.firstPrompt;
  const prompt = steps.find((step) => step.kind === "prompt");
  const text = (prompt?.detail as PromptDetail | undefined)?.text;
  return text || undefined;
}

/** A runtime that reports no cost (Codex) says "unknown", never $0.00. */
export function formatCost(costUsd: number | undefined): string {
  return typeof costUsd === "number" && Number.isFinite(costUsd) ? `$${costUsd.toFixed(4)}` : COST_UNKNOWN;
}

/** The captured arguments, or how much text the capture level dropped; undefined when the runtime sent none. */
export function toolArgsPreview(detail: ToolDetail): ToolArgs | undefined {
  if (typeof detail.args === "string") {
    const chars = Array.from(detail.args);
    const truncated = chars.length > TOOL_ARGS_PREVIEW_CHARS;
    return { captured: true, text: truncated ? `${chars.slice(0, TOOL_ARGS_PREVIEW_CHARS).join("")}…` : detail.args, truncated };
  }
  return typeof detail.argsLength === "number" ? { captured: false, length: detail.argsLength } : undefined;
}
