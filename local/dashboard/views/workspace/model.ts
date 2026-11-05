import type { AttributionShare, SkillSpanUsage } from "../../../src/analysis/usage.js";
import type { AutomatedMode, Filter, FlowListEntry, FlowReportDto, FlowSpecRef, SessionTree, SkillSpan, TurnFindingDto } from "../../../src/types.js";
import type { FlowsQuery } from "../../api";
import { UNKNOWN, numberOf } from "../../components/calls";
import type { Fact } from "../../components/facts";
import { SPAN_ATTRIBUTION_LABEL, type Route } from "../../state";

export const SUMMARY_CONCURRENCY = 2;
export const TURNS_OPEN_MAX = 3;
export const dateTimeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
export const clockFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function flowTitle(entry: Pick<FlowListEntry, "label" | "workspaceId">): string {
  return entry.label ?? entry.workspaceId;
}

/**
 * The two parts of the spec tag: a registered flow names its spec and version, a herdr workspace nobody registered
 * has no version at all. They stay separate so a long name can truncate while its version stays on screen.
 */
export function specTagParts(spec: FlowSpecRef | null): { name: string; version: string | null } {
  return spec ? { name: spec.name, version: `v${spec.version}` } : { name: "미등록", version: null };
}

export function specLabel(spec: FlowSpecRef | null): string {
  const { name, version } = specTagParts(spec);
  return version === null ? name : `${name} ${version}`;
}

/** A time herdr never reported stays unknown instead of becoming the epoch. */
export function formatStarted(ms: number | null | undefined): string {
  const value = numberOf(ms);
  return value === undefined ? UNKNOWN : dateTimeFmt.format(value);
}

/** Which skill the calls of a span were credited to; a count of 0 is left out, and no call at all says so. */
export function attributionParts(share: AttributionShare): { key: keyof typeof SPAN_ATTRIBUTION_LABEL; label: string; value: number; title: string }[] {
  const counts: [keyof typeof SPAN_ATTRIBUTION_LABEL, number, string][] = [
    ["reported", share.reported, "실행 환경이 이 스킬에 연결했습니다"],
    ["single", share.single, "이 스킬만 활성 상태였습니다"],
    ["co_active", share.coActive, "다른 스킬도 동시에 활성 상태였습니다"],
  ];
  return counts.flatMap(([key, value, why]) => (value > 0
    ? [{ key, label: SPAN_ATTRIBUTION_LABEL[key], value, title: `호출 ${value}건: ${why}` }]
    : []));
}

export type FlowSummary = {
  turns: number; foundViaSearch: number; abstainedTurns: number;
  spans: number; spansWithCalls: number;
  /** Null unless every unique model call reported its cost. Span observations are non-additive. */
  costUsd: number | null;
};

export function flowSummary(report: Pick<FlowReportDto, "finding" | "usage" | "tree" | "flow">): FlowSummary {
  const { labels, turns, abstainedTurns } = report.finding.aggregate;
  const spans = report.usage.sessions.flatMap((session) => session.spans);
  const sessions = new Map((report.tree.sessions ?? []).map((session) => [session.id, session]));
  for (const tab of report.tree.tabs) for (const pane of tab.panes) {
    for (const link of pane.sessions) if (link.session) sessions.set(link.session.id, link.session);
  }
  const costs = new Map<string, number | undefined>();
  for (const session of sessions.values()) {
    for (const event of [...session.turns.flatMap((turn) => turn.events), ...session.unassignedEvents]) {
      if (event.kind !== "llm_call") continue;
      if (report.flow?.registeredMs !== null && report.flow?.registeredMs !== undefined && event.ts < report.flow.registeredMs) continue;
      if (report.flow?.endedMs !== null && report.flow?.endedMs !== undefined && event.ts > report.flow.endedMs) continue;
      const key = JSON.stringify([session.id, event.callId ?? event.id]);
      const cost = numberOf(event.data.costUsd);
      // Repeated observations cannot hide an unknown measurement.
      costs.set(key, costs.has(key) && costs.get(key) === undefined ? undefined : cost);
    }
  }
  const known = [...costs.values()].filter((cost): cost is number => cost !== undefined);
  return {
    turns,
    foundViaSearch: labels.found_top1 + labels.found_lower,
    abstainedTurns,
    spans: spans.length,
    spansWithCalls: spans.filter((span) => span.followThrough > 0).length,
    costUsd: known.length === costs.size && known.length > 0 ? known.reduce((sum, cost) => sum + cost, 0) : null,
  };
}

