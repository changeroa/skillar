import type { Filter, RuntimeId, SessionTree, SkillSpan, Store, TreeEvent, TurnTree } from "../types.js";
import * as kernel from "./kernel.js";
import type { FlowUsage, RangeUsage, SessionUsage, SkillSpanUsage, SkillUsageAggregate } from "./kernel.js";

// "Used the skill?" analysis runs in the shared MIT kernel; the annotations keep the local signatures.
export type {
  AttributionShare, CorrectionStatus, FlowUsage, RangeUsage, SessionUsage, SkillSpanUsage, SkillUsageAggregate, SpanActivity,
  SupportingRead, UsageCorrection, UsageTokenKey, UsageTokens,
} from "./kernel.js";

export { TOKEN_KEYS } from "./kernel.js";

export const correctionMatches: (text: string) => string[] = kernel.correctionMatches;

export const nextPromptAfterTurn: (session: SessionTree, turnIndex: number) => TreeEvent | null = kernel.nextPromptAfterTurn;

export const spanUsage: (span: SkillSpan, ctx: { turn: TurnTree; nextPrompt: TreeEvent | null; runtime: RuntimeId }) => SkillSpanUsage =
  kernel.spanUsage;

export const sessionUsage: (session: SessionTree) => SessionUsage = kernel.sessionUsage;

export const aggregateUsage: (spans: Iterable<SkillSpanUsage>) => SkillUsageAggregate[] = kernel.aggregateUsage;

export const flowUsage: (store: Pick<Store, "treeSessionData" | "treeFlowData" | "flowEventScope">, flowOrWorkspaceId: string) =>
  FlowUsage | undefined = kernel.flowUsage;

export const rangeUsage: (store: Pick<Store, "treeSessionData" | "sessions">,
  opts: { from: number; to: number; detailLimit?: number; automated?: Filter["automated"] }) => RangeUsage = kernel.rangeUsage;
