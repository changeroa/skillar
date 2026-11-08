import type { FindingLabel, SessionSkillReportDto, SkillSpan, TraceStep } from "../../../src/types.js";
import { isCall } from "../../components/calls";
import type { Fact } from "../../components/facts";

export type KeyedStep = { readonly kind: "step"; readonly step: TraceStep; readonly key: string };
export type TimelineItem =
  | KeyedStep
  | { readonly kind: "span"; readonly key: string; readonly span: SkillSpan; readonly turnId: string; readonly finding?: FindingLabel };

/**
 * Use recorded IDs independently of attribution and optional reports. Legacy records without
 * IDs retain their assigned IDs by immutable timestamp/kind and same-timestamp source sequence
 * (the store orders by ts, rowid), never by their mutable display or attribution payload.
 * This boundary receives the complete source trace, before any filtering or grouping.
 */
export function createTimelineKeys(sessionId = "") {
  return (steps: readonly TraceStep[]): KeyedStep[] => {
    const occurrences = new Map<string, number>();
    return steps.map((step): KeyedStep => {
      if (typeof step.detail.eventId === "string") return { kind: "step", step, key: `event:${JSON.stringify([sessionId, step.detail.eventId])}` };
      const idField = ["loadId", "callId", "toolUseId", "traceId", "requestId"]
        .find(field => typeof step.detail[field] === "string" && step.detail[field] !== "");
      const record = idField === undefined
        ? JSON.stringify([sessionId, step.kind, step.ts])
        : JSON.stringify([sessionId, step.kind, idField, step.detail[idField]]);
      const occurrence = occurrences.get(record) ?? 0;
      occurrences.set(record, occurrence + 1);
      return { kind: "step", step, key: `event:${record}:${occurrence}` };
    });
  };
}

/**
 * Folds the session's skill spans into the flat step list: each span is placed right after the step that activated
 * it, and the tool and model steps it owns move inside it, matched one for one by timestamp and kind. Without a
 * skill report (an older daemon, or a session the report cannot be read for) the timeline stays exactly as recorded.
 */
export function planTimeline(steps: readonly KeyedStep[], report?: Pick<SessionSkillReportDto, "tree" | "finding">): TimelineItem[] {
  steps = steps.filter(({ step }) => step.kind !== "skill_request");
  if (!report) return [...steps];
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
      // The assembler uses the activation event's immutable member ID as span.id.
      items.push({ kind: "span", key: `span:${entry.span.id}`, span: entry.span, turnId: entry.turnId, ...(entry.finding ? { finding: entry.finding } : {}) });
    }
  };
  for (const item of steps) {
    const step = item.step;
    const key = `${step.ts}:${step.kind}`;
    const remaining = owned.get(key) ?? 0;
    if (remaining > 0) {
      owned.set(key, remaining - 1);
      continue;
    }
    items.push(item);
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
