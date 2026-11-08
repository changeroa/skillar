// Portable domain types of the activity analysis kernel. They mirror the local package's analysis types
// structurally and carry no Node-only types, so a Worker and the local CLI read one contract.

export type SkillUri = string;
export type RuntimeId = "claude-code" | "codex" | "gemini" | "cursor" | "omo" | "gajae" | "openclaw" | "unknown";
export type EventKind = "session_start" | "prompt" | "search" | "load" | "read_file" | "native_skill" | "llm_call" | "tool_call" |
  "session_end" | "error" | "skill_request";
export type EventSource = "mcp" | "otel" | "hook";
export type AbstainReason = "empty_query" | "no_overlap" | "below_threshold" | "explicit_only";

/** The span fields assembly reads; a stored span row may carry more. */
export type AnalysisSpan = { readonly traceId: string; readonly spanId: string; readonly name: string;
  readonly turnKey?: string | undefined; readonly callId?: string | undefined; readonly startMs?: number | undefined };

export type TurnBasis = "reported" | "span_join" | "inferred_time";
export type TreeEvent = { readonly id: string; readonly ts: number; readonly kind: EventKind; readonly source: EventSource;
  readonly turnKey: string | null; readonly callId: string | null; readonly spanId: string | null;
  readonly skillUri: string | null; readonly text: string | null; readonly textLength: number | null;
  readonly data: Readonly<Record<string, unknown>> };
export type TreeSessionData = { readonly id: string; readonly runtime: RuntimeId; readonly startedAt: number; readonly endedAt: number | null;
  readonly events: readonly TreeEvent[]; readonly spans: readonly AnalysisSpan[] };
export type AssignedTreeEvent = TreeEvent & { readonly basis: TurnBasis; readonly attribution: "reported" | "single" | "co_active" | "no_skill";
  readonly skills: readonly string[] };
export type SkillSpan = { readonly id: string; readonly skill: string; readonly uri: string | null; readonly name: string;
  readonly startedAt: number; readonly endedAt: number; readonly activation: AssignedTreeEvent; readonly events: readonly AssignedTreeEvent[] };
export type TurnTree = { readonly id: string; readonly startedAt: number; readonly endedAt: number; readonly basis: TurnBasis;
  readonly events: readonly AssignedTreeEvent[]; readonly skillSpans: readonly SkillSpan[] };
export type SessionTree = { readonly id: string; readonly runtime: RuntimeId; readonly startedAt: number; readonly endedAt: number | null;
  readonly executionWindow?: { readonly from: number; readonly to: number | null };
  readonly turns: readonly TurnTree[]; readonly unassignedEvents: readonly TreeEvent[] };
export type TreeTopologyNode = { readonly id: string; readonly label: string | null; readonly createdMs: number | null; readonly closedMs: number | null };
export type TreePaneLink = { readonly paneId: string; readonly sessionId: string | null; readonly agentSessionValue: string;
  readonly source: string | null; readonly firstSeenMs: number | null; readonly lastSeenMs: number | null };
export type ExecutionEventScope = { readonly from: number; readonly to: number | null; readonly eventIds: readonly string[];
  readonly paneIds: readonly string[]; readonly links: readonly TreePaneLink[];
  /** Relevant equal-start observations proven to precede registration; only prompt context is retained. */
  readonly priorEventIds: readonly string[];
  readonly sessionEnds: Readonly<Record<string, number | null>> | null;
  /** Read-time relevant endpoint/untimed span keys, resolved against the persisted recording cut. */
  readonly spanKeys: readonly string[] | null;
  readonly boundary: "recorded" | "order_unavailable" };
export type TreeFlowData = { readonly id: string; readonly workspaceId: string; readonly label: string | null; readonly registered: boolean;
  readonly tabs: readonly TreeTopologyNode[]; readonly panes: readonly (TreeTopologyNode & { readonly tabId: string })[];
  readonly links: readonly TreePaneLink[] };
export type FlowTree = { readonly id: string; readonly workspaceId: string; readonly label: string | null; readonly registered: boolean;
  readonly sessions?: readonly SessionTree[];
  readonly tabs: readonly (TreeTopologyNode & { readonly panes: readonly (TreeTopologyNode & {
    readonly sessions: readonly (TreePaneLink & { readonly basis: "reported" | "inferred"; readonly session: SessionTree | null })[] })[] })[] };

// "Found the skill?" analysis: descriptive labels over recorded search, load and native-skill events.
export type FindingLabel = "found_top1" | "found_lower" | "loaded_outside_results" | "native_without_search" | "searched_none_used" | "no_search";
export type FindingCandidate = { readonly uri: SkillUri; readonly name: string; readonly rank: number; readonly rawRank: number; readonly copies: number };
export type FindingUsedSkill = { readonly uri: SkillUri | null; readonly name: string; readonly via: "load" | "native"; readonly ts: number;
  readonly rankInSearch: number | null };
export type FindingMiss = { readonly uri: SkillUri | null; readonly name: string; readonly via: "load" | "native"; readonly turnId: string; readonly ts: number };
export type FindingAbstention = { readonly reason: AbstainReason; readonly hint: string };
export type TurnFinding = { readonly turnId: string; readonly searched: boolean; readonly queries: readonly string[];
  readonly candidates: readonly FindingCandidate[]; readonly loadedSkills: readonly FindingUsedSkill[];
  readonly abstained: boolean; readonly abstentions: readonly FindingAbstention[];
  readonly nativeWithoutSearch: boolean; readonly missedLater: readonly FindingMiss[]; readonly label: FindingLabel };
export type FindingAggregate = { readonly turns: number; readonly labels: Readonly<Record<FindingLabel, number>>;
  readonly meanRank: number | null; readonly abstainedSearches: number; readonly abstainedTurns: number };
export type SessionFinding = { readonly sessionId: string; readonly turns: readonly TurnFinding[]; readonly aggregate: FindingAggregate };
export type FlowFinding = { readonly id: string; readonly sessions: readonly SessionFinding[]; readonly aggregate: FindingAggregate };
export type SkillDigestLookup = (used: { readonly uri: SkillUri | null; readonly loadId: string | null }) => string | undefined;

/** Session selection the range usage reads; `automated` follows the local Filter semantics. */
export type AnalysisSessionFilter = { from?: number; to?: number; automated?: "include" | "only" };
export type AnalysisLoad = { readonly resources: readonly { readonly uri: SkillUri; readonly digest: string }[] };

/**
 * The read methods the analysis kernel calls. Every function takes a `Pick` of this contract, so an adapter
 * (the local SQLite store, or a fact-backed store) implements only what the functions it serves read.
 */
export interface AnalysisStore {
  treeSessionData(sessionId: string, scope?: ExecutionEventScope): TreeSessionData | undefined;
  treeFlowData(flowOrWorkspaceId: string, scope?: ExecutionEventScope): TreeFlowData | undefined;
  flowEventScope(flowId: string): ExecutionEventScope | undefined;
  outsideHerdrSessionIds(opts: { from: number; to: number; limit: number }): readonly string[];
  getLoad(loadId: string): AnalysisLoad | undefined;
  sessions(filter: AnalysisSessionFilter): readonly { readonly id: string }[];
}
