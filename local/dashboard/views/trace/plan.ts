import type { FindingLabel, SessionSkillReportDto, SkillSpan, TraceStep, TreeEvent } from "../../../src/types.js";
import { isCall } from "../../components/calls";
import type { Fact } from "../../components/facts";

export type TimelineItem =
  | { kind: "step"; step: TraceStep }
  | { kind: "span"; span: SkillSpan; turnId: string; finding?: FindingLabel };

/** The report supplies canonical event IDs without changing the legacy trace response. */
export function timelineKey(item: TimelineItem, report?: Pick<SessionSkillReportDto, "tree">, claimed = new Set<string>()): string {
  switch (item.kind) {
    case "span": return `span:${item.span.id}`;
    case "step": {
      const step = item.step;
      const id = step.detail.eventId;
      if (typeof id === "string" && id) return `event:${id}`;
      const events: readonly TreeEvent[] = report
        ? [...report.tree.turns.flatMap(turn => turn.events ?? []), ...(report.tree.unassignedEvents ?? [])] : [];
      const event = events.find(event => !claimed.has(event.id) && event.ts === step.ts && event.kind === step.kind &&
        (step.kind !== "prompt" || event.text === (step.detail.text ?? null)));
      if (event) { claimed.add(event.id); return `event:${event.id}`; }
      for (const field of ["traceId", "loadId", "callId", "toolUseId"]) {
        const value = step.detail[field];
        if (typeof value === "string" && value) return `${step.kind}:${value}`;
      }
      // Older reports may omit event IDs; recorded content, never array position, identifies those rows.
      return JSON.stringify([step.kind, step.ts, step.summary, Object.entries(step.detail).sort(([a], [b]) => a.localeCompare(b))]);
    }
    default: { const exhaustive: never = item; return exhaustive; }
  }
}

/**
 * Folds the session's skill spans into the flat step list: each span is placed right after the step that activated
 * it, and the tool and model steps it owns move inside it, matched one for one by timestamp and kind. Without a
 * skill report (an older daemon, or a session the report cannot be read for) the timeline stays exactly as recorded.
 */
export function planTimeline(steps: readonly TraceStep[], report?: Pick<SessionSkillReportDto, "tree" | "finding">): TimelineItem[] {
  steps = steps.filter((step) => step.kind !== "skill_request");
  if (!report) return steps.map((step) => ({ kind: "step", step }));
  const labels = new Map(report.finding.turns.map((turn) => [turn.turnId, turn.label]));
  const spans = report.tree.turns
    .flatMap((turn) => turn.skillSpans.map((span) => ({ span, turnId: turn.id, finding: labels.get(turn.id) })))
    .sort((a, b) => a.span.startedAt - b.span.startedAt);
  const owned = new Map<string, number>();
  for (const { span } of spans) {
    for (const event of span.events) {
      if (!isCall(event)) continue;
      const key = `${event.ts}:${event.kind}`;
      owned.set(key, (owned.get(key) ?? 0) + 1);
    }
  }
  const items: TimelineItem[] = [];
  let pending = 0;
  const placeUpTo = (ts: number) => {
    while (pending < spans.length) {
      const entry = spans[pending];
      if (entry.span.startedAt > ts) return;
      pending += 1;
      items.push({ kind: "span", span: entry.span, turnId: entry.turnId, ...(entry.finding ? { finding: entry.finding } : {}) });
    }
  };
  for (const step of steps) {
    const key = `${step.ts}:${step.kind}`;
    const remaining = owned.get(key) ?? 0;
    if (remaining > 0) {
      owned.set(key, remaining - 1);
      continue;
    }
    items.push({ kind: "step", step });
    placeUpTo(step.ts);
  }
  placeUpTo(Number.POSITIVE_INFINITY);
  return items;
}

export function spanFacts(span: Pick<SkillSpan, "startedAt" | "endedAt">, calls: number, finding?: FindingLabel): Fact[] {
  const facts: Fact[] = [{ key: "active", value: span.endedAt - span.startedAt }, { key: "calls", value: calls }];
  if (finding) facts.push({ key: "finding", value: finding });
  return facts;
}
