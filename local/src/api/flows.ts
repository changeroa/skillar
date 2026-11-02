import type { Express, Request, Response } from "express";
import type { AutomatedMode, Store } from "../types.js";
import {
  AnalysisReportError, buildFlows, buildFlowReport, buildSessionReport, buildSkillUsage,
} from "./report-kernel.js";
import { deny } from "./security.js";

export type FlowRouteDeps = { store: Store; log: (msg: string) => void };
export const WORKSPACE_PREFIX = "ws:";
const MAX_LIMIT = 100, DEFAULT_LIMIT = 20, MAX_DETAIL = 100, DEFAULT_DETAIL = 20;
const DAY_MS = 86_400_000, DEFAULT_RANGE_DAYS = 7, MAX_RANGE_DAYS = 366;
class BadQuery extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function handle(log: (msg: string) => void, fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try { fn(req, res); } catch (error) {
      if (error instanceof BadQuery) return deny(res, 400, error.code, { message: error.message });
      if (error instanceof AnalysisReportError) {
        const id = String(req.params.id);
        if (error.code === "flow_not_found") {
          return deny(res, 404, error.code, { message: `no flow or herdr workspace ${id}` });
        }
        if (error.code === "session_not_found") {
          return deny(res, 404, error.code, { message: `no session ${id}` });
        }
        return deny(res, 404, error.code, {
          message: automatedOf(req.query) === "only"
            ? `session ${id} was not automated; drop automated=only to read it`
            : `session ${id} was automated (${error.automated}); pass automated=include to read it`,
          automated: error.automated,
        });
      }
      log(`${req.method} ${req.path} failed: ${(error as Error).stack ?? String(error)}`);
      deny(res, 500, "internal_error");
    }
  };
}
function one(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.map(String).join(",") : String(value);
}
function intOf(q: Request["query"], key: string, range?: [number, number]): number | undefined {
  const raw = one(q[key]);
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || (range && (n < range[0] || n > range[1]))) {
    throw new BadQuery("bad_filter", `${key} must be an integer${range ? ` in ${range[0]}..${range[1]}` : ""}`);
  }
  return n;
}
function automatedOf(q: Request["query"]): AutomatedMode {
  const raw = one(q.automated);
  if (raw === undefined || raw === "") return "exclude";
  if (raw !== "include" && raw !== "only") throw new BadQuery("bad_filter", "automated must be include or only");
  return raw;
}
function rangeOf(q: Request["query"], now: number) {
  const to = intOf(q, "to") ?? now, from = intOf(q, "from") ?? to - DEFAULT_RANGE_DAYS * DAY_MS;
  if (from > to) throw new BadQuery("bad_filter", "from must not be after to");
  if (to - from > MAX_RANGE_DAYS * DAY_MS) throw new BadQuery("bad_filter", `the range must not exceed ${MAX_RANGE_DAYS} days`);
  return { from, to };
}
function decodeCursor(raw: string | undefined): { orderMs: number; id: string } | undefined {
  if (raw === undefined || raw === "") return undefined;
  const text = Buffer.from(raw, "base64url").toString("utf8"), cut = text.indexOf(":");
  const orderMs = cut > 0 ? Number(text.slice(0, cut)) : Number.NaN, id = cut > 0 ? text.slice(cut + 1) : "";
  if (!Number.isInteger(orderMs) || id === "") throw new BadQuery("bad_cursor", "cursor is not one this endpoint issued");
  return { orderMs, id };
}
/** SQLite and the cloud use the same report DTO assembly over their read adapters. */
export function registerFlowRoutes(app: Express, { store, log }: FlowRouteDeps): void {
  app.get("/api/flows", handle(log, (req, res) => {
    const automated = automatedOf(req.query), limit = intOf(req.query, "limit", [1, MAX_LIMIT]) ?? DEFAULT_LIMIT;
    const from = intOf(req.query, "from"), to = intOf(req.query, "to");
    if (from !== undefined && to !== undefined && from > to) throw new BadQuery("bad_filter", "from must not be after to");
    const cursor = decodeCursor(one(req.query.cursor));
    res.json(buildFlows(store, {
      automated, limit, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }),
      ...(cursor === undefined ? {} : { cursor }),
    }, Date.now()));
  }));
  app.get("/api/flows/:id", handle(log, (req, res) => {
    const ref = String(req.params.id), automated = automatedOf(req.query);
    const from = ref === "outside" ? intOf(req.query, "from") : undefined;
    const to = ref === "outside" ? intOf(req.query, "to") : undefined;
    if (ref === "outside" && (from ?? (to ?? Date.now() + 1) - DEFAULT_RANGE_DAYS * DAY_MS) > (to ?? Date.now() + 1)) {
      throw new BadQuery("bad_filter", "from must not be after to");
    }
    const limit = ref === "outside" ? intOf(req.query, "limit", [1, MAX_LIMIT]) : undefined;
    res.json(buildFlowReport(store, ref, {
      automated, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }),
      ...(limit === undefined ? {} : { limit }),
    }, Date.now()));
  }));
  app.get("/api/sessions/:id/skill-report", handle(log, (req, res) => {
    res.json(buildSessionReport(store, String(req.params.id), automatedOf(req.query), Date.now()));
  }));
  app.get("/api/skills/usage", handle(log, (req, res) => {
    const automated = automatedOf(req.query), { from, to } = rangeOf(req.query, Date.now());
    const detailLimit = intOf(req.query, "detail", [0, MAX_DETAIL]) ?? DEFAULT_DETAIL;
    res.json(buildSkillUsage(store, { from, to, detailLimit, automated }, Date.now()));
  }));
}
