import type { createFactStore } from "../activity-facts.js";
import { aggregateFindings, analyzeSession, loadedDigests } from "../analysis/finding.js";
import { flowTree, sessionTree } from "../analysis/tree.js";
import { aggregateUsage, rangeUsage, sessionUsage } from "../analysis/usage.js";
import { compare } from "../analysis/compare.js";
import type { FlowTree, SessionFinding, SessionTree, TurnFinding } from "../analysis/types.js";

type Facts = ReturnType<typeof createFactStore>;
export type ReportStore = Pick<Facts, "treeSessionData" | "treeFlowData" | "flowEventScope" | "getLoad" |
  "sessions" | "outsideHerdrSessionIds" | "outsideHerdrSessions" | "sessionAutomation" | "listFlows" |
  "getFlow" | "flowSteps" | "flowPaneUsage" | "flowSessionIds" | "flowUnattributedLoads" | "reconcileLoads">;
type AutomatedMode = "exclude" | "include" | "only";
type ExcludedSession = { sessionId: string; reason: string };
const DAY = 86_400_000, WEEK = 7 * DAY;
export class AnalysisReportError extends Error {
  constructor(readonly code: "flow_not_found" | "session_not_found" | "automated_excluded",
    readonly automated: string | null = null) {
    super(code);
    this.name = "AnalysisReportError";
  }
}
const keep = (id: string, automation: Record<string, string>, mode: AutomatedMode) =>
  mode === "include" || (mode === "only" ? automation[id] !== undefined : automation[id] === undefined);
