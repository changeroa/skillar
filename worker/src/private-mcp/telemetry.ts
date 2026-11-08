import { z } from "zod";
import type { McpContext } from "../../../shared/mcp-auth.ts";
import { contentRowSchema } from "../../../shared/activity-content.ts";
import type { ContentRow } from "../../../shared/activity-content.ts";
import type { Candidate } from "../../../shared/facts/types.ts";
import type { ContentEnv } from "../activity/content-env.ts";
import { acceptContentBatch } from "../activity/content-service.ts";
import { commitRuntime } from "../activity/runtime-api.ts";
import {
  initializeMcpSource, mcpIngestPrincipal, mcpRecordingEnv, requireMcpRecording, uploadMcpContent,
} from "./telemetry-source.ts";

export { mcpSourceStatements } from "./telemetry-source.ts";
export type McpSearchObservation = {
  readonly query: string; readonly traceId: string;
  readonly mode: "discovery" | "automatic" | "explicit";
  readonly candidates: readonly Candidate[]; readonly total: number; readonly elapsedMs: number;
  readonly abstained?: { readonly reason: "empty_query" | "no_overlap" | "below_threshold" | "explicit_only";
    readonly hint: string };
};
export type McpReadObservation = {
  readonly uri: string; readonly skillUri: string; readonly path: string;
  readonly bytes: number; readonly manifestDigest: string; readonly traceId?: string;
};

async function record(env: ContentEnv, context: McpContext, observation: {
  readonly kind: "search" | "load" | "read_file"; readonly traceId: string | null;
  readonly skillUri: string | null; readonly data: object; readonly manifestDigest?: string;
}) {
  if (!context.recordActivity) return false;
  const consent = await requireMcpRecording(env, context);
  const principal = mcpIngestPrincipal(context), now = Date.now();
  const scope = { deviceId: principal.deviceId, projectId: `device:${principal.deviceId}`,
    rootId: null, consentVersion: consent.version,
    range: { fromMs: consent.grantedAtMs, toMs: 8_640_000_000_000_000 }, backfill: null };
  const guarded = mcpRecordingEnv(env, context, scope);
  await initializeMcpSource(guarded, context, scope);
  const head = z.object({ sequence: z.number().int(), journal_through: z.number().int() }).parse(
    await env.ACTIVITY.prepare(`SELECT sequence,journal_through FROM device_streams
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain='mcp'`)
      .bind(principal.accountId, principal.generation, principal.deviceId).first());
  const revision = head.journal_through + 1, sequence = head.sequence + 1;
  const id = crypto.randomUUID(), sessionId = context.principal.connectionId;
  const loadId = observation.kind === "load" ? id : null;
  const row = (table: ContentRow["table"], key: string | number, values: ContentRow["values"]) =>
    contentRowSchema.parse({ table, key: JSON.stringify([key]), values, revision,
      operation: "upsert", sourceOrder: revision });
  const rows = [
    row("recording_clock", 1, { singleton: 1, domain: sessionId, position: revision }),
    row("events", id, { id, ts: now, kind: observation.kind, source: "mcp", session_id: sessionId,
      attribution_method: "runtime_id", attribution_reason: null, runtime: "unknown",
      trace_id: observation.traceId, load_id: loadId, skill_uri: observation.skillUri,
      text: null, text_length: null, text_digest: null, tool_use_id: null,
      turn_key: null, call_id: null, span_id: null, source_key: id,
      recording_orders_json: JSON.stringify({ [sessionId]: revision }),
      data_json: JSON.stringify({ ...observation.data, sourceId: sessionId }) }),
  ];
  if (head.sequence === 0) rows.push(row("sessions", sessionId, {
    id: sessionId, runtime: "unknown", runtime_session_id: sessionId, conversation_id: null,
    client_name: context.clientName, cwd: null, first_prompt: null,
    started_at: now, ended_at: null, end_orders_json: "{}",
  }));
  if (loadId !== null) rows.push(row("loads", loadId, { load_id: loadId,
    trace_id: observation.traceId, uri: observation.skillUri,
    manifest_digest: observation.manifestDigest ?? "", resources_json: "[]", created_at: now }));
  const batchId = crypto.randomUUID();
  const content = await uploadMcpContent(guarded, principal, { scope, batchId, revision,
    value: { schemaVersion: 2, rows } });
  await acceptContentBatch(guarded, principal, { ...scope, schemaVersion: 2,
    sourceDomain: "mcp", generation: principal.generation, batchId, sequence,
    journal: { from: head.journal_through, through: revision }, metadataMutations: [], ...content });
  const runtimeBatchId = crypto.randomUUID();
  const runtime = await uploadMcpContent(guarded, principal, {
    scope, batchId: runtimeBatchId, revision, value: { schemaVersion: 1, capturedAtMs: now,
      activeRequests: [], ingest: { accepted: sequence, rejected: 0, dropped: 0 }, tz: "UTC" },
  });
  await commitRuntime(guarded, principal, { ...scope, schemaVersion: 1, sourceDomain: "mcp",
    generation: principal.generation, batchId: runtimeBatchId, sequence, sourceCut: revision,
    capturedAtMs: now, ...runtime });
  return true;
}

export function recordMcpSearch(env: ContentEnv, context: McpContext, observation: McpSearchObservation) {
  return record(env, context, { kind: "search", traceId: observation.traceId, skillUri: null,
    data: observation });
}

/** Handler resolves modern app.skillar/traceId or legacy app.gisool/traceId into traceId. */
export function recordMcpRead(env: ContentEnv, context: McpContext, observation: McpReadObservation) {
  return record(env, context, { kind: observation.path === "SKILL.md" ? "load" : "read_file",
    traceId: observation.traceId ?? null, skillUri: observation.skillUri,
    manifestDigest: observation.manifestDigest, data: observation });
}
