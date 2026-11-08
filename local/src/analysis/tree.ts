import type { ExecutionEventScope, FlowTree, SessionTree, Store, TreeSessionData } from "../types.js";
import * as kernel from "./kernel.js";

// The analysis runs in the shared MIT kernel; these annotations keep the local signatures and check that the
// local store and tree types still match the portable contract.

/** Pure assembly: prompt pairs precede keyless timestamp membership; row order breaks equal-time event ties.
 * A boundary at the same timestamp wins over the preceding turn, independent of ingest order.
 */
export const assembleSession: (data: TreeSessionData) => SessionTree = kernel.assembleSession;

export const sessionTree: (store: Pick<Store, "treeSessionData">, sessionId: string) => SessionTree | undefined = kernel.sessionTree;

export const flowTree: (store: Pick<Store, "treeSessionData" | "treeFlowData" | "flowEventScope">, flowOrWorkspaceId: string,
  scope?: ExecutionEventScope) => FlowTree | undefined = kernel.flowTree;

export const outsideHerdr: (store: Pick<Store, "treeSessionData" | "outsideHerdrSessionIds">,
  opts: { from: number; to: number; limit: number }) => { readonly id: "outside-herdr"; readonly sessions: readonly SessionTree[] } =
  kernel.outsideHerdr;
