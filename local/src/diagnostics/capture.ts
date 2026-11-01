import { randomUUID } from "node:crypto";
import type { IngestChange } from "../ingest/pipeline.js";
import type { Db } from "../store/db.js";
import type { CanonicalEvent, HookPayload, RuntimeId } from "../types.js";

export const CAPTURE_RUNTIMES = ["claude-code", "codex", "gemini", "cursor", "omo", "gajae", "openclaw"] as const;
export type CaptureRuntime = (typeof CAPTURE_RUNTIMES)[number];
export type CaptureStage = "transport" | "authentication" | "storage" | "attribution";
export type CaptureCheck = { stage: CaptureStage; status: "passed" | "failed" | "not_run"; code?: string };
export type CaptureProbeReport = {
  id: string; runtime: CaptureRuntime; scope: "daemon_ingest"; startedAt: number; completedAt: number;
  ok: boolean; checks: CaptureCheck[];
};
export type CaptureRuntimeHealth = {
  runtime: RuntimeId; lastEventAt: number | null;
  sources: { hook: number; otel: number; mcp: number };
  mcpAttributionRate: number | null;
  unattributedReasons: { no_session: number; ambiguous: number; stale: number; unreported: number };
  lastProbe: CaptureProbeReport | null;
};
export type CaptureHealth = { generatedAt: number; scope: "all_history"; runtimes: CaptureRuntimeHealth[] };
export type CaptureDiagnostics = {
  health(): CaptureHealth;
  run(runtime: CaptureRuntime): Promise<CaptureProbeReport>;
  isProbe(event: CanonicalEvent): boolean;
  observe(change: IngestChange): boolean;
  close(): void;
};

/** The same raw payload shapes that the installed runtime forwarders submit. No user prompt is reused. */
export function captureProbePayload(runtime: CaptureRuntime, id: string): HookPayload {
  const prompt = "Skillar capture diagnostic";
  switch (runtime) {
    case "claude-code":
    case "codex": return { hook_event_name: "UserPromptSubmit", session_id: id, prompt };
    case "gemini": return { hook_event_name: "BeforeAgent", session_id: id, prompt };
    case "cursor": return { hook_event_name: "beforeSubmitPrompt", conversation_id: id, prompt };
    case "omo":
    case "gajae": return { event: "before_agent_start", sessionId: id, prompt };
    case "openclaw": return { event: "before_agent_run", sessionId: id, sessionKey: id, prompt };
  }
}

type Pending = { runtime: CaptureRuntime; resolve(change?: IngestChange): void; controller: AbortController; eventIds: Set<string> };
type CaptureOptions = {
  post(runtime: CaptureRuntime, payload: HookPayload, signal: AbortSignal): Promise<{ status: number }>;
  now?: () => number;
  timeoutMs?: number;
};

/**
 * Probes the real authenticated HTTP ingest route, subscribes before sending, then verifies the committed rows.
 * Only this process's in-flight random IDs are diagnostic; a caller cannot suppress ordinary capture with a prefix.
 */
