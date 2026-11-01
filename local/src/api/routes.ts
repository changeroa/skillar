import type { Express, Request, Response } from "express";
import type { FsHealth } from "../fs-watchdog.js";
import { ingestOtlpTraces } from "../ingest/otlp-traces.js";
import { ingestHook, ingestOtlp, type IngestDeps } from "../ingest/pipeline.js";
import { isRuntimeId, RUNTIME_IDS } from "../ingest/runtimes.js";
import { catalogFingerprint, evaluateCases } from "../evaluation.js";
import type { AdoptionState, Catalog, EvalLabel, Filter, RuntimeId, SearchIndex, Store } from "../types.js";
import { registerWorkflowRoutes } from "../workflow/routes.js";
import { registerFlowRoutes } from "./flows.js";
import { deny } from "./security.js";
import type { SseHub } from "./sse.js";

const STATES: readonly AdoptionState[] = ["loaded", "exposed_only", "no_match", "aborted", "not_used"];
const EVAL_LABELS: readonly EvalLabel[] = ["unlabeled", "skill", "no_match"];
const CLIENT_ERROR_CODES = new Set(["invalid_tz", "bad_filter", "bad_request"]);

class BadRequest extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function one(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String).join(",");
  return String(value);
}

function intParam(q: Request["query"], key: string, range?: [number, number]): number | undefined {
  const raw = one(q[key]);
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || (range && (n < range[0] || n > range[1]))) throw new BadRequest("bad_filter", `${key} must be an integer${range ? ` in ${range[0]}..${range[1]}` : ""}`);
  return n;
}

function listParam<T extends string>(q: Request["query"], key: string, allowed?: readonly T[]): T[] | undefined {
  const raw = one(q[key]);
  if (raw === undefined || raw === "") return undefined;
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed) for (const item of items) if (!allowed.includes(item as T)) throw new BadRequest("bad_filter", `unknown ${key} value: ${item}`);
  return items as T[];
}

export function parseFilter(q: Request["query"]): Filter & { tz?: string } {
  const f: Filter & { tz?: string } = {};
  const from = intParam(q, "from");
  const to = intParam(q, "to");
  const runtime = listParam<RuntimeId>(q, "runtime", RUNTIME_IDS);
  const skill = listParam<string>(q, "skill");
  const state = listParam<AdoptionState>(q, "state", STATES);
  const dow = intParam(q, "dow", [0, 6]);
  const hour = intParam(q, "hour", [0, 23]);
  const hourSpan = intParam(q, "hourSpan", [1, 24]);
  const text = one(q.q)?.trim();
  const tz = one(q.tz);
  const automated = one(q.automated);
  if (automated !== undefined && automated !== "include" && automated !== "only") throw new BadRequest("bad_filter", "automated must be include or only");
  if (from !== undefined) f.from = from;
  if (to !== undefined) f.to = to;
  if (runtime) f.runtime = runtime;
  if (skill) f.skill = skill;
  if (state) f.state = state;
  if (dow !== undefined) f.dow = dow;
  if (hour !== undefined) f.hour = hour;
  if (hourSpan !== undefined) f.hourSpan = hourSpan;
  if (text) f.q = text;
  if (tz) f.tz = tz;
  if (automated) f.automated = automated;
  return f;
}

function defaultTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export type RouteDeps = {
  store: Store;
  catalog: Catalog;
  search: SearchIndex;
  ingest: IngestDeps;
  sse: SseHub;
  version: string;
  log: (msg: string) => void;
  fsHealth?: () => FsHealth;
};

function handle(log: (msg: string) => void, fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try {
      fn(req, res);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (error instanceof BadRequest || (typeof code === "string" && CLIENT_ERROR_CODES.has(code))) {
        return deny(res, 400, String(code), { message: (error as Error).message });
      }
      log(`${req.method} ${req.path} failed: ${(error as Error).stack ?? String(error)}`);
      deny(res, 500, "internal_error");
    }
  };
}