function findingDto(finding: SessionFinding) {
  return {
    sessionId: finding.sessionId,
    turns: finding.turns.map(({ loadedSkills, ...turn }: TurnFinding) => ({ ...turn, usedSkills: loadedSkills })),
    aggregate: finding.aggregate,
  };
}
function sessionIds(tree: FlowTree) {
  return tree.tabs.flatMap(tab => tab.panes.flatMap(pane => pane.sessions.flatMap(
    link => link.sessionId === null ? [] : [link.sessionId])));
}
function sessionsOf(tree: FlowTree): SessionTree[] {
  const sessions = new Map<string, SessionTree>((tree.sessions ?? []).map(session => [session.id, session]));
  for (const tab of tree.tabs) for (const pane of tab.panes) {
    for (const link of pane.sessions) if (link.session !== null) sessions.set(link.session.id, link.session);
  }
  return [...sessions.values()];
}
function filteredTree(tree: FlowTree, automation: Record<string, string>, mode: AutomatedMode) {
  const excluded = new Map<string, ExcludedSession>();
  const tabs = tree.tabs.map(tab => ({
    ...tab, panes: tab.panes.map(pane => ({
      ...pane, sessions: pane.sessions.filter(link => {
        if (link.sessionId === null || keep(link.sessionId, automation, mode)) return true;
        excluded.set(link.sessionId, { sessionId: link.sessionId, reason: automation[link.sessionId] ?? "not_automated" });
        return false;
      }),
    })),
  }));
  return { tree: { ...tree, tabs }, excluded };
}
export function compareFlow(
  store: ReportStore, id: string, options: Parameters<ReportStore["flowPaneUsage"]>[1] = {},
) {
  const flow = store.getFlow(id);
  if (!flow?.spec) return undefined;
  const usage = store.flowPaneUsage(id, options);
  const paneSkillUse: Record<string, string[]> = {}, paneTools: Record<string, string[]> = {};
  for (const row of usage) { paneSkillUse[row.paneId] = row.skills; paneTools[row.paneId] = row.tools; }
  return compare({
    spec: flow.spec.spec,
    steps: store.flowSteps(id).map(step => ({ stepId: step.stepId, paneId: step.paneId })),
    paneSkillUse, paneTools, panes: usage.map(row => row.paneId),
  });
}
export function buildFlows(
  store: ReportStore, options: {
    from?: number; to?: number; limit: number; automated: AutomatedMode; cursor?: { orderMs: number; id: string };
  }, now: number,
) {
  const { from, to, limit, automated, cursor } = options;
  const rows = store.listFlows({ automated, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }),
    limit: limit + 1, ...(cursor === undefined ? {} : { cursor }) });
  const page = rows.slice(0, limit), last = page.at(-1);
  const automation = automated === "include" ? {} : store.sessionAutomation(
    page.flatMap(row => row.links.flatMap(link => link.sessionId === null ? [] : [link.sessionId])));
  return {
    generatedAt: now, from: from ?? null, to: to ?? null, limit, automated,
    flows: page.map(row => {
      const links = row.links.filter(link => link.sessionId === null || keep(link.sessionId, automation, automated));
      const ids = [...new Set(links.flatMap(link => link.sessionId === null ? [] : [link.sessionId]))];
      let reported = 0, inferred = 0, unlinked = 0;
      for (const link of links) {
        if (link.sessionId === null || link.source === "unlinked") unlinked++;
        else if (link.source === "inferred:cwd_time") inferred++;
        else reported++;
      }
      return {
        id: row.kind === "workspace" ? `ws:${row.workspaceId}` : row.id,
        kind: row.kind, workspaceId: row.workspaceId, tabId: row.tabId, label: row.label,
        registered: row.kind === "flow", spec: row.spec, startedMs: row.startedMs, endedMs: row.endedMs,
        paneIds: row.paneIds, sessionIds: ids,
        counts: { panes: row.paneIds.length, sessions: ids.length },
        attribution: { reported, inferred, unlinked },
      };
    }),
    nextCursor: rows.length > limit && last ? encodeFlowCursor(last) : null,
  };
}
export function encodeFlowCursor(row: { orderMs: number; id: string }) {
  const bytes = new TextEncoder().encode(`${row.orderMs}:${row.id}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function buildFlowReport(
  store: ReportStore, ref: string,
  options: { automated: AutomatedMode; from?: number; to?: number; limit?: number }, now: number,
) {
  const { automated } = options, id = ref.startsWith("ws:") ? ref.slice(3) : ref;
  const eventScope = ref === "outside" ? undefined : store.flowEventScope(id);
  let full: FlowTree | undefined;
  if (ref === "outside") {
    const to = options.to ?? now + 1, from = options.from ?? to - WEEK;
    full = { id: "outside", workspaceId: "", label: "outside herdr", registered: false, tabs: [],
      sessions: store.outsideHerdrSessions({ from, to, limit: options.limit ?? 100, automated })
        .flatMap(({ id: sessionId }) => {
          const session = sessionTree(store, sessionId);
          return session ? [session] : [];
        }) };
  } else full = flowTree(store, id, eventScope);
  if (!full) throw new AnalysisReportError("flow_not_found");
  const comparisonIds = full.registered ? store.flowSessionIds(full.id, eventScope) : [];
  const automation = automated === "include" ? {} : store.sessionAutomation([...sessionIds(full), ...comparisonIds]);
  const flow = full.registered ? store.getFlow(full.id) : undefined;
  const overlaps = flow ? sessionsOf(full).map(session => ({
    sessionId: session.id, startedBefore: session.startedAt < flow.registeredMs,
    continuesAfter: flow.endedMs !== undefined && (session.endedAt === null || session.endedAt > flow.endedMs),
  })).filter(session => session.startedBefore || session.continuesAfter) : [];
  const { tree, excluded } = filteredTree(full, automation, automated);
  for (const sessionId of comparisonIds) {
    if (!keep(sessionId, automation, automated)) {
      excluded.set(sessionId, { sessionId, reason: automation[sessionId] ?? "not_automated" });
    }
  }
  const sessions = sessionsOf(tree), digestOf = loadedDigests(store);
  const findings = sessions.map(session => analyzeSession(session, digestOf));
  const usages = sessions.map(session => sessionUsage(session)), spec = flow?.spec;
  const warningSessions = [...sessions.map(session => session.id), ...comparisonIds.filter(id => !excluded.has(id))];
  const unattributedLoads = flow ? store.flowUnattributedLoads(flow.id, warningSessions, eventScope) :
    store.reconcileLoads({
      readOnly: true,
      from: ref === "outside" ? options.from ?? now - WEEK :
        sessions.length === 0 ? 0 : Math.min(...sessions.map(session => session.startedAt)),
      to: ref === "outside" ? options.to ?? now + 1 : now + 1, sessionIds: warningSessions,
    });
  return {
    generatedAt: now, id: ref === "outside" ? "outside" : tree.registered ? tree.id : `ws:${tree.workspaceId}`,
    kind: ref === "outside" ? "outside_herdr" : tree.registered ? "flow" : "workspace",
    workspaceId: tree.workspaceId, label: tree.label, registered: tree.registered,
    flow: flow ? { registeredMs: flow.registeredMs, endedMs: flow.endedMs ?? null, tabId: flow.tabId ?? null } : null,
    spec: spec ? { id: spec.id, name: spec.name, version: spec.version } : null, automated, tree,
    executionScope: eventScope ? {
      from: eventScope.from, to: eventScope.to, boundary: eventScope.boundary,
      overlaps: overlaps.filter(session => keep(session.sessionId, automation, automated)),
      label: eventScope.boundary === "recorded"
        ? "Events scoped by timestamp; persisted recording order resolves equal-time boundaries independently of membership discovery. Delayed interior evidence can still arrive. Session ends are observed separately."
        : "Some boundary ordering is unavailable. Unproven equal-time activity is excluded here; workspace history retains it.",
    } : null,
    finding: { id: tree.id, sessions: findings.map(findingDto), aggregate: aggregateFindings(findings.flatMap(f => f.turns)) },
    usage: { id: tree.id, sessions: usages, skills: aggregateUsage(usages.flatMap(u => u.spans)) },
    comparison: tree.registered ? compareFlow(store, tree.id, {
      excludeSessions: [...excluded.keys()], ...(eventScope ? { scope: eventScope } : {}),
    }) ?? null : null,
    excludedSessions: [...excluded.values()], unattributedLoads,
  };
}
export function buildSessionReport(store: ReportStore, id: string, automated: AutomatedMode, now: number) {
  const unattributedLoads = store.reconcileLoads({ sessionIds: [id], readOnly: true });
  const tree = sessionTree(store, id);
  if (!tree) throw new AnalysisReportError("session_not_found");
  const automation = store.sessionAutomation([id])[id];
  if (!keep(id, automation === undefined ? {} : { [id]: automation }, automated)) {
    throw new AnalysisReportError("automated_excluded", automation ?? null);
  }
  return {
    generatedAt: now, sessionId: tree.id, runtime: tree.runtime, startedAt: tree.startedAt, endedAt: tree.endedAt,
    automated: automation ?? null, tree, finding: findingDto(analyzeSession(tree, loadedDigests(store))),
    usage: sessionUsage(tree), unattributedLoads,
  };
}
export function buildSkillUsage(
  store: ReportStore, options: { from: number; to: number; detailLimit: number; automated: AutomatedMode }, now: number,
) {
  const { from, to, detailLimit, automated } = options;
  const usage = rangeUsage(store, { from, to, detailLimit, ...(automated === "exclude" ? {} : { automated }) });
  return {
    generatedAt: now, from, to, automated, detailLimit,
    sessionCount: usage.sessionCount, truncated: usage.truncated, skills: usage.skills, sessions: usage.sessions,
  };
}