export function createCaptureDiagnostics(db: Db, options: CaptureOptions): CaptureDiagnostics {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 2500;
  const pending = new Map<string, Pending>();
  const running = new Map<CaptureRuntime, Promise<CaptureProbeReport>>();
  let closed = false;

  const probeKey = (event: CanonicalEvent) => event.ref.runtimeSessionId ?? event.ref.conversationId;
  const isProbe = (event: CanonicalEvent) => {
    const key = probeKey(event);
    return event.source === "hook" && key !== undefined && pending.get(key)?.runtime === event.ref.runtime;
  };

  function removeProbe(runtime: CaptureRuntime, id: string): void {
    const sessions = db.prepare(`SELECT id FROM sessions WHERE runtime = ?
      AND (runtime_session_id = ? OR conversation_id = ?)`).all(runtime, id, id) as { id: string }[];
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const eventId of pending.get(id)?.eventIds ?? []) db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
      for (const session of sessions) {
        db.prepare("DELETE FROM pane_sessions WHERE session_id = ?").run(session.id);
        db.prepare("DELETE FROM load_candidates WHERE session_id = ?").run(session.id);
        db.prepare("DELETE FROM events WHERE session_id = ?").run(session.id);
        db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async function runProbe(runtime: CaptureRuntime): Promise<CaptureProbeReport> {
    const id = `skillar-capture-${randomUUID()}`;
    const startedAt = now();
    const checks: CaptureCheck[] = (["transport", "authentication", "storage", "attribution"] as const)
      .map((stage) => ({ stage, status: "not_run" }));
    let receive!: (change?: IngestChange) => void;
    const observation = new Promise<IngestChange | undefined>((resolve) => { receive = resolve; });
    const controller = new AbortController();
    pending.set(id, { runtime, resolve: receive, controller, eventIds: new Set() });
    const timer = setTimeout(() => receive(), timeoutMs);
    try {
      let response: { status: number };
      try {
        response = await options.post(runtime, captureProbePayload(runtime, id),
          AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]));
      } catch {
        checks[0] = { stage: "transport", status: "failed", code: "capture_unreachable" };
        return finish();
      }
      checks[0] = { stage: "transport", status: "passed" };
      if (response.status === 401 || response.status === 403) {
        checks[1] = { stage: "authentication", status: "failed", code: "capture_unauthorized" };
        return finish();
      }
      checks[1] = { stage: "authentication", status: "passed" };
      if (response.status !== 202) {
        checks[2] = { stage: "storage", status: "failed", code: `capture_http_${response.status}` };
        return finish();
      }
      const change = await observation;
      const row = change?.event ? db.prepare(`SELECT e.session_id, e.attribution_method, s.runtime,
        s.runtime_session_id, s.conversation_id FROM events e LEFT JOIN sessions s ON s.id = e.session_id
        WHERE e.id = ? AND e.kind = 'prompt' AND e.source = 'hook'`).get(change.event.id) as
        { session_id: string; attribution_method: string; runtime: string | null; runtime_session_id: string | null; conversation_id: string | null } | undefined : undefined;
      if (!row) {
        checks[2] = { stage: "storage", status: "failed", code: "capture_not_stored" };
        return finish();
      }
      checks[2] = { stage: "storage", status: "passed" };
      const attributed = row.session_id !== "unattributed" && row.attribution_method === "runtime_id"
        && row.runtime === runtime && (row.runtime_session_id === id || row.conversation_id === id);
      checks[3] = { stage: "attribution", status: attributed ? "passed" : "failed",
        ...(!attributed ? { code: "capture_not_attributed" } : {}) };
      return finish();
    } finally {
      clearTimeout(timer);
      if (!closed) removeProbe(runtime, id);
      pending.delete(id);
    }

    function finish(): CaptureProbeReport {
      const report: CaptureProbeReport = { id, runtime, scope: "daemon_ingest", startedAt, completedAt: now(),
        ok: checks.every((check) => check.status === "passed"), checks };
      if (!closed) db.prepare(`INSERT INTO meta(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(`capture.probe.${runtime}`, JSON.stringify(report));
      return report;
    }
  }

  return {
    isProbe,
    observe(change) {
      if (!change.event || !isProbe(change.event)) return false;
      const key = probeKey(change.event)!;
      pending.get(key)!.eventIds.add(change.event.id);
      if (change.event.kind === "prompt") {
        // A probe must never become a recent open-session candidate for real MCP calls.
        db.prepare("UPDATE sessions SET ended_at = started_at WHERE id = ?").run(change.sessionId);
        pending.get(key)!.resolve(change);
      }
      return true;
    },
    run(runtime) {
      if (closed) return Promise.reject(new Error("capture diagnostics closed"));
      const current = running.get(runtime);
      if (current) return current;
      const result = runProbe(runtime).finally(() => running.delete(runtime));
      running.set(runtime, result);
      return result;
    },
    health() {
      const byRuntime = new Map<RuntimeId, CaptureRuntimeHealth>();
      const rowFor = (runtime: RuntimeId) => {
        let row = byRuntime.get(runtime);
        if (!row) {
          const probe = db.prepare("SELECT value FROM meta WHERE key = ?").get(`capture.probe.${runtime}`) as { value: string } | undefined;
          row = { runtime, lastEventAt: null, sources: { hook: 0, otel: 0, mcp: 0 }, mcpAttributionRate: null,
            unattributedReasons: { no_session: 0, ambiguous: 0, stale: 0, unreported: 0 },
            lastProbe: probe ? JSON.parse(probe.value) as CaptureProbeReport : null };
          byRuntime.set(runtime, row);
        }
        return row;
      };
      for (const runtime of CAPTURE_RUNTIMES) rowFor(runtime);
      const counts = db.prepare(`SELECT runtime, source, COUNT(*) AS total, MAX(ts) AS last,
        SUM(CASE WHEN session_id <> 'unattributed' THEN 1 ELSE 0 END) AS attributed
        FROM events GROUP BY runtime, source`).all() as
        { runtime: RuntimeId; source: "hook" | "otel" | "mcp"; total: number; last: number; attributed: number }[];
      for (const count of counts) {
        const row = rowFor(count.runtime);
        row.sources[count.source] = count.total;
        row.lastEventAt = Math.max(row.lastEventAt ?? count.last, count.last);
        if (count.source === "mcp") row.mcpAttributionRate = count.attributed / count.total;
      }
      const reasons = db.prepare(`SELECT runtime, attribution_reason AS reason, COUNT(*) AS n FROM events
        WHERE source = 'mcp' AND session_id = 'unattributed' GROUP BY runtime, attribution_reason`).all() as
        { runtime: RuntimeId; reason: string | null; n: number }[];
      for (const reason of reasons) {
        const key = reason.reason === "no_session" || reason.reason === "ambiguous" || reason.reason === "stale" ? reason.reason : "unreported";
        rowFor(reason.runtime).unattributedReasons[key] += reason.n;
      }
      return { generatedAt: now(), scope: "all_history", runtimes: [...byRuntime.values()] };
    },
    close() {
      closed = true;
      for (const [id, probe] of pending) {
        probe.controller.abort();
        probe.resolve();
        removeProbe(probe.runtime, id);
      }
      pending.clear();
    },
  };
}
