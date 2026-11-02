import { compareSql, parseJson, type FactContext, type Session } from "./base.js";

/** The three SQL joins: conversation, session-local call, and exact trace/span. NULL never equals NULL. */
export function matchedSpans(ctx: FactContext, sessions: readonly Session[], range?: { from: number; to: number }) {
  const events = ctx.table("events").filter(e => !range || e.ts >= range.from && e.ts <= range.to);
  return ctx.table("otel_spans").filter(o => sessions.some(s => {
    if (o.runtime !== s.runtime) return false;
    const conversation = o.conversation_id !== null &&
      (o.conversation_id === s.runtime_session_id || o.conversation_id === s.conversation_id);
    if (conversation) return true;
    if (o.conversation_id !== null) return false;
    return events.some(e => e.session_id === s.id && (
      o.call_id !== null && o.call_id === e.call_id ||
      o.span_id === e.span_id && o.trace_id === parseJson<Record<string, unknown>>(e.data_json, {}).otelTraceId));
  })).sort((a, b) => compareSql(a.start_ms, b.start_ms) || compareSql(a.trace_id, b.trace_id) || compareSql(a.span_id, b.span_id));
}
