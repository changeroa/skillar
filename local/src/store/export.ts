import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_ROOTS, expandHome } from "../config.js";
import { parseJson, readAliasesOverrides, storeError, writeAliasesOverrides, type StoreCtx } from "./writes.js";
import type { EvalLabel, EvalMetrics, Store } from "../types.js";

export const EXPORT_FILE = "skillar-export.json";
export const HISTORY_FILE = "history.db";
/**
 * Tables that export --with-history carries, in foreign-key order, each with the columns identifying a row.
 * A table or column missing on either side (importing a v1 history.db into a v2 store) is simply not copied.
 */
const HISTORY_TABLES: Record<string, string[]> = {
  sessions: ["id"],
  events: ["id"],
  loads: ["load_id"],
  otel_spans: ["trace_id", "span_id"],
  herdr_workspaces: ["id"],
  herdr_tabs: ["id"],
  herdr_panes: ["id"],
  pane_sessions: ["pane_id", "agent_session_value"],
  workflow_specs: ["id"],
  flows: ["id"],
  flow_steps: ["flow_id", "pane_id"],
};
// recording_clock is deliberately local. Row provenance and flow cuts travel
// through shared columns; insert triggers add destination arrival provenance.
// v7 adds local CDC/outbox state, v8 adds connector command receipts, and v9 adds search evaluations.
// None add portable history tables. Never import receipts, spool, source identity, or local evaluations through history.
const HISTORY_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

type ExportedEvalCase = { id?: string; query: string; label?: EvalLabel; expectedUri?: string; fromTraceId?: string };
type ExportedEvalRun = { id: string; catalogFingerprint: string; catalogSize: number; createdAt: number; baseline: boolean; metrics: EvalMetrics;
  outcomes: { evalCaseId: string; query: string; label: Exclude<EvalLabel, "unlabeled">; expectedUri?: string; language: "ko" | "en" | "other"; rank?: number; abstained: boolean }[] };
export type ExportDoc = { version: 1; config: Record<string, unknown>; roots: { id: string; path: string }[]; evalCases: ExportedEvalCase[];
  evaluationRuns?: ExportedEvalRun[]; aliasesOverrides: Record<string, string[]> };

export type ImportDetails = {
  evalCases: { added: number; skipped: number };
  evaluationRuns: { added: number; skipped: number };
  roots: { added: string[]; skipped: string[] };
  configKeys: { added: string[]; kept: string[] };
  aliases: { added: string[]; skipped: string[] };
  history: { tables: Record<string, number>; skipped: number } | null;
};
export type ImportResult = { added: number; skipped: number; details: ImportDetails };

function tildify(path: string, home: string): string {
  const h = home.replace(/\/+$/, "");
  if (path === h) return "~";
  if (path.startsWith(h + "/")) return "~/" + path.slice(h.length + 1);
  return path;
}

function readConfigFile(skillarHome: string | undefined): Record<string, unknown> | undefined {
  if (!skillarHome) return undefined;
  const p = join(skillarHome, "config.json");
  return existsSync(p) ? parseJson<Record<string, unknown>>(readFileSync(p, "utf8"), {}) : undefined;
}

type Portable = Pick<Store, "exportTo"> & { importFrom(dir: string, opts: { merge: boolean }): ImportResult };

