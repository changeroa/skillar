import { eventOrder, parseJson, storeError, type Event, type FactContext } from "./base.js";
import type { FactStore } from "./types.js";

/** Reports persisted ambiguity only. Even omitted/false readOnly never authorizes a fact-store write. */
export function reconcileLoads(ctx: FactContext, opts: Parameters<FactStore["reconcileLoads"]>[0] = {}):
  ReturnType<FactStore["reconcileLoads"]> {
  const from = opts.from ?? Number.MIN_SAFE_INTEGER, to = opts.to ?? Number.MAX_SAFE_INTEGER;
  const events = ctx.table("events"), candidates = ctx.table("load_candidates");
  const pending = (e: Event) => e.source === "mcp" && e.kind === "load" &&
    e.session_id === "unattributed" && e.attribution_reason === "ambiguous";
  const recoverable = (e: Event) => e.source === "mcp" && e.kind === "load" && (pending(e) ||
    e.attribution_method === "trace_handle" && parseJson<Record<string, unknown>>(e.data_json, {}).attributionBasis === "tool_call_uri");
  let loads: Event[];
  if (opts.eventId !== undefined) {
    const event = events.find(e => e.id === opts.eventId);
    if (!event) return { count: 0, uris: [] };
    if (event.kind === "load") loads = recoverable(event) ? [event] : [];
    else {
      const data = parseJson<Record<string, unknown>>(event.data_json, {});
      if (event.source !== "otel" || event.kind !== "tool_call" || event.session_id === "unattributed" ||
        data.success === false || data.success === 0) return { count: 0, uris: [] };
      const args = parseJson<unknown>(event.text, {});
      const server = args !== null && typeof args === "object" && "server" in args ? args.server : undefined;
      const flag = data.skillarMcp ?? data.gisoolMcp;
      const proven = flag === true || flag === 1 || typeof server === "string" && ["skillar", "gisool"].includes(server.toLowerCase());
      const uris = new Set<string>();
      const visit = (value: unknown): void => {
        if (typeof value === "string" && /^skill:\/\//i.test(value)) uris.add(value);
        else if (Array.isArray(value)) value.forEach(visit);
        else if (value !== null && typeof value === "object") Object.values(value).forEach(visit);
      };
      if (proven) visit(args);
      loads = [...uris].flatMap(uri => events.filter(e => recoverable(e) && e.runtime === event.runtime &&
        e.skill_uri === uri && e.ts >= event.ts - 10_000 && e.ts <= event.ts + 10_000 &&
        candidates.some(c => c.load_id === e.id && c.session_id === event.session_id)));
    }
  } else {
    loads = events.filter(e => pending(e) && (opts.sessionIds === undefined ?
      e.ts >= from && e.ts < to : candidates.some(c => c.load_id === e.id &&
        opts.sessionIds?.includes(c.session_id) && c.ts >= from && c.ts < to)));
    if (opts.limit !== undefined) {
      const cursor = opts.after === undefined ? { ts: from, source_order: 0 } : events.find(e => e.id === opts.after);
      if (!cursor || cursor.ts < from || cursor.ts >= to ||
        "source" in cursor && (cursor.source !== "mcp" || cursor.kind !== "load")) {
        throw storeError("invalid_repair_cursor", "repair cursor must identify an MCP load in the requested time range");
      }
      loads = loads.filter(e => e.ts > cursor.ts || e.ts === cursor.ts &&
        e.source_order !== null && cursor.source_order !== null && e.source_order > cursor.source_order).sort(eventOrder);
      if (opts.sessionIds !== undefined) loads = loads.filter(e => candidates.some(c => c.load_id === e.id &&
        opts.sessionIds?.includes(c.session_id) && c.ts >= Math.max(from, cursor.ts) && c.ts < to));
      // SQLite LIMIT -1 is unbounded; zero is an empty result.
      if (opts.limit >= 0) loads = loads.slice(0, opts.limit);
    }
  }
  const pendingLoads = loads.filter(e => e.skill_uri !== null && e.session_id === "unattributed");
  return { count: pendingLoads.length, uris: [...new Set(pendingLoads.flatMap(e => e.skill_uri === null ? [] : [e.skill_uri]))].sort(),
    ...(opts.limit === undefined ? {} : { examined: loads.length, repaired: 0,
      next: loads.length === opts.limit ? loads.at(-1)?.id ?? null : null }) };
}
