import { requestRecords } from "./request-status.js";
import { parseJson, nameFromUri, eventOrder, skillMeta, metaFor, type FactContext } from "./base.js";
import type { Candidate, SkillUri, TraceStep, FactStore } from "./types.js";
function candidatesOf(data: Record<string, unknown>): Candidate[] {
  return Array.isArray(data.candidates) ? (data.candidates as Candidate[]) : [];
}
function llmTokens(data: Record<string, unknown>): number {
  const n = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  if (typeof data.totalTokens === "number") return data.totalTokens;
  const base = n(data.inputTokens) + n(data.outputTokens);
  return data.inputIncludesCache === true ? base : base + n(data.cacheReadTokens) + n(data.cacheCreationTokens);
}
function shortDigest(d: unknown): string {
  const s = typeof d === "string" ? d : "";
  return s.replace(/^sha256[:-]/, "").slice(0, 12);
}
export function createTrace(ctx: FactContext): Pick<FactStore, "trace"> { return { trace(sessionId: string): TraceStep[] {
      const evs = ctx.table("events").filter(e => e.session_id === sessionId).sort(eventOrder);
      const skills = skillMeta(ctx);
      const loadsByTrace = new Map<string, { ts: number; uri: SkillUri }[]>();
      for (const e of evs) {
        if (e.kind !== "load" || !e.trace_id || !e.skill_uri) continue;
        const list = loadsByTrace.get(e.trace_id) ?? [];
        list.push({ ts: e.ts, uri: e.skill_uri });
        loadsByTrace.set(e.trace_id, list);
      }
      const loadRow = { get: (id: string) => ctx.table("loads").find(r => r.load_id === id) };
      const requestOutcomes = new Map(requestRecords(evs.map((e) => ({ id: e.id, ts: e.ts, kind: e.kind, data: parseJson<Record<string, unknown>>(e.data_json, {}) })), new Set(ctx.runtime.activeRequests)).map((r) => [r.id, r]));
      return evs.map((e): TraceStep => {
        const data = parseJson<Record<string, unknown>>(e.data_json, {});
        switch (e.kind) {
          case "prompt": {
            const textLength = e.text_length ?? e.text?.length;
            const summary = e.text ? e.text.slice(0, 200) : `(prompt not captured${textLength !== undefined ? `, ${textLength} chars` : ""})`;
            return { ts: e.ts, kind: e.kind, summary, detail: { kind: "prompt", ...(e.text !== null ? { text: e.text } : {}), ...(textLength !== undefined ? { textLength } : {}) } };
          }
          case "search": {
            const traceId = e.trace_id ?? (typeof data.traceId === "string" ? data.traceId : "");
            const later = (loadsByTrace.get(traceId) ?? []).filter((l) => l.ts >= e.ts).map((l) => l.uri);
            const cands = candidatesOf(data).map((c) => ({ ...c, chosen: later.includes(c.uri) }));
            const chosen = cands.filter((c) => c.chosen).map((c) => c.uri);
            const query = typeof data.query === "string" ? data.query : "";
            const abstained = data.abstained as { reason: string } | undefined;
            const summary = abstained
              ? `search "${query}" abstained (${abstained.reason}) in ${Number(data.elapsedMs ?? 0)} ms`
              : `search "${query}" -> ${cands.length} candidates in ${Number(data.elapsedMs ?? 0)} ms`;
            return { ts: e.ts, kind: e.kind, summary, detail: { ...data, kind: "search", traceId, chosen, candidates: cands } };
          }
          case "load": {
            const loadId = e.load_id ?? (typeof data.loadId === "string" ? data.loadId : "");
            const stored = loadId ? (loadRow.get(loadId) as { uri: string; manifest_digest: string } | undefined) : undefined;
            const uri = e.skill_uri ?? stored?.uri ?? (typeof data.uri === "string" ? data.uri : "");
            const manifestDigest = typeof data.manifestDigest === "string" ? data.manifestDigest : stored?.manifest_digest ?? "";
            return { ts: e.ts, kind: e.kind, summary: `load ${metaFor(skills, uri).name} (${uri}) @${shortDigest(manifestDigest)}`,
              detail: { ...data, kind: "load", uri, loadId, manifestDigest } };
          }
          case "read_file": {
            const uri = typeof data.uri === "string" ? data.uri : "";
            const bytes = Number(data.bytes ?? data.size ?? 0);
            const skillUri = e.skill_uri ?? (typeof data.skillUri === "string" ? data.skillUri : "");
            return { ts: e.ts, kind: e.kind, summary: `read ${uri} (${bytes} bytes)`, detail: { kind: "read_file", skillUri, uri, bytes } };
          }
          case "native_skill": {
            const name = typeof data.name === "string" ? data.name : e.skill_uri ? nameFromUri(e.skill_uri) : "unknown";
            const via = typeof data.via === "string" ? data.via : "tool";
            return { ts: e.ts, kind: e.kind, summary: `native skill ${name} via ${via}`, detail: { kind: "native_skill", name, via } };
          }
          case "llm_call": {
            const model = typeof data.model === "string" ? data.model : "unknown";
            return { ts: e.ts, kind: e.kind, summary: `model call: ${model}, ${llmTokens(data)} tokens`,
              detail: { ...data, kind: "llm_call", inputIncludesCache: data.inputIncludesCache === true } };
          }
          case "tool_call": {
            const toolName = typeof data.toolName === "string" ? data.toolName : "unknown";
            const durationMs = typeof data.durationMs === "number" ? data.durationMs : undefined;
            const outcome = data.success === true ? "ok" : data.success === false ? "failed" : "unknown";
            return { ts: e.ts, kind: e.kind, summary: `tool: ${toolName} (${durationMs ?? "?"} ms, ${outcome})`,
              detail: { ...data, kind: "tool_call", toolName,
                ...(e.tool_use_id !== null ? { toolUseId: e.tool_use_id } : {}), ...(e.call_id !== null ? { callId: e.call_id } : {}),
                ...(e.text !== null ? { args: e.text } : {}), ...(e.text_length !== null ? { argsLength: e.text_length } : {}) } };
          }
          case "skill_request": {
            const record = requestOutcomes.get(String(data.requestId));
            return { ts: e.ts, kind: e.kind, summary: `${data.operation} request: ${record?.status ?? "unknown"}`, detail: { ...data, kind: e.kind, currentStatus: record?.status ?? "unknown" } };
          }
          case "error": {
            const code = typeof data.code === "string" ? data.code : "error";
            const message = typeof data.message === "string" ? data.message : e.text ?? "";
            return { ts: e.ts, kind: e.kind, summary: `error ${code}${message ? `: ${message.slice(0, 200)}` : ""}`, detail: { ...data, ...(e.skill_uri ? { uri: e.skill_uri } : {}), kind: "error", code, message } };
          }
          default:
            return { ts: e.ts, kind: e.kind, summary: e.kind === "session_start" ? "session started" : "session ended", detail: { kind: e.kind } };
        }
      });
    } }; }