export function createPortable(ctx: StoreCtx): Portable {
  const { db } = ctx;
  const home = () => ctx.opts.home ?? homedir();

  function evalLabelOf(c: ExportedEvalCase): EvalLabel {
    if (c.label === "unlabeled" || c.label === "skill" || c.label === "no_match") return c.label;
    return c.expectedUri ? "skill" : "unlabeled";
  }

  function evalKey(query: string, label: EvalLabel, expectedUri?: string): string {
    return JSON.stringify([query, label, expectedUri ?? null]);
  }

  function existingEvalRows(): { id: string; query: string; label: EvalLabel; expectedUri?: string }[] {
    const rows = db.prepare("SELECT id, query, label, expected_uri FROM eval_cases").all() as
      { id: string; query: string; label: EvalLabel; expected_uri: string | null }[];
    return rows.map((row) => ({ id: row.id, query: row.query, label: row.label, ...(row.expected_uri ? { expectedUri: row.expected_uri } : {}) }));
  }

  function columnsOf(schema: "main" | "hist", table: string): string[] {
    return (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  }

  function historyShape(): { table: string; key: string[]; columns: string[] }[] {
    const shape: { table: string; key: string[]; columns: string[] }[] = [];
    for (const [table, key] of Object.entries(HISTORY_TABLES)) {
      const mine = new Set(columnsOf("main", table));
      const columns = columnsOf("hist", table).filter((c) => mine.has(c));
      if (key.every((k) => columns.includes(k))) shape.push({ table, key, columns });
    }
    return shape;
  }

  const keyIn = (table: string, key: string[]) =>
    `${key.length === 1 ? key[0]! : `(${key.join(", ")})`} IN (SELECT ${key.join(", ")} FROM main.${table})`;

  /**
   * A history row the destination already holds: the same primary key, the same agent record stored under another event
   * id (source_key), or the same workflow spec version registered there independently.
   */
  function present(table: string, key: string[], columns: string[]): string {
    if (table === "events" && columns.includes("source_key")) {
      return `(${keyIn(table, key)} OR (source_key IS NOT NULL AND source_key IN (SELECT source_key FROM main.events WHERE source_key IS NOT NULL)))`;
    }
    if (table === "workflow_specs") return `(${keyIn(table, key)} OR (name, version) IN (SELECT name, version FROM main.workflow_specs))`;
    return keyIn(table, key);
  }

  /** Two different bodies under one spec name and version cannot both be kept, and picking one would rewrite flows. */
  function refuseSpecConflicts(shape: { table: string }[]): void {
    if (!shape.some((s) => s.table === "workflow_specs")) return;
    const clash = db.prepare(`SELECT h.name, h.version FROM hist.workflow_specs h JOIN main.workflow_specs m
      ON m.name = h.name AND m.version = h.version WHERE m.digest <> h.digest ORDER BY h.name, h.version LIMIT 1`).get() as
      { name: string; version: number } | undefined;
    if (clash) {
      throw storeError("history_spec_conflict", `workflow spec ${clash.name} v${clash.version} differs between this store and the history`);
    }
  }

  function historyPlan(): { tables: Record<string, number>; skipped: number } {
    const tables: Record<string, number> = {};
    let skipped = 0;
    const shape = historyShape();
    refuseSpecConflicts(shape);
    for (const { table, key, columns } of shape) {
      const row = db.prepare(`SELECT SUM(CASE WHEN ${present(table, key, columns)} THEN 0 ELSE 1 END) AS fresh, COUNT(*) AS total FROM hist.${table}`).get() as
        { fresh: number | null; total: number };
      tables[table] = row.fresh ?? 0;
      skipped += row.total - (row.fresh ?? 0);
    }
    return { tables, skipped };
  }

  function copyHistory(): void {
    for (const { table, key, columns } of historyShape()) {
      const cols = columns.join(", ");
      // A flow follows its spec to the id the destination keeps for that name and version.
      const values = columns.map((c) => table === "flows" && c === "spec_id"
        ? `COALESCE((SELECT m.id FROM main.workflow_specs m JOIN hist.workflow_specs h ON h.name = m.name AND h.version = m.version
            WHERE h.id = src.spec_id), src.spec_id)`
        : `src.${c}`).join(", ");
      db.prepare(`INSERT INTO main.${table} (${cols}) SELECT ${values} FROM hist.${table} AS src WHERE NOT ${present(table, key, columns)}`).run();
      // Legacy loads have no snapshot: insert triggers may run before later-received activity rows.
      // Complete their candidate index once the whole events table is available, not on report reads.
      if (table === "events") db.exec(`INSERT OR IGNORE INTO load_candidates
        SELECT * FROM load_candidate_rows WHERE load_id IN (SELECT id FROM hist.events)`);
    }
    // Restoring newer history into an older backup of the SAME lineage must also
    // advance past deleted observations. Never adopt another database's domain.
    if (columnsOf("hist", "recording_clock").includes("position")) db.exec(`UPDATE recording_clock
      SET position = MAX(position, COALESCE((SELECT h.position FROM hist.recording_clock h
        WHERE h.domain = recording_clock.domain AND h.singleton = 1), 0)) WHERE singleton = 1`);
  }

  return {
    exportTo(dir: string, opts: { withHistory: boolean }): void {
      mkdirSync(dir, { recursive: true });
      const raw = readConfigFile(ctx.opts.skillarHome);
      const source: Record<string, unknown> = raw ?? (ctx.opts.config ? { ...ctx.opts.config } : {});
      const { token: _token, roots: rawRoots, ...config } = source;
      void _token;
      const roots = (Array.isArray(rawRoots) ? (rawRoots as { id: string; path: string }[]) : [])
        .map((r) => ({ id: r.id, path: tildify(r.path, home()) }));
      const evalRows = db.prepare("SELECT id, query, label, expected_uri, from_trace_id FROM eval_cases ORDER BY created_at, rowid").all() as
        { id: string; query: string; label: EvalLabel; expected_uri: string | null; from_trace_id: string | null }[];
      const evalCases = evalRows.map((r) => ({ id: r.id, query: r.query, label: r.label, ...(r.expected_uri !== null ? { expectedUri: r.expected_uri } : {}),
        ...(r.from_trace_id !== null ? { fromTraceId: r.from_trace_id } : {}) }));
      const outcomeRows = db.prepare(`SELECT r.id AS run_id, r.catalog_fingerprint, r.catalog_size, r.created_at, r.baseline, r.metrics_json,
          x.eval_case_id, c.query, x.label, x.expected_uri, x.language, x.rank, x.abstained
        FROM eval_runs r LEFT JOIN eval_run_cases x ON x.run_id = r.id LEFT JOIN eval_cases c ON c.id = x.eval_case_id
        ORDER BY r.created_at, r.rowid, c.created_at, c.rowid`).all() as { run_id: string; catalog_fingerprint: string; catalog_size: number;
          created_at: number; baseline: number; metrics_json: string; eval_case_id: string | null; query: string | null; label: Exclude<EvalLabel, "unlabeled"> | null;
          expected_uri: string | null; language: "ko" | "en" | "other" | null; rank: number | null; abstained: number | null }[];
      const runs = new Map<string, ExportedEvalRun>();
      for (const row of outcomeRows) {
        let run = runs.get(row.run_id);
        if (!run) {
          run = { id: row.run_id, catalogFingerprint: row.catalog_fingerprint, catalogSize: row.catalog_size, createdAt: row.created_at,
            baseline: row.baseline === 1, metrics: parseJson<EvalMetrics>(row.metrics_json, {} as EvalMetrics), outcomes: [] };
          runs.set(row.run_id, run);
        }
        if (row.eval_case_id !== null && row.query !== null && row.label !== null && row.language !== null && row.abstained !== null) {
          run.outcomes.push({ evalCaseId: row.eval_case_id, query: row.query, label: row.label, ...(row.expected_uri ? { expectedUri: row.expected_uri } : {}), language: row.language,
            ...(row.rank !== null ? { rank: row.rank } : {}), abstained: row.abstained === 1 });
        }
      }
      const doc: ExportDoc = {
        version: 1,
        config,
        roots,
        evalCases,
        evaluationRuns: [...runs.values()],
        aliasesOverrides: readAliasesOverrides(db),
      };
      const out = join(dir, EXPORT_FILE);
      writeFileSync(out, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
      chmodSync(out, 0o600);
      const history = join(dir, HISTORY_FILE);
      rmSync(history, { force: true });
      if (opts.withHistory) {
        const temporary = mkdtempSync(join(dir, ".history-"));
        try {
          const snapshot = join(temporary, HISTORY_FILE);
          db.prepare("VACUUM INTO ?").run(resolve(snapshot));
          const portable = new DatabaseSync(snapshot);
          try {
            // Source-local replay results must not enter the portable artifact,
            // including free pages. Keep the live source receipts intact.
            portable.exec("PRAGMA secure_delete=ON; DELETE FROM connector_command_receipts; VACUUM;");
          } finally {
            portable.close();
          }
          chmodSync(snapshot, 0o600);
          renameSync(snapshot, history);
        } finally {
          rmSync(temporary, { recursive: true, force: true });
        }
      }
    },

    importFrom(dir: string, opts: { merge: boolean }): ImportResult {
      const file = existsSync(join(dir, EXPORT_FILE)) ? join(dir, EXPORT_FILE) : join(dir, "gisool-export.json");
      if (!existsSync(file)) throw storeError("no_export_found", `no ${EXPORT_FILE} in ${dir}`);
      const doc = parseJson<Partial<ExportDoc> & { version?: unknown }>(readFileSync(file, "utf8"), {});
      if (doc.version !== 1) throw storeError("unsupported_export_version", `unsupported export version: ${String(doc.version)}`);
      const apply = opts.merge;

      const existingCases = existingEvalRows();
      const casesById = new Map(existingCases.map((row) => [row.id, row]));
      const sourceCaseIds = new Set<string>();
      const evalKeys = new Set(existingCases.map((row) => evalKey(row.query, row.label, row.expectedUri)));
      const evalToAdd: (ExportedEvalCase & { label: EvalLabel })[] = [];
      let evalSkipped = 0;
      for (const raw of doc.evalCases ?? []) {
        if (typeof raw.query !== "string" || !raw.query) throw storeError("invalid_eval_case", "evaluation cases need a query");
        if (raw.id !== undefined) {
          if (typeof raw.id !== "string" || !raw.id || sourceCaseIds.has(raw.id)) throw storeError("invalid_eval_case", "evaluation case IDs must be unique nonempty strings");
          sourceCaseIds.add(raw.id);
        }
        const label = evalLabelOf(raw);
        const expectedUri = typeof raw.expectedUri === "string" ? raw.expectedUri : undefined;
        if ((label === "skill") !== (expectedUri !== undefined)) throw storeError("invalid_eval_case", "skill labels need expectedUri and other labels cannot have one");
        if (raw.fromTraceId !== undefined && typeof raw.fromTraceId !== "string") throw storeError("invalid_eval_case", "fromTraceId must be a string");
        const c = { ...(raw.id ? { id: raw.id } : {}), query: raw.query, label, ...(expectedUri ? { expectedUri } : {}), ...(typeof raw.fromTraceId === "string" ? { fromTraceId: raw.fromTraceId } : {}) };
        const key = evalKey(c.query, c.label, c.expectedUri);
        const existing = raw.id ? casesById.get(raw.id) : undefined;
        if (existing && existing.query !== raw.query) throw storeError("invalid_eval_case", "an existing evaluation case ID has a different query");
        if (raw.id ? existing !== undefined : evalKeys.has(key)) evalSkipped++;
        else { evalKeys.add(key); evalToAdd.push(c); }
      }
      const importedRuns = Array.isArray(doc.evaluationRuns) ? doc.evaluationRuns : [];
      const knownRunIds = new Set((db.prepare("SELECT id FROM eval_runs").all() as { id: string }[]).map((row) => row.id));
      const evalRunsToAdd = importedRuns.filter((run) => {
        if (typeof run.id !== "string" || !run.id || typeof run.catalogFingerprint !== "string" || !Number.isInteger(run.catalogSize)
          || !Number.isInteger(run.createdAt) || typeof run.baseline !== "boolean" || !run.metrics || !Array.isArray(run.outcomes)) {
          throw storeError("invalid_eval_run", "evaluation runs are malformed");
        }
        if (knownRunIds.has(run.id)) return false;
        knownRunIds.add(run.id);
        return true;
      });
      const evalRunsSkipped = importedRuns.length - evalRunsToAdd.length;

      const currentAliases = readAliasesOverrides(db);
      const aliasAdded = Object.keys(doc.aliasesOverrides ?? {}).filter((k) => !(k in currentAliases));
      const aliasSkipped = Object.keys(doc.aliasesOverrides ?? {}).filter((k) => k in currentAliases);

      const skillarHome = ctx.opts.skillarHome;
      const existingRaw = readConfigFile(skillarHome);
      const configBase: Record<string, unknown> = existingRaw ?? {};
      const existingRoots = (Array.isArray(configBase.roots) ? configBase.roots : existingRaw ? [] : DEFAULT_ROOTS) as { id: string; path: string }[];
      const rootsAdded: { id: string; path: string }[] = [];
      const rootsSkipped: string[] = [];
      const configAdded: string[] = [];
      const configKept: string[] = [];
      if (skillarHome) {
        const knownPaths = new Set(existingRoots.map((r) => expandHome(r.path, home())));
        const knownIds = new Set(existingRoots.map((r) => r.id));
        for (const r of doc.roots ?? []) {
          const expanded = expandHome(r.path, home());
          if (knownIds.has(r.id) || knownPaths.has(expanded)) rootsSkipped.push(r.id);
          else { rootsAdded.push({ id: r.id, path: tildify(expanded, home()) }); knownIds.add(r.id); knownPaths.add(expanded); }
        }
        for (const k of Object.keys(doc.config ?? {})) {
          if (k === "token" || k === "roots") continue;
          if (k in configBase) configKept.push(k); else configAdded.push(k);
        }
      }

      const historyPath = join(dir, HISTORY_FILE);
      let history: ImportDetails["history"] = null;
      const hasHistory = existsSync(historyPath);
      if (hasHistory) {
        db.prepare("ATTACH DATABASE ? AS hist").run(resolve(historyPath));
        try {
          const version = (db.prepare("PRAGMA hist.user_version").get() as { user_version: number }).user_version;
          if (!HISTORY_VERSIONS.includes(version)) throw storeError("unsupported_history_version", `history.db user_version ${version}`);
          history = historyPlan();
          if (apply) {
            db.exec("BEGIN IMMEDIATE");
            try {
              copyHistory();
              db.exec("COMMIT");
            } catch (error) {
              db.exec("ROLLBACK");
              throw error;
            }
          }
        } finally {
          db.exec("DETACH DATABASE hist");
        }
      }

      if (apply) {
        const insert = db.prepare("INSERT INTO eval_cases (id, query, expected_uri, from_trace_id, created_at, label) VALUES (COALESCE(?, lower(hex(randomblob(16)))), ?, ?, ?, ?, ?)");
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const c of evalToAdd) insert.run(c.id ?? null, c.query, c.expectedUri ?? null, c.fromTraceId ?? null, ctx.now(), c.label);
          const restoredCases = new Map(existingEvalRows().map((row) => [row.id, row]));
          const insertRun = db.prepare(`INSERT INTO eval_runs (id, catalog_fingerprint, catalog_size, created_at, baseline, metrics_json)
            VALUES (?, ?, ?, ?, ?, ?)`);
          const insertOutcome = db.prepare(`INSERT INTO eval_run_cases
            (run_id, eval_case_id, label, expected_uri, language, rank, abstained) VALUES (?, ?, ?, ?, ?, ?, ?)`);
          for (const run of evalRunsToAdd) {
            insertRun.run(run.id, run.catalogFingerprint, run.catalogSize, run.createdAt, run.baseline ? 1 : 0, JSON.stringify(run.metrics));
            for (const outcome of run.outcomes) {
              if (typeof outcome.evalCaseId !== "string" || !sourceCaseIds.has(outcome.evalCaseId)
                || typeof outcome.query !== "string" || (outcome.label !== "skill" && outcome.label !== "no_match")
                || (outcome.label === "skill" && typeof outcome.expectedUri !== "string")
                || (outcome.label !== "skill" && outcome.expectedUri !== undefined)
                || (outcome.language !== "ko" && outcome.language !== "en" && outcome.language !== "other")
                || typeof outcome.abstained !== "boolean" || (outcome.rank !== undefined && (!Number.isInteger(outcome.rank) || outcome.rank < 1))) {
                throw storeError("invalid_eval_run", "evaluation run outcome is malformed");
              }
              const restoredCase = restoredCases.get(outcome.evalCaseId);
              if (!restoredCase || restoredCase.query !== outcome.query) throw storeError("invalid_eval_run", "evaluation run references a case not in the export");
              insertOutcome.run(run.id, restoredCase.id, outcome.label, outcome.expectedUri ?? null, outcome.language, outcome.rank ?? null, outcome.abstained ? 1 : 0);
            }
          }
          if (aliasAdded.length > 0) {
            const next = { ...currentAliases };
            for (const k of aliasAdded) next[k] = doc.aliasesOverrides![k]!;
            writeAliasesOverrides(db, next);
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        if (skillarHome && (rootsAdded.length > 0 || configAdded.length > 0)) {
          const next: Record<string, unknown> = { ...configBase };
          for (const k of configAdded) next[k] = doc.config![k];
          next.roots = [...existingRoots, ...rootsAdded];
          mkdirSync(skillarHome, { recursive: true, mode: 0o700 });
          const p = join(skillarHome, "config.json");
          writeFileSync(p, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
          chmodSync(p, 0o600);
        }
      }

      const historyAdded = history ? Object.values(history.tables).reduce((sum, n) => sum + n, 0) : 0;
      return {
        added: evalToAdd.length + evalRunsToAdd.length + rootsAdded.length + configAdded.length + aliasAdded.length + historyAdded,
        skipped: evalSkipped + evalRunsSkipped + rootsSkipped.length + configKept.length + aliasSkipped.length + (history?.skipped ?? 0),
        details: {
          evalCases: { added: evalToAdd.length, skipped: evalSkipped },
          evaluationRuns: { added: evalRunsToAdd.length, skipped: evalRunsSkipped },
          roots: { added: rootsAdded.map((r) => r.id), skipped: rootsSkipped },
          configKeys: { added: configAdded, kept: configKept },
          aliases: { added: aliasAdded, skipped: aliasSkipped },
          history,
        },
      };
    },
  };
}
