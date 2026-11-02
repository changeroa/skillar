import type { Store } from "../types.js";
import type { WorkflowSpec } from "./spec.js";
import * as kernel from "../analysis/kernel.js";
import type { FlowComparison } from "../analysis/kernel.js";

export type { FlowComparison, StepComparison, StepStatus, UnplannedPane } from "../analysis/kernel.js";

export type CompareInput = {
  spec: WorkflowSpec;
  steps: { stepId: string; paneId: string }[];
  paneSkillUse: Record<string, string[]>;
  paneTools: Record<string, string[]>;
  /** Every pane known for the flow; a pane with no step mapping is reported as unplanned. */
  panes?: string[];
};

/** Step statuses and deviation fields are defined by the shared MIT kernel's compare(). */
export const compare: (input: CompareInput) => FlowComparison = kernel.compare;

/**
 * Store-backed input for compare(). Used skills come from the skillar `load` and `native_skill` events of the
 * sessions linked to each pane; skill spans (todo 6) replace this source without changing the comparison.
 * Returns undefined when the flow is unknown or was registered without a spec.
 * `excludeSessions` leaves named sessions out, so a caller that hides automated sessions compares without them too.
 */
export function compareFlow(store: Store, flowId: string, opts: Parameters<Store["flowPaneUsage"]>[1] = {}): FlowComparison | undefined {
  const flow = store.getFlow(flowId);
  if (!flow?.spec) return undefined;
  const usage = store.flowPaneUsage(flowId, opts);
  const paneSkillUse: Record<string, string[]> = {};
  const paneTools: Record<string, string[]> = {};
  for (const row of usage) {
    paneSkillUse[row.paneId] = row.skills;
    paneTools[row.paneId] = row.tools;
  }
  return compare({
    spec: flow.spec.spec,
    steps: store.flowSteps(flowId).map((s) => ({ stepId: s.stepId, paneId: s.paneId })),
    paneSkillUse,
    paneTools,
    panes: usage.map((r) => r.paneId),
  });
}
