import type { RuntimeId } from "./types.js";

/** The measurements a model call can report. Missing measurements are not zero. */
export const TOKEN_KEYS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "cacheWriteTokens",
  "reasoningTokens", "totalTokens"] as const;
export type UsageTokenKey = (typeof TOKEN_KEYS)[number];

/**
 * Cache semantics stay separate: Claude input excludes cached tokens, Codex input includes them.
 * Each measurement sums only reported values; unknownCalls counts the remaining calls.
 * totalTokens is reported by the runtime, never derived from the other buckets.
 */
export type UsageTokens = {
  readonly inputIncludesCache: boolean; readonly calls: number;
  readonly inputTokens: number | null; readonly outputTokens: number | null; readonly cacheReadTokens: number | null;
  readonly cacheCreationTokens: number | null; readonly cacheWriteTokens: number | null; readonly reasoningTokens: number | null;
  readonly totalTokens: number | null;
  readonly unknownCalls: Readonly<Record<UsageTokenKey, number>>;
};

/** A skill-file read reported by MCP or inferred from a tool argument path. */
export type SupportingRead = {
  readonly eventId: string; readonly kind: "read_file" | "tool_call"; readonly uri: string | null;
  readonly label: "reported" | "heuristic";
};
export type CorrectionStatus = "correction" | "no_correction" | "unknown";
/** A word-list guess; unknown if there is no next prompt or its text was not captured. */
export type UsageCorrection = {
  readonly status: CorrectionStatus; readonly label: "heuristic"; readonly matched: readonly string[];
  readonly reason: "no_next_prompt" | "text_not_captured" | null;
};
export type AttributionShare = {
  readonly reported: number; readonly single: number; readonly coActive: number; readonly total: number;
  readonly coActiveShare: number | null;
};
/**
 * Observed follow-through, not proof of usefulness. Codex exec wrappers remain unresolved.
 * An absent tool-call result stays unknown rather than being counted as success.
 */
export type SpanActivity = {
  readonly version: 1; readonly observations: number; readonly commands: number; readonly unresolvedExec: number;
  readonly results: { readonly success: number; readonly failure: number; readonly unknown: number };
  readonly workExecutions: number | null;
};
export type SkillSpanUsage = {
  readonly turnId: string; readonly spanId: string; readonly skill: string; readonly name: string; readonly uri: string | null;
  readonly activatedAt: number; readonly durationMs: number;
  readonly followThrough: number; readonly activity: SpanActivity;
  readonly skillToolCalls: number; readonly toolFailures: number;
  readonly supportingReads: readonly SupportingRead[];
  readonly llmCalls: number;
  readonly costUsd: number | null; readonly costUnknownCalls: number;
  readonly tokens: readonly UsageTokens[];
  readonly nextPromptCorrection: UsageCorrection;
  readonly attribution: AttributionShare;
};
export type SessionUsage = { readonly sessionId: string; readonly runtime: RuntimeId; readonly spans: readonly SkillSpanUsage[] };
export type SkillUsageAggregate = {
  readonly skill: string; readonly name: string; readonly uri: string | null;
  readonly spans: number; readonly spansWithoutFollowThrough: number;
  readonly followThrough: number; readonly skillToolCalls: number; readonly toolFailures: number;
  readonly supportingReads: number; readonly heuristicReads: number;
  readonly durationMs: number; readonly llmCalls: number;
  readonly costUsd: number | null; readonly costUnknownCalls: number;
  readonly tokens: readonly UsageTokens[];
  readonly corrections: { readonly correction: number; readonly no_correction: number; readonly unknown: number };
  readonly attribution: AttributionShare;
  readonly activity: SpanActivity;
};
export type FlowUsage = { readonly id: string; readonly sessions: readonly SessionUsage[]; readonly skills: readonly SkillUsageAggregate[] };
/** skills covers every eligible session; truncated refers only to the per-session detail list. */
export type RangeUsage = { readonly from: number; readonly to: number; readonly sessionCount: number; readonly truncated: boolean;
  readonly sessions: readonly SessionUsage[]; readonly skills: readonly SkillUsageAggregate[] };