function evalCaseInput(body: Record<string, unknown>, catalog: Catalog, includeQuery: boolean): { query?: string; label: EvalLabel; expectedUri?: string; fromTraceId?: string } {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (includeQuery && !query) throw new BadRequest("bad_request", "query is required");
  for (const key of ["expectedUri", "fromTraceId"]) {
    if (body[key] !== undefined && typeof body[key] !== "string") throw new BadRequest("bad_request", `${key} must be a string`);
  }
  if (!includeQuery && body.fromTraceId !== undefined) throw new BadRequest("bad_request", "fromTraceId is set only when saving a query");
  if (body.label !== undefined && (typeof body.label !== "string" || !EVAL_LABELS.includes(body.label as EvalLabel))) {
    throw new BadRequest("bad_request", "label must be unlabeled, skill, or no_match");
  }
  const expectedUri = typeof body.expectedUri === "string" ? body.expectedUri : undefined;
  const label = (body.label as EvalLabel | undefined) ?? (expectedUri ? "skill" : "unlabeled");
  if (label === "skill") {
    if (!expectedUri) throw new BadRequest("bad_request", "skill labels require expectedUri");
    if (!catalog.get(expectedUri)) throw new BadRequest("bad_request", "expectedUri must name a current catalog skill");
  } else if (expectedUri !== undefined) {
    throw new BadRequest("bad_request", `${label} labels cannot have expectedUri`);
  }
  return { ...(includeQuery ? { query } : {}), label, ...(expectedUri ? { expectedUri } : {}),
    ...(typeof body.fromTraceId === "string" && includeQuery ? { fromTraceId: body.fromTraceId } : {}) };
}

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const { store, catalog, log } = deps;

  app.get("/healthz", (_req, res) => {
    const fs = deps.fsHealth?.() ?? { ok: true };
    res.status(fs.ok ? 200 : 503).json({ ok: fs.ok, version: deps.version, name: "skillar", fs });
  });

  app.post("/ingest/otlp/v1/logs", (req, res) => {
    const body: unknown = req.body;
    res.status(202).json({ partialSuccess: {} });
    queueMicrotask(() => {
      const result = ingestOtlp(body, deps.ingest);
      if (result.status !== 200) log(`otlp batch rejected: ${result.body.code}: ${result.body.message}`);
    });
  });

  app.post("/ingest/otlp/v1/traces", (req, res) => {
    const body: unknown = req.body;
    res.status(202).json({ partialSuccess: {} });
    queueMicrotask(() => {
      try {
        const result = ingestOtlpTraces(body, store, Date.now());
        if (result.status !== 200) log(`otlp traces batch rejected: ${result.body.code}: ${result.body.message}`);
      } catch (error) {
        // The batch is stored after the 202, so a store failure has nowhere to surface but the log, and an escaping throw would kill the daemon.
        log(`otlp traces batch failed: ${(error as Error).stack ?? String(error)}`);
      }
    });
  });

  app.post("/ingest/hook/:runtime", (req, res) => {
    const runtime = String(req.params.runtime);
    if (!isRuntimeId(runtime)) {
      store.countIngest("rejected", "unknown_runtime");
      return deny(res, 400, "unknown_runtime");
    }
    const body: unknown = req.body;
    res.status(202).json({ accepted: true });
    queueMicrotask(() => {
      ingestHook(runtime, body as Parameters<typeof ingestHook>[1], deps.ingest);
    });
  });

  app.get("/api/sessions", handle(log, (req, res) => {
    res.json(store.sessions(parseFilter(req.query)));
  }));

  app.get("/api/sessions/:id/trace", handle(log, (req, res) => {
    res.json(store.trace(String(req.params.id)));
  }));

  app.get("/api/flow", handle(log, (req, res) => {
    const unit = one(req.query.unit) ?? "first_load";
    if (unit !== "first_load" && unit !== "all_loads") throw new BadRequest("bad_request", "unit must be first_load or all_loads");
    const top = Math.min(15, intParam(req.query, "top", [1, 1000]) ?? 7);
    res.json(store.flow(parseFilter(req.query), unit, top));
  }));

  app.get("/api/heatmap", handle(log, (req, res) => {
    const filter = parseFilter(req.query);
    const tz = filter.tz ?? defaultTz();
    const weekStart = intParam(req.query, "weekStart", [0, 1]) ?? 1;
    const bucket = intParam(req.query, "bucket") ?? 1;
    if (bucket !== 1 && bucket !== 2 && bucket !== 4) throw new BadRequest("bad_request", "bucket must be 1, 2, or 4");
    res.json(store.heatmap(filter, tz, weekStart as 0 | 1, bucket));
  }));

  app.get("/api/skill-week", handle(log, (req, res) => {
    res.json(store.skillWeek(parseFilter(req.query)));
  }));

  app.get("/api/stats", handle(log, (req, res) => {
    res.json(store.stats(parseFilter(req.query)));
  }));

  app.get("/api/skills", handle(log, (_req, res) => {
    res.json(catalog.list());
  }));

  app.get("/api/eval-cases", handle(log, (_req, res) => {
    res.json(store.evaluationCases());
  }));

  app.post("/api/eval-cases", handle(log, (req, res) => {
    const input = evalCaseInput((req.body ?? {}) as Record<string, unknown>, catalog, true);
    res.status(201).json({ case: store.addEvalCase(input as { query: string; label: EvalLabel; expectedUri?: string; fromTraceId?: string }) });
  }));

  app.patch("/api/eval-cases/:id", handle(log, (req, res) => {
    const input = evalCaseInput((req.body ?? {}) as Record<string, unknown>, catalog, false);
    const row = store.updateEvalCase(String(req.params.id), { label: input.label, ...(input.expectedUri ? { expectedUri: input.expectedUri } : {}) });
    if (!row) return deny(res, 404, "not_found");
    res.json({ case: row });
  }));

  app.get("/api/evaluation", handle(log, (_req, res) => {
    res.json({ ...store.evaluationSummary(), currentCatalogFingerprint: catalogFingerprint(catalog.list()) });
  }));

  app.post("/api/evaluation/runs", handle(log, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.baseline !== undefined && typeof body.baseline !== "boolean") throw new BadRequest("bad_request", "baseline must be a boolean");
    const cases = store.evaluationCases();
    if (!cases.some((item) => item.label !== "unlabeled")) throw new BadRequest("bad_request", "label at least one evaluation case before running it");
    const evaluated = evaluateCases(cases, deps.search);
    const run = store.saveEvalRun({ catalogFingerprint: catalogFingerprint(catalog.list()), catalogSize: catalog.list().length,
      baseline: body.baseline === true, metrics: evaluated.metrics, outcomes: evaluated.outcomes });
    res.status(201).json({ run, ...store.evaluationSummary(), currentCatalogFingerprint: catalogFingerprint(catalog.list()) });
  }));

  app.get("/api/events/stream", (req, res) => deps.sse.handler(req, res));

  registerWorkflowRoutes(app, { store, log });
  registerFlowRoutes(app, { store, log });
}