export function summaryFacts(summary: FlowSummary): Fact[] {
  const facts: Fact[] = [
    { key: "turns", value: summary.turns },
    { key: "found", value: summary.foundViaSearch },
    { key: "spans", withCalls: summary.spansWithCalls, total: summary.spans },
  ];
  if (summary.abstainedTurns > 0) facts.push({ key: "abstained", value: summary.abstainedTurns });
  facts.push({ key: "cost", value: summary.costUsd });
  return facts;
}

export function entryFacts(entry: FlowListEntry): Fact[] {
  if (entry.kind === "outside_herdr") return [{ key: "sessions", value: entry.counts.sessions }];
  const facts: Fact[] = [{ key: "workspace", value: entry.workspaceId }];
  if (entry.tabId !== null) facts.push({ key: "tab", value: entry.tabId });
  facts.push({ key: "panes", value: entry.counts.panes }, { key: "sessions", value: entry.counts.sessions });
  if (entry.attribution.inferred > 0) facts.push({ key: "inferred", value: entry.attribution.inferred });
  if (entry.attribution.unlinked > 0) facts.push({ key: "unlinked", value: entry.attribution.unlinked });
  return facts;
}

/** The shared filter, narrowed to what GET /api/flows accepts. */
export function flowsQuery(route: Route): FlowsQuery {
  return {
    ...(route.filter.from !== undefined ? { from: route.filter.from } : {}),
    ...(route.filter.to !== undefined ? { to: route.filter.to } : {}),
    ...(route.filter.automated !== undefined ? { automated: route.filter.automated as AutomatedMode } : {}),
  };
}

export function workspaceFilter(query: FlowsQuery): Filter {
  return { from: query.from, to: query.to, automated: query.automated === "exclude" ? undefined : query.automated };
}

export function turnsOpen(count: number): boolean {
  return count <= TURNS_OPEN_MAX;
}

export function sessionInWindow(session: SessionTree, flow: FlowReportDto["flow"]): boolean {
  const start = flow?.registeredMs;
  const end = flow?.endedMs;
  return start == null || [...session.turns.flatMap((turn) => turn.events), ...session.unassignedEvents]
    .some((event) => event.ts >= start && (end == null || event.ts <= end));
}

/** Per-turn finding and per-span usage, keyed the way the tree is walked. */
export function reportIndex(report: Pick<FlowReportDto, "finding" | "usage">): { findings: Map<string, TurnFindingDto>; usageBySpan: Map<string, SkillSpanUsage> } {
  const findings = new Map<string, TurnFindingDto>();
  for (const session of report.finding.sessions) for (const turn of session.turns) findings.set(turn.turnId, turn);
  const usageBySpan = new Map<string, SkillSpanUsage>();
  for (const session of report.usage.sessions) for (const span of session.spans) usageBySpan.set(span.spanId, span);
  return { findings, usageBySpan };
}

export function spanFacts(span: Pick<SkillSpan, "startedAt" | "endedAt">, usage: SkillSpanUsage | undefined, calls: number): Fact[] {
  if (!usage) {
    return [{ key: "active", value: span.endedAt - span.startedAt }, { key: "calls", value: calls }, { key: "cost", value: null }];
  }
  const facts: Fact[] = [
    { key: "active", value: usage.durationMs },
    { key: "callsAfter", value: usage.followThrough },
  ];
  if (usage.activity.commands > 0) facts.push({ key: "commands", value: usage.activity.commands });
  if (usage.activity.unresolvedExec > 0) facts.push({ key: "unresolvedExec", value: usage.activity.unresolvedExec });
  if (usage.skillToolCalls > 0) facts.push({ key: "skillarCalls", value: usage.skillToolCalls });
  if (usage.toolFailures > 0) facts.push({ key: "failed", value: usage.toolFailures });
  if (usage.supportingReads.length > 0) facts.push({ key: "reads", value: usage.supportingReads.length });
  facts.push({ key: "cost", value: usage.costUsd });
  return facts;
}
