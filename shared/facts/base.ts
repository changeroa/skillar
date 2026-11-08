import type { ContentRow, ContentTable } from "../activity-content.js";
import type { AnalysisRuntime } from "../activity-runtime.js";
import type { Attribution, EventKind, RuntimeId } from "./types.js";

export type Ordered = { source_order: number | null };
export type Session = Ordered & {
  id: string; runtime: RuntimeId; runtime_session_id: string | null; conversation_id: string | null;
  client_name: string | null; cwd: string | null; started_at: number; ended_at: number | null;
  first_prompt: string | null; end_orders_json: string;
};
export type Event = Ordered & {
  id: string; ts: number; kind: EventKind; source: "mcp" | "otel" | "hook"; session_id: string;
  attribution_method: Attribution["method"]; attribution_reason: string | null; runtime: RuntimeId;
  trace_id: string | null; load_id: string | null; skill_uri: string | null; text: string | null;
  text_length: number | null; data_json: string; tool_use_id: string | null; turn_key: string | null;
  call_id: string | null; span_id: string | null; source_key: string | null; recording_orders_json: string;
};
export type Span = Ordered & {
  trace_id: string; span_id: string; parent_span_id: string | null; name: string; runtime: RuntimeId;
  conversation_id: string | null; turn_key: string | null; call_id: string | null;
  start_ms: number | null; end_ms: number | null; received_at: number; recording_orders_json: string;
};
export type Flow = Ordered & {
  id: string; workspace_id: string | null; tab_id: string | null; spec_id: string | null;
  label: string | null; registered_ms: number | null; ended_ms: number | null;
  start_event_ids_json: string | null; end_event_ids_json: string | null;
  end_sessions_json: string | null; end_spans_json: string | null;
  start_order_domain: string | null; start_order: number | null; end_order_domain: string | null; end_order: number | null;
};
type Topology = Ordered & { id: string; label: string | null; created_ms: number | null; closed_ms: number | null };
export type Link = Ordered & { pane_id: string; session_id: string | null; agent_session_value: string;
  source: string | null; first_seen_ms: number | null; last_seen_ms: number | null };
export type Tables = {
  sessions: Session; events: Event; otel_spans: Span; flows: Flow;
  skills: Ordered & { uri: string; name: string; tags_json: string; group_id: string | null; removed_at: number | null };
  loads: Ordered & { load_id: string; trace_id: string | null; uri: string; manifest_digest: string; resources_json: string; created_at: number };
  eval_cases: Ordered & { query: string; expected_uri: string | null; created_at: number };
  herdr_workspaces: Topology;
  herdr_tabs: Topology & { workspace_id: string | null };
  herdr_panes: Topology & { workspace_id: string | null; tab_id: string | null };
  pane_sessions: Link;
  workflow_specs: Ordered & { id: string; name: string; version: number; body_json: string; digest: string; created_ms: number };
  flow_steps: Ordered & { flow_id: string; pane_id: string; step_id: string; registered_ms: number | null };
  load_candidates: Ordered & { load_id: string; session_id: string; ts: number };
  recording_clock: Ordered & { singleton: number; domain: string; position: number };
};
export type FactOptions = { readonly runtime: AnalysisRuntime; readonly now?: () => number; readonly tz?: string };
export type FactContext = {
  table<K extends ContentTable>(name: K): Tables[K][];
  readonly runtime: AnalysisRuntime; readonly now: () => number; readonly tz: string;
};

/** Complete, already reconstructed source rows, not a CDC reducer or a redaction fallback. */
export function factContext(rows: readonly ContentRow[], options: FactOptions): FactContext {
  const tables = new Map<ContentTable, Ordered[]>();
  for (const row of rows) {
    if (row.operation !== "upsert" || row.values === null) {
      throw storeError("snapshot_required", "fact reads require reconstructed upsert rows");
    }
    const list = tables.get(row.table) ?? [];
    list.push({ ...row.values, source_order: row.sourceOrder });
    tables.set(row.table, list);
  }
  for (const list of tables.values()) list.sort(sourceOrder);
  const runtime = structuredClone(options.runtime);
  return {
    // ContentRow's wire schema checks scalar types; complete local table projections are the caller's contract.
    table: <K extends ContentTable>(name: K) => [...(tables.get(name) ?? [])] as Tables[K][],
    runtime, now: options.now ?? (() => runtime.capturedAtMs), tz: options.tz ?? runtime.tz,
  };
}

/** SQLite BINARY order compares Unicode scalar values (UTF-8), not locale or UTF-16 code units. */
export function compareSql(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const left = Array.from(String(a), c => c.codePointAt(0) ?? 0);
  const right = Array.from(String(b), c => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i] ?? 0, y = right[i] ?? 0;
    if (x !== y) return x - y;
  }
  return left.length - right.length;
}
export const sourceOrder = (a: Ordered, b: Ordered): number => compareSql(a.source_order, b.source_order);
export const eventOrder = (a: Event, b: Event): number => a.ts - b.ts || sourceOrder(a, b);
/** node:sqlite exposes unprojected SELECT rows with a null prototype. */
export function sqlRow<T extends object>(value: T): T {
  return Object.setPrototypeOf(value, null);
}
export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || text === "") return fallback;
  try { return JSON.parse(text) as T; } catch (error) {
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}
export function nameFromUri(uri: string): string {
  const parts = uri.split("/").filter(Boolean);
  const last = parts.at(-1);
  return (last === "SKILL.md" ? parts.at(-2) : last) ?? uri;
}
export function storeError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}
export function skillMeta(ctx: FactContext) {
  return new Map(ctx.table("skills").map(r => [r.uri, {
    uri: r.uri, name: r.name, tags: parseJson<string[]>(r.tags_json, []), ...(r.group_id ? { groupId: r.group_id } : {}),
  }]));
}
export function metaFor(skills: ReturnType<typeof skillMeta>, uri: string) {
  return skills.get(uri) ?? { uri, name: nameFromUri(uri), tags: [] };
}
