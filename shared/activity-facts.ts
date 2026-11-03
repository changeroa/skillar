import type { ContentRow } from "./activity-content.js";
import type { AnalysisStore } from "./activity-analysis.js";
import { factContext, type FactOptions } from "./facts/base.js";
import { createMembership } from "./facts/membership.js";
import { createTrace } from "./facts/trace.js";
import { createFlowQuery } from "./facts/flow.js";
import { createAggregates } from "./facts/aggregates.js";
import { createTreeReads } from "./facts/tree.js";
import { createWorkflowReads } from "./facts/workflow.js";
import { createLookups } from "./facts/lookups.js";
import type { FactStore } from "./facts/types.js";
import { catalogSkills } from "./facts/catalog.js";

export type { FactOptions } from "./facts/base.js";
export type { FactStore, Filter } from "./facts/types.js";

/**
 * Synchronous read adapter for one reconstructed device/source snapshot.
 * Runtime state is captured alongside that snapshot; reads never reattribute or repair facts.
 */
export function createFactStore(rows: readonly ContentRow[], options: FactOptions): FactStore & AnalysisStore {
  const ctx = factContext(rows, options);
  const membership = createMembership(ctx);
  return { skills: () => catalogSkills(rows), ...membership, ...createTrace(ctx), ...createFlowQuery(ctx), ...createAggregates(ctx),
    ...createTreeReads(ctx), ...createWorkflowReads(ctx, membership.outsideHerdrSessions), ...createLookups(ctx) };
}
