import type { ExecutionEventScope, TreePaneLink } from "../activity-analysis.js";
import { compareSql, eventOrder, parseJson, type FactContext, type Flow } from "./base.js";
import { matchedSpans } from "./spans.js";

export function executionCandidates(ctx: FactContext, flow: Flow) {
  const from = flow.registered_ms ?? 0, to = flow.ended_ms ?? Number.MAX_SAFE_INTEGER;
  const panes = ctx.table("herdr_panes");
  const candidates = panes.filter(p => flow.workspace_id !== null && p.workspace_id === flow.workspace_id &&
    (flow.tab_id === null || p.tab_id === flow.tab_id) && (p.created_ms ?? from) <= to && (p.closed_ms ?? to) >= from)
    .map(p => ({ id: p.id, created_ms: p.created_ms }));
  for (const step of ctx.table("flow_steps").filter(s => s.flow_id === flow.id)) {
    if (!candidates.some(p => p.id === step.pane_id)) {
      candidates.push({ id: step.pane_id, created_ms: panes.find(p => p.id === step.pane_id)?.created_ms ?? null });
    }
  }
  const paneIds = candidates.sort((a, b) => compareSql(a.created_ms, b.created_ms) || compareSql(a.id, b.id)).map(p => p.id);
  const sessions = ctx.table("sessions");
  const links = ctx.table("pane_sessions").filter(l => paneIds.includes(l.pane_id) &&
    (l.session_id !== null || l.first_seen_ms !== null && l.first_seen_ms >= from && l.first_seen_ms <= to))
    .sort((a, b) => compareSql(a.first_seen_ms, b.first_seen_ms) || compareSql(a.agent_session_value, b.agent_session_value))
    .map(l => ({
      paneId: l.pane_id, sessionId: l.session_id, startedAt: sessions.find(s => s.id === l.session_id)?.started_at ?? null,
      agentSessionValue: l.agent_session_value, source: l.source,
      firstSeenMs: Math.min(Math.max(l.first_seen_ms ?? from, from), to),
      lastSeenMs: Math.max(Math.min(l.last_seen_ms ?? to, to), from),
    }));
  return { paneIds, links };
}

const position = (json: string, domain: string | null): number | null =>
  domain === null ? null : parseJson<Record<string, number>>(json, {})[domain] ?? null;

/** Timestamp equality uses persisted recording vectors, never arrival order in this adapter. */
export function executionEventScope(ctx: FactContext, flow: Flow, warningSessionIds: readonly string[] = [],
  includeSpanCut = true): ExecutionEventScope {
  const from = flow.registered_ms ?? 0, to = flow.ended_ms;
  const candidates = executionCandidates(ctx, flow);
  const sessionIds = new Set(candidates.links.flatMap(l => l.sessionId === null ? [] : [l.sessionId]));
  const candidateIds = new Set([...sessionIds, ...warningSessionIds]);
  const loadIds = new Set(ctx.table("load_candidates").filter(c => candidateIds.has(c.session_id) &&
    c.ts >= from && c.ts <= (to ?? Number.MAX_SAFE_INTEGER)).map(c => c.load_id));
  const rows = ctx.table("events").filter(e =>
    sessionIds.has(e.session_id) && e.ts >= from && e.ts <= (to ?? Number.MAX_SAFE_INTEGER) ||
    loadIds.has(e.id) && e.kind === "load" && e.source === "mcp").sort(eventOrder)
    .map(e => ({ ...e, start_position: position(e.recording_orders_json, flow.start_order_domain),
      end_position: position(e.recording_orders_json, flow.end_order_domain) }));
  const legacyEnds = new Set(parseJson<string[]>(flow.end_event_ids_json, []));
  const owned = rows.filter(e =>
    (e.ts > from || flow.start_order !== null && e.start_position !== null && e.start_position > flow.start_order) &&
    (to === null || e.ts < to || (flow.end_order !== null ?
      e.end_position !== null && e.end_position <= flow.end_order : legacyEnds.has(e.id))));
  let unavailable = flow.start_order === null || to !== null && flow.end_order === null ||
    rows.some(e => e.ts === from && e.start_position === null || e.ts === to && e.end_position === null);
  let spanKeys: string[] | null = flow.end_spans_json === null ? null :
    parseJson<string[][]>(flow.end_spans_json, []).map(key => JSON.stringify(key));
  const sessions = ctx.table("sessions").filter(s => sessionIds.has(s.id));
  if (includeSpanCut && to !== null && flow.end_order !== null) {
    const spans = matchedSpans(ctx, sessions, { from, to }).filter(s => s.start_ms === null || s.start_ms === to)
      .sort((a, b) => compareSql(a.trace_id, b.trace_id) || compareSql(a.span_id, b.span_id));
    spanKeys = [];
    for (const span of spans) {
      const at = position(span.recording_orders_json, flow.end_order_domain);
      if (at === null) unavailable = true;
      else if (at <= flow.end_order) spanKeys.push(JSON.stringify([span.trace_id, span.span_id]));
    }
  }
  const sessionEnds = flow.end_sessions_json === null ? null : parseJson<Record<string, number | null>>(flow.end_sessions_json, {});
  if (sessionEnds !== null && to !== null && flow.end_order !== null) {
    for (const s of sessions.filter(s => s.ended_at === to)) {
      if (Object.hasOwn(sessionEnds, s.id)) continue;
      const at = position(s.end_orders_json, flow.end_order_domain);
      if (at === null) unavailable = true;
      else if (at <= flow.end_order) sessionEnds[s.id] = to;
    }
  }
  const activity = new Map<string, { first: number; last: number }>();
  for (const row of owned) {
    const times = activity.get(row.session_id);
    if (times) times.last = row.ts;
    else activity.set(row.session_id, { first: row.ts, last: row.ts });
  }
  const links: TreePaneLink[] = candidates.links.flatMap(({ startedAt, ...link }) => {
    if (link.sessionId === null) return [link];
    const times = activity.get(link.sessionId);
    if (!times && !(to === null && startedAt !== null && startedAt > from)) return [];
    if (startedAt === null) return [];
    return [{ ...link, firstSeenMs: Math.max(from, Math.min(startedAt, times?.first ?? startedAt)),
      lastSeenMs: Math.min(to ?? Number.MAX_SAFE_INTEGER, Math.max(startedAt, times?.last ?? startedAt)) }];
  });
  return { from, to, paneIds: candidates.paneIds, links, eventIds: owned.map(e => e.id),
    priorEventIds: flow.start_order === null ? parseJson<string[]>(flow.start_event_ids_json, []) :
      rows.filter(e => e.ts === from && e.start_position !== null && flow.start_order !== null && e.start_position <= flow.start_order).map(e => e.id),
    sessionEnds, spanKeys, boundary: unavailable ? "order_unavailable" : "recorded" };
}
