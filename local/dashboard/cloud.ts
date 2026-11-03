import { z } from "zod";
import {
  dashboardPaths, dashboardSourceSchema, dashboardReportStatusSchema, dashboardEvalReceiptSchema,
  type DashboardSource, type DashboardReportStatus,
} from "../../shared/activity-dashboard";
import { eventLeaseSchema, eventPaths, replaySchema } from "../../shared/activity-events";
import type { ActivityQuery } from "../../shared/activity-query";
import type { Filter } from "../src/types.js";
import { ApiError, type Api, type EventHandlers, type LiveState, type SessionListRow } from "./api";
import { createCloudLive, type CloudLiveOptions } from "./cloud-events";
import { cloudError, readCloudReport } from "./cloud-report";

export type CloudApiOptions = {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly onReport?: (report: DashboardReportStatus) => void;
  readonly onUnauthorized: () => void;
  readonly tz?: string;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  readonly timeoutMs?: number;
  /** Injectable scheduler for deterministic polling; must honor cancellation. */
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** Enables WebSocket-first live invalidations with SSE fallback; absent keeps the snapshot-only adapter. */
  readonly live?: CloudLiveOptions;
};
export type CloudApi = Api & { dispose(): void; refresh(): void };
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** One adapter owns one profile lifetime; replace it rather than mutating its profile. */
export function createCloudApi(input: DashboardSource, options: CloudApiOptions): CloudApi {
  const profile = dashboardSourceSchema.parse(input);
  const lifetime = new AbortController();
  const handlers = new Set<EventHandlers>();
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const maxPolls = options.maxPolls ?? 120;
  const interval = options.pollIntervalMs ?? 1000;
  const timeout = options.timeoutMs ?? 180_000;
  if (!Number.isInteger(maxPolls) || maxPolls < 0 || !Number.isFinite(interval) || interval < 0 ||
      !Number.isFinite(timeout) || timeout <= 0) throw cloudError("cloud_options", "Invalid cloud polling options.");
  let unauthorized = false;
  let liveState: LiveState = "connecting";
  let snapshot: { readonly filter: Filter; readonly rows: readonly SessionListRow[] } | undefined;
  const live = options.live === undefined ? undefined : createCloudLive({
    changes: (since, signal) => run(async (post) => replaySchema.parse(
      await post(since === null ? eventPaths.changes : `${eventPaths.changes}?since=${since}`)), signal),
    lease: (connectionId, signal) => run(async (post) =>
      eventLeaseSchema.parse(await post(eventPaths.lease, { connectionId })).expiresAtMs, signal),
    sessions: requerySessions,
  }, {
    onState: (state) => {
      liveState = state;
      for (const listener of handlers) listener.onState?.(state);
    },
    onSession: (row) => { for (const listener of handlers) listener.onSession?.(row); },
    onRefresh: () => { for (const listener of handlers) listener.onRefresh?.(); },
  }, options.live);
  const invalidate = () => {
    options.signal?.removeEventListener("abort", externalAbort);
    lifetime.abort();
    live?.stop();
    for (const listener of handlers) listener.onInvalidate?.();
    handlers.clear();
  };
  const externalAbort = () => invalidate();
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  if (options.signal?.aborted) invalidate();
  async function run<T>(
    action: (post: (path: string, body?: object) => Promise<unknown>, signal: AbortSignal) => Promise<T>, extra?: AbortSignal,
  ): Promise<T> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeout);
    const signal = AbortSignal.any([lifetime.signal, deadline.signal, ...(extra === undefined ? [] : [extra])]);
    async function post(path: string, body?: object): Promise<unknown> {
      signal.throwIfAborted();
      const response = await fetcher(path, {
        method: body === undefined ? "GET" : "POST", credentials: "same-origin", mode: "same-origin", cache: "no-store",
        redirect: "error", signal, headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        if (!unauthorized) {
          unauthorized = true;
          invalidate();
          options.onUnauthorized();
        }
        throw new ApiError(401, "cloud_unauthorized", "Sign in to your cloud account again to view activity.");
      }
      signal.throwIfAborted();
      if (!response.ok) throw new ApiError(response.status, `cloud_http_${response.status}`,
        response.status >= 500 ? "The cloud report service is temporarily unavailable. Try again later." :
        response.status === 403 ? "This device or its consent no longer permits the report. Reload sources and review its consent." :
        "The cloud dashboard request could not be completed. Reload sources and try again.");
      const value: unknown = await response.json();
      signal.throwIfAborted();
      return value;
    }
    try {
      signal.throwIfAborted();
      const result = await action(post, signal);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal.aborted) {
        if (unauthorized) throw new ApiError(401, "cloud_unauthorized", "Sign in to your cloud account again to view activity.");
        if (lifetime.signal.aborted || extra?.aborted) throw new DOMException("Cloud dashboard request cancelled.", "AbortError");
        throw cloudError("cloud_timeout", "The cloud report timed out. Refresh to retry.");
      }
      throw cloudError("cloud_report", "The cloud report could not be read. Check your cloud connection and retry.");
    } finally {
      clearTimeout(timer);
    }
  }
  /** Live invalidations name no sessions: the last subscribed filter is requeried and diffed row by row. */
  async function requerySessions(signal: AbortSignal): Promise<readonly SessionListRow[]> {
    const filter = snapshot?.filter ?? {};
    const previous = new Map((snapshot?.rows ?? []).map((row) => [row.id, JSON.stringify(row)]));
    const rows = await query<SessionListRow[]>({ kind: "sessions", filter }, signal);
    snapshot = { filter, rows };
    return rows.filter((row) => previous.get(row.id) !== JSON.stringify(row));
  }
  function query<T>(query: ActivityQuery, extra?: AbortSignal): Promise<T> {
    return run(async (post, signal) => {
      let status = dashboardReportStatusSchema.parse(await post(dashboardPaths.query, {
        profile, requestId: crypto.randomUUID(), query, tz: options.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      }));
      const jobId = status.jobId;
      let polls = 0;
      for (;;) {
        if (status.jobId !== jobId) throw cloudError("cloud_integrity", "Cloud report identity changed.");
        signal.throwIfAborted();
        options.onReport?.(status);
        signal.throwIfAborted();
        switch (status.state) {
          case "failed": throw cloudError(status.error ?? "cloud_failed", "The cloud report failed. Check source availability and retry.");
          case "complete":
            if (status.pending) throw cloudError("cloud_integrity", "Invalid cloud report completion.");
            return readCloudReport<T>(status, (part) => post(dashboardPaths.reportResult, { profile, jobId, part }), signal);
          case "preparing": case "queued": case "running":
            if (polls++ >= maxPolls) throw cloudError("cloud_pending", "The cloud report is still pending. Refresh to retry.");
            await (options.wait ?? wait)(interval, signal);
            signal.throwIfAborted();
            status = dashboardReportStatusSchema.parse(await post(dashboardPaths.reportStatus, { profile, jobId }));
            break;
          default: {
            const exhaustive: never = status.state;
            return exhaustive;
          }
        }
      }
    }, extra);
  }
  return {
    mode: "cloud",
    sessions: async (filter) => {
      const rows = await query<SessionListRow[]>({ kind: "sessions", filter });
      snapshot = { filter, rows };
      return rows;
    },
    trace: (sessionId) => query({ kind: "trace", sessionId }),
    flow: (filter, opts = {}) => query({ kind: "flow", filter, unit: opts.unit ?? "first_load", top: opts.top ?? 20 }),
    flows: (opts = {}) => query({ kind: "flows", ...opts, limit: opts.limit ?? 20, automated: opts.automated ?? "exclude" }),
    flowReport: (flowId, opts = {}) => query({ kind: "flow-report", flowId, ...opts, limit: opts.limit ?? 100, automated: opts.automated ?? "exclude" }),
    workflowVersions: (name) => query({ kind: "workflow-versions", name }),
    skillReport: (sessionId, opts = {}) => query({ kind: "session-report", sessionId, automated: opts.automated ?? "exclude" }),
    heatmap: (filter, opts = {}) => query({
      kind: "heatmap", filter, tz: opts.tz ?? options.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      weekStart: opts.weekStart ?? 1, bucketHours: opts.bucket ?? 1,
    }),
    skillWeek: (filter) => query({ kind: "skill-week", filter }),
    stats: (filter = {}) => query({ kind: "stats", filter }),
    skills: () => query({ kind: "skills" }),
    addEvalCase: (input) => run(async (post) => {
      dashboardEvalReceiptSchema.parse(await post(dashboardPaths.evalCases, { profile, requestId: crypto.randomUUID(), input }));
    }),
    health: () => run(async (post) => {
      return z.object({ ok: z.boolean(), version: z.string(), transport: z.enum(["snapshot", "live"]) })
        .parse(await post(dashboardPaths.status));
    }),
    events(listener) {
      if (lifetime.signal.aborted) { listener.onInvalidate?.(); return () => undefined; }
      handlers.add(listener);
      if (live === undefined) listener.onState?.("offline");
      else if (handlers.size === 1) live.start();
      else listener.onState?.(liveState);
      return () => {
        handlers.delete(listener);
        if (handlers.size === 0) live?.stop();
      };
    },
    refresh() {
      lifetime.signal.throwIfAborted();
      for (const listener of handlers) listener.onRefresh?.();
    },
    dispose() {
      options.signal?.removeEventListener("abort", externalAbort);
      invalidate();
    },
  };
}
