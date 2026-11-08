import type { AnalysisSessionFilter, AnalysisStore, RuntimeId, SessionTree, SkillSpan, TreeEvent, TurnTree } from "./types.js";
import { flowTree, sessionTree } from "./tree.js";
import { activityKind, isSkillarMcpData, supportingReadsOf } from "./usage-evidence.js";
import type {
  FlowUsage, RangeUsage, SessionUsage, SkillSpanUsage, SkillUsageAggregate, UsageCorrection, UsageTokenKey, UsageTokens,
} from "./usage-types.js";

export { TOKEN_KEYS } from "./usage-types.js";
export type * from "./usage-types.js";
export { isSkillarMcpData } from "./usage-evidence.js";

const KOREAN_CORRECTIONS = ["아니", "다시", "틀렸", "잘못", "그게 아니", "왜 안"] as const;
const ENGLISH_CORRECTIONS = ["no,", "wrong", "again", "that's not", "undo", "revert"] as const;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "again" must not fire inside "against"; "no," carries its own right-hand boundary. */
const ENGLISH_PATTERNS: readonly (readonly [string, RegExp])[] = ENGLISH_CORRECTIONS.map((token) => [
  token,
  new RegExp(`${/^[a-z0-9]/.test(token) ? "(?<![a-z0-9])" : ""}${escapeRegex(token)}${/[a-z0-9]$/.test(token) ? "(?![a-z0-9])" : ""}`, "i"),
]);

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Case-insensitive word-list match; typographic apostrophes are folded so "that’s not" reads as "that's not". */
export function correctionMatches(text: string): string[] {
  const normalized = text.replace(/[\u2018\u2019]/g, "'").toLowerCase();
  const matched: string[] = [];
  for (const token of KOREAN_CORRECTIONS) if (normalized.includes(token)) matched.push(token);
  for (const [token, pattern] of ENGLISH_PATTERNS) if (pattern.test(normalized)) matched.push(token);
  return matched;
}

function correctionOf(next: TreeEvent | null): UsageCorrection {
  if (next === null) return { status: "unknown", label: "heuristic", matched: [], reason: "no_next_prompt" };
  // Capture level metadata (and a runtime that reports no prompt text) leaves nothing to match on.
  if (next.text === null) return { status: "unknown", label: "heuristic", matched: [], reason: "text_not_captured" };
  const matched = correctionMatches(next.text);
  return { status: matched.length > 0 ? "correction" : "no_correction", label: "heuristic", matched, reason: null };
}

/** The first prompt of a later turn in the same session; turns without a prompt event (Codex spans) are skipped. */
export function nextPromptAfterTurn(session: SessionTree, turnIndex: number): TreeEvent | null {
  for (let i = turnIndex + 1; i < session.turns.length; i += 1) {
    const prompt = session.turns[i]?.events.find((e) => e.kind === "prompt");
    if (prompt) return prompt;
  }
  return null;
}

function tokenValues<Value>(value: (key: UsageTokenKey) => Value): Record<UsageTokenKey, Value> {
  return { inputTokens: value("inputTokens"), outputTokens: value("outputTokens"),
    cacheReadTokens: value("cacheReadTokens"), cacheCreationTokens: value("cacheCreationTokens"),
    cacheWriteTokens: value("cacheWriteTokens"), reasoningTokens: value("reasoningTokens"), totalTokens: value("totalTokens") };
}
function callTokens(data: Readonly<Record<string, unknown>>): UsageTokens {
  const measured = tokenValues(key => numberOf(data[key]) ?? null);
  const unknownCalls = tokenValues(key => measured[key] === null ? 1 : 0);
  return { inputIncludesCache: data.inputIncludesCache === true, calls: 1, ...measured, unknownCalls };
}

/** An unreported measurement adds nothing: the sum covers the calls that reported it, unknownCalls counts the rest. */
function sumTokens(a: UsageTokens, b: UsageTokens): UsageTokens {
  const measured = tokenValues(key => {
    const left = a[key];
    const right = b[key];
    return left === null ? right : right === null ? left : left + right;
  });
  const unknownCalls = tokenValues(key => a.unknownCalls[key] + b.unknownCalls[key]);
  return { inputIncludesCache: a.inputIncludesCache, calls: a.calls + b.calls, ...measured, unknownCalls };
}

function mergeTokens(into: Map<boolean, UsageTokens>, buckets: Iterable<UsageTokens>): void {
  for (const bucket of buckets) {
    const current = into.get(bucket.inputIncludesCache);
    into.set(bucket.inputIncludesCache, current ? sumTokens(current, bucket) : bucket);
  }
}

