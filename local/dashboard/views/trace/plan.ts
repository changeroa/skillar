import type { FindingLabel, SessionSkillReportDto, SkillSpan, TraceStep } from "../../../src/types.js";
import { isCall } from "../../components/calls";
import type { Fact } from "../../components/facts";

export type TimelineItem =
  | { kind: "step"; step: TraceStep }
  | { kind: "span"; span: SkillSpan; turnId: string; finding?: FindingLabel };

/**
 * The trace DTO omits some source event IDs. Assign those records an ID once per open session,
 * independently of the optional report. Captured fields match later responses to that same ID;
 * equal captured records get separate IDs in their stable source order.
 */
export function createTimelineKeys() {
  const eventIds = new Map<string, string[]>();
  return (items: readonly TimelineItem[]) => {
    const occurrences = new Map<string, number>();
    return items.map(item => {
      switch (item.kind) {
        case "span": return { item, key: `span:${item.span.id}` };
        case "step": {
          const step = item.step;
          if (typeof step.detail.eventId === "string") return { item, key: `event:${step.detail.eventId}` };
          const record = JSON.stringify([step.kind, step.ts, Object.entries(step.detail).sort(([a], [b]) => a.localeCompare(b))]);
          const occurrence = occurrences.get(record) ?? 0;
          occurrences.set(record, occurrence + 1);
          const ids = eventIds.get(record) ?? [];
          const id = ids[occurrence] ?? crypto.randomUUID();
          ids[occurrence] = id;
          eventIds.set(record, ids);
          return { item, key: `event:${id}` };
        }
        default: { const exhaustive: never = item; return exhaustive; }
      }
    });
  };
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
