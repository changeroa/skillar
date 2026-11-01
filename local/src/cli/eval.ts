import { readFileSync } from "node:fs";
import { createCatalog } from "../catalog/index.js";
import { createSearchIndex } from "../search/index.js";
import { openDb } from "../store/db.js";
import { catalogFingerprint, evaluateCases } from "../evaluation.js";
import type { CliDeps, EvalCase } from "../types.js";

type Case = { query: string; expectedUri?: string };

export type EvalReport = { cases: number; judged: number; noMatchLabels: number; unlabeled: number; hitAt1: number | null; hitAt3: number | null;
  mrr: number | null; noMatchAccuracy: number | null; labelAccuracy: number | null; abstainRate: number;
  misses: { query: string; expectedUri: string; rank: number | null }[] };

const displayMetric = (value: number | null) => value === null ? "-" : value.toFixed(3);

export async function runEval(opts: { cases?: string; json?: boolean; baseline?: boolean }, deps: CliDeps): Promise<number> {
  const store = deps.openStore();
  const catalog = createCatalog({ roots: deps.config.roots, log: () => {} });
  const db = openDb(":memory:");
  try {
    if (opts.baseline && opts.cases) throw new Error("--baseline only applies to saved evaluation cases");
    let cases: EvalCase[] = store.evaluationCases();
    if (opts.cases) {
      const extra: unknown = JSON.parse(readFileSync(opts.cases, "utf8"));
      if (!Array.isArray(extra)) throw new Error("cases file must be a JSON array of { query, expectedUri? }");
      const external = extra as Case[];
      cases = [...cases, ...external.map((item, index) => ({ id: `file-${index}`, query: item.query,
        label: item.expectedUri ? "skill" as const : "unlabeled" as const, ...(item.expectedUri ? { expectedUri: item.expectedUri } : {}), createdAt: 0 }))];
    }
    const index = createSearchIndex(db);
    await catalog.refresh();
    const entries = catalog.list();
    index.rebuild(entries);
    const evaluated = evaluateCases(cases, index);
    const caseById = new Map(cases.map((item) => [item.id, item]));
    const misses = evaluated.outcomes.flatMap((outcome) => {
      if (outcome.label !== "skill" || outcome.rank === 1 || !outcome.expectedUri) return [];
      const item = caseById.get(outcome.evalCaseId);
      return item ? [{ query: item.query, expectedUri: outcome.expectedUri, rank: outcome.rank ?? null }] : [];
    });
    const report: EvalReport = { cases: evaluated.metrics.cases, judged: evaluated.metrics.skillLabels, noMatchLabels: evaluated.metrics.noMatchLabels,
      unlabeled: evaluated.metrics.unlabeled, hitAt1: evaluated.metrics.hitAt1, hitAt3: evaluated.metrics.hitAt3, mrr: evaluated.metrics.mrr,
      noMatchAccuracy: evaluated.metrics.noMatchAccuracy, labelAccuracy: evaluated.metrics.labelAccuracy, abstainRate: evaluated.metrics.abstainRate, misses };
    let savedBaseline = false;
    if (!opts.cases && evaluated.metrics.labeled > 0) {
      store.saveEvalRun({ catalogFingerprint: catalogFingerprint(entries), catalogSize: entries.length, baseline: opts.baseline === true,
        metrics: evaluated.metrics, outcomes: evaluated.outcomes });
      savedBaseline = opts.baseline === true;
    } else if (opts.baseline) {
      throw new Error("label at least one saved evaluation case before capturing a baseline");
    }
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`cases: ${report.cases} (skill labels: ${report.judged}; no-match labels: ${report.noMatchLabels}; unlabeled: ${report.unlabeled})`);
      console.log(`hit@1: ${displayMetric(report.hitAt1)}`);
      console.log(`hit@3: ${displayMetric(report.hitAt3)}`);
      console.log(`MRR: ${displayMetric(report.mrr)}`);
      console.log(`no-match accuracy: ${displayMetric(report.noMatchAccuracy)}`);
      console.log(`label accuracy: ${displayMetric(report.labelAccuracy)}`);
      console.log(`abstain rate: ${report.abstainRate.toFixed(3)}`);
      if (savedBaseline) console.log("baseline: captured");
      for (const m of misses) console.log(`miss: "${m.query}" expected ${m.expectedUri} rank ${m.rank ?? "none"}`);
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    catalog.close();
    db.close();
    store.close();
  }
}
