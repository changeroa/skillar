import type { FindingAggregate, FlowFinding, SessionFinding, SessionTree, SkillDigestLookup, Store, TurnFinding,
  TurnTree } from "../types.js";
import * as kernel from "./kernel.js";

// "Found the skill?" analysis runs in the shared MIT kernel; the annotations keep the local signatures.

export const analyzeTurn: (turn: TurnTree, later?: readonly TurnTree[], digestOf?: SkillDigestLookup) => TurnFinding = kernel.analyzeTurn;

export const aggregateFindings: (turns: readonly TurnFinding[]) => FindingAggregate = kernel.aggregateFindings;

export const analyzeSession: (tree: SessionTree, digestOf?: SkillDigestLookup) => SessionFinding = kernel.analyzeSession;

export const loadedDigests: (store: Pick<Store, "getLoad">) => SkillDigestLookup = kernel.loadedDigests;

export const sessionFinding: (store: Pick<Store, "treeSessionData" | "getLoad">, sessionId: string) => SessionFinding | undefined =
  kernel.sessionFinding;

export const flowFinding: (store: Pick<Store, "treeSessionData" | "treeFlowData" | "flowEventScope" | "getLoad">,
  flowOrWorkspaceId: string) => FlowFinding | undefined = kernel.flowFinding;
