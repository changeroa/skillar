import { randomUUID } from "node:crypto";
import { activeRequests, type Operation, type RequestStatus } from "../request-status.js";
import { mcpBase, type McpCallContext } from "./mcp-recorder.js";
import { makeEvent } from "./hooks.js";
import { ingest, type IngestDeps } from "./pipeline.js";

/** Request IDs correlate start, terminal outcome, and the existing detailed observations. */
export function beginRequest(deps: IngestDeps, ctx: McpCallContext, operation: Operation, uri?: string) {
  const requestId = randomUUID();
  const startedAt = deps.now?.() ?? Date.now();
  const base = mcpBase(ctx);
  const traceId = ctx.meta?.["app.skillar/traceId"] ?? ctx.meta?.["app.gisool/traceId"];
  let finished = false;
  const record = (status: RequestStatus, detail: Record<string, unknown> = {}) => {
    const event = makeEvent("skill_request", "mcp", base.ref, deps.now?.() ?? Date.now(), {
      ...(base.toolUseId ? { toolUseId: base.toolUseId } : {}),
      ...(typeof traceId === "string" ? { traceId } : {}), ...(uri ? { skillUri: uri } : {}),
      data: { ...base.data, requestId, operation, status, startedAt, ...(uri ? { uri } : {}), ...detail },
    });
    ingest(event, deps);
  };
  activeRequests.add(requestId);
  record("in_progress");
  const attempt = {
    requestId,
    finish(status: "succeeded" | "failed" | "cancelled" | "unknown", detail: Record<string, unknown> = {}) {
      if (finished) return;
      finished = true;
      ctx.signal?.removeEventListener("abort", onCancel);
      activeRequests.delete(requestId);
      record(status, detail);
    },
  };
  const onCancel = () => attempt.finish("cancelled");
  ctx.signal?.addEventListener("abort", onCancel, { once: true });
  if (ctx.signal?.aborted) onCancel();
  return attempt;
}
