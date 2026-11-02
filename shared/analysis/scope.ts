import type { AssignedTreeEvent, ExecutionEventScope, SessionTree } from "./types.js";
// Deliberate cycle with tree.ts, see there.
import { assembleSession } from "./tree.js";

/** Keep turn identity from the full assembly, but never carry observations across execution boundaries. */
export function scopeSession(session: SessionTree, scope: ExecutionEventScope): SessionTree {
  const { from, to } = scope;
  const end = to ?? Number.MAX_SAFE_INTEGER;
  const owned = new Set(scope.eventIds);
  const inside = (event: { readonly id: string }) => owned.has(event.id);
  const turns = session.turns.flatMap((turn, index) => {
    const events = turn.events.filter(inside);
    if (!events.length) return [];
    const original = new Map(events.map((e) => [e.id, e]));
    const endedAt = Math.min(end, session.turns[index + 1]?.startedAt ?? session.endedAt ?? (to ?? turn.endedAt));
    const startedAt = Math.max(from, turn.startedAt);
    // Reassemble activations from in-window events: the same skill may be activated again in a continuing turn.
    // An internal boundary preserves identity when the real prompt preceded registration; it never leaves here.
    const scoped = assembleSession({ id: session.id, runtime: session.runtime, startedAt, endedAt, spans: [],
      events: [{ id: `execution-boundary:${turn.id}`, ts: startedAt, kind: "prompt", source: "hook",
        turnKey: turn.id, callId: null, spanId: null, skillUri: null, text: null, textLength: null, data: {} },
      ...events.map((e) => ({ ...e, turnKey: turn.id }))] }).turns[0];
    if (!scoped) return [];
    const restore = (event: AssignedTreeEvent): AssignedTreeEvent => {
      const source = original.get(event.id);
      return source ? { ...event, turnKey: source.turnKey, basis: source.basis } : event;
    };
    return [{ ...scoped, basis: turn.basis, events: scoped.events.filter((e) => original.has(e.id)).map(restore),
      skillSpans: scoped.skillSpans.map((span) => ({ ...span, activation: restore(span.activation), events: span.events.map(restore) })) }];
  });
  // An execution end clips analysis, never observed lifecycle. A later session end must not rewrite A.
  const endedAt = session.endedAt !== null && (session.endedAt < end ||
    (session.endedAt === end && scope.sessionEnds?.[session.id] === end)) ? session.endedAt : null;
  return { ...session, endedAt,
    executionWindow: { from, to }, turns, unassignedEvents: session.unassignedEvents.filter(inside) };
}