function sortedTokens(buckets: Map<boolean, UsageTokens>): UsageTokens[] {
  return [...buckets.values()].sort((a, b) => Number(a.inputIncludesCache) - Number(b.inputIncludesCache));
}

/** Usage of one skill span: `turn` supplies the events outside the span (MCP reads), `nextPrompt` the correction guess. */
export function spanUsage(span: SkillSpan, ctx: { turn: TurnTree; nextPrompt: TreeEvent | null; runtime: RuntimeId }): SkillSpanUsage {
  let followThrough = 0;
  let commands = 0;
  let unresolvedExec = 0;
  const results = { success: 0, failure: 0, unknown: 0 };
  let skillToolCalls = 0;
  let toolFailures = 0;
  let llmCalls = 0;
  let costSum = 0;
  let costUnknownCalls = 0;
  let reported = 0;
  let single = 0;
  let coActive = 0;
  const buckets = new Map<boolean, UsageTokens>();
  for (const event of span.events) {
    if (event.attribution === "reported") reported += 1;
    else if (event.attribution === "co_active") coActive += 1;
    else if (event.attribution === "single") single += 1;
    if (event.kind === "tool_call") {
      if (isSkillarMcpData(event.data)) skillToolCalls += 1;
      else {
        followThrough += 1;
        const kind = activityKind(event, ctx.runtime);
        if (kind === "command") commands += 1;
        else if (kind === "unresolved_exec") unresolvedExec += 1;
        results[event.data.success === true ? "success" : event.data.success === false ? "failure" : "unknown"] += 1;
      }
      if (event.data.success === false) toolFailures += 1;
    }
    if (event.kind === "llm_call") {
      llmCalls += 1;
      const cost = numberOf(event.data.costUsd);
      if (cost === undefined) costUnknownCalls += 1;
      else costSum += cost;
      mergeTokens(buckets, [callTokens(event.data)]);
    }
  }
  const total = span.events.length;
  return {
    turnId: ctx.turn.id, spanId: span.id, skill: span.skill, name: span.name, uri: span.uri,
    activatedAt: span.startedAt, durationMs: Math.max(0, span.endedAt - span.startedAt),
    followThrough, activity: { version: 1, observations: followThrough, commands, unresolvedExec, results,
      workExecutions: unresolvedExec > 0 ? null : followThrough },
    skillToolCalls, toolFailures, supportingReads: supportingReadsOf(span, ctx.turn), llmCalls,
    costUsd: llmCalls > 0 && costUnknownCalls === 0 ? costSum : null, costUnknownCalls,
    tokens: sortedTokens(buckets), nextPromptCorrection: correctionOf(ctx.nextPrompt),
    attribution: { reported, single, coActive, total, coActiveShare: total > 0 ? coActive / total : null },
  };
}

export function sessionUsage(session: SessionTree): SessionUsage {
  const spans: SkillSpanUsage[] = [];
  session.turns.forEach((turn, index) => {
    const nextPrompt = nextPromptAfterTurn(session, index);
    for (const span of turn.skillSpans) spans.push(spanUsage(span, { turn, nextPrompt, runtime: session.runtime }));
  });
  return { sessionId: session.id, runtime: session.runtime, spans };
}

/** Per-skill totals across any set of spans. Cost stays null while a single contributing model call reported none. */
export function aggregateUsage(spans: Iterable<SkillSpanUsage>): SkillUsageAggregate[] {
  type Acc = {
    skill: string; name: string; uri: string | null; spans: number; spansWithoutFollowThrough: number;
    followThrough: number; skillToolCalls: number; toolFailures: number; supportingReads: number; heuristicReads: number;
    durationMs: number; llmCalls: number; costSum: number; costUnknownCalls: number; tokens: Map<boolean, UsageTokens>;
    corrections: { correction: number; no_correction: number; unknown: number };
    reported: number; single: number; coActive: number; total: number;
    commands: number; unresolvedExec: number; results: { success: number; failure: number; unknown: number };
    workExecutions: number | null;
  };
  const bySkill = new Map<string, Acc>();
  for (const usage of spans) {
    const acc = bySkill.get(usage.skill) ?? {
      skill: usage.skill, name: usage.name, uri: usage.uri, spans: 0, spansWithoutFollowThrough: 0,
      followThrough: 0, skillToolCalls: 0, toolFailures: 0, supportingReads: 0, heuristicReads: 0,
      durationMs: 0, llmCalls: 0, costSum: 0, costUnknownCalls: 0, tokens: new Map<boolean, UsageTokens>(),
      corrections: { correction: 0, no_correction: 0, unknown: 0 }, reported: 0, single: 0, coActive: 0, total: 0,
      commands: 0, unresolvedExec: 0, results: { success: 0, failure: 0, unknown: 0 }, workExecutions: 0,
    };
    acc.uri = acc.uri ?? usage.uri;
    acc.spans += 1;
    if (usage.followThrough === 0) acc.spansWithoutFollowThrough += 1;
    acc.followThrough += usage.followThrough;
    acc.skillToolCalls += usage.skillToolCalls;
    acc.toolFailures += usage.toolFailures;
    acc.supportingReads += usage.supportingReads.length;
    acc.heuristicReads += usage.supportingReads.filter((r) => r.label === "heuristic").length;
    acc.durationMs += usage.durationMs;
    acc.llmCalls += usage.llmCalls;
    acc.costSum += usage.costUsd ?? 0;
    acc.costUnknownCalls += usage.costUnknownCalls;
    mergeTokens(acc.tokens, usage.tokens);
    acc.corrections[usage.nextPromptCorrection.status] += 1;
    acc.reported += usage.attribution.reported;
    acc.single += usage.attribution.single;
    acc.coActive += usage.attribution.coActive;
    acc.total += usage.attribution.total;
    acc.commands += usage.activity.commands;
    acc.unresolvedExec += usage.activity.unresolvedExec;
    acc.results.success += usage.activity.results.success;
    acc.results.failure += usage.activity.results.failure;
    acc.results.unknown += usage.activity.results.unknown;
    acc.workExecutions = acc.workExecutions === null || usage.activity.workExecutions === null ? null
      : acc.workExecutions + usage.activity.workExecutions;
    bySkill.set(usage.skill, acc);
  }
  return [...bySkill.values()]
    .map((acc) => ({
      skill: acc.skill, name: acc.name, uri: acc.uri, spans: acc.spans, spansWithoutFollowThrough: acc.spansWithoutFollowThrough,
      followThrough: acc.followThrough, skillToolCalls: acc.skillToolCalls, toolFailures: acc.toolFailures,
      supportingReads: acc.supportingReads, heuristicReads: acc.heuristicReads, durationMs: acc.durationMs,
      llmCalls: acc.llmCalls, costUsd: acc.llmCalls > 0 && acc.costUnknownCalls === 0 ? acc.costSum : null,
      costUnknownCalls: acc.costUnknownCalls, tokens: sortedTokens(acc.tokens), corrections: acc.corrections,
      attribution: { reported: acc.reported, single: acc.single, coActive: acc.coActive, total: acc.total,
        coActiveShare: acc.total > 0 ? acc.coActive / acc.total : null },
      activity: { version: 1 as const, observations: acc.followThrough, commands: acc.commands, unresolvedExec: acc.unresolvedExec,
        results: acc.results, workExecutions: acc.workExecutions },
    }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
}

/** Usage of every session linked to one flow (or to the herdr workspace acting as one). */
export function flowUsage(store: Pick<AnalysisStore, "treeSessionData" | "treeFlowData" | "flowEventScope">, flowOrWorkspaceId: string): FlowUsage | undefined {
  const flow = flowTree(store, flowOrWorkspaceId);
  if (!flow) return undefined;
  const sessions: SessionUsage[] = [];
  for (const tab of flow.tabs) {
    for (const pane of tab.panes) {
      for (const link of pane.sessions) {
        if (link.session === null || sessions.some((s) => s.sessionId === link.session?.id)) continue;
        sessions.push(sessionUsage(link.session));
      }
    }
  }
  return { id: flow.id, sessions, skills: aggregateUsage(sessions.flatMap((s) => s.spans)) };
}

/**
 * Usage of the sessions in a time range. Every eligible session is analysed and aggregated; an optional
 * `detailLimit` shortens only the per-session list and then says so through `truncated` and `sessionCount`.
 */
export function rangeUsage(store: Pick<AnalysisStore, "treeSessionData" | "sessions">,
  opts: { from: number; to: number; detailLimit?: number; automated?: AnalysisSessionFilter["automated"] }): RangeUsage {
  const filter: AnalysisSessionFilter = { from: opts.from, to: opts.to, ...(opts.automated !== undefined ? { automated: opts.automated } : {}) };
  const detailLimit = opts.detailLimit === undefined ? undefined : Math.max(0, Math.floor(opts.detailLimit));
  const sessions: SessionUsage[] = [];
  const spans: SkillSpanUsage[] = [];
  let sessionCount = 0;
  for (const row of store.sessions(filter)) {
    const tree = sessionTree(store, row.id);
    if (!tree) continue;
    const usage = sessionUsage(tree);
    sessionCount += 1;
    spans.push(...usage.spans);
    if (detailLimit === undefined || sessions.length < detailLimit) sessions.push(usage);
  }
  return { from: opts.from, to: opts.to, sessionCount, truncated: sessions.length < sessionCount, sessions,
    skills: aggregateUsage(spans) };
}
