import { createHash } from "node:crypto";
import type { EvalCase, EvalLanguage, EvalMetrics, EvalRun, EvalRunCase, SearchIndex, SkillEntry } from "./types.js";

type MetricCounts = { cases: number; labeled: number; skillLabels: number; noMatchLabels: number; top1: number; top3: number; reciprocalRank: number;
  noMatchCorrect: number; labelCorrect: number; abstained: number };

function emptyCounts(): MetricCounts {
  return { cases: 0, labeled: 0, skillLabels: 0, noMatchLabels: 0, top1: 0, top3: 0, reciprocalRank: 0, noMatchCorrect: 0, labelCorrect: 0, abstained: 0 };
}

function ratio(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

function metricsOf(counts: MetricCounts, unlabeled: number, includeAbstainRate: boolean): Omit<EvalMetrics, "byLanguage"> {
  return {
    cases: counts.cases,
    labeled: counts.labeled,
    unlabeled,
    skillLabels: counts.skillLabels,
    noMatchLabels: counts.noMatchLabels,
    hitAt1: ratio(counts.top1, counts.skillLabels),
    hitAt3: ratio(counts.top3, counts.skillLabels),
    mrr: ratio(counts.reciprocalRank, counts.skillLabels),
    noMatchAccuracy: ratio(counts.noMatchCorrect, counts.noMatchLabels),
    labelAccuracy: ratio(counts.labelCorrect, counts.labeled),
    abstainRate: includeAbstainRate ? ratio(counts.abstained, counts.cases) ?? 0 : 0,
  };
}

/** Korean labels cover queries containing Hangul; English labels cover Latin-only queries. Mixed/other labels stay out of the split. */
export function evaluationLanguage(query: string): EvalLanguage {
  if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(query)) return "ko";
  if (/[A-Za-z]/.test(query)) return "en";
  return "other";
}

/** Stable catalog identity for persisted comparisons. Any searchable entry or manifest change receives a new fingerprint. */
export function catalogFingerprint(entries: readonly SkillEntry[]): string {
  const source = [...entries]
    .sort((a, b) => a.uri.localeCompare(b.uri))
    .map((entry) => [entry.uri, entry.digest, entry.manifestDigest, entry.invocation].join("\t"))
    .join("\n");
  return createHash("sha256").update(source).digest("hex");
}

/** Runs every saved query, but judges only explicit labels. Unlabeled captures remain in the abstention denominator only. */
export function evaluateCases(cases: readonly EvalCase[], search: Pick<SearchIndex, "search">): { metrics: EvalMetrics; outcomes: EvalRunCase[] } {
  const all = emptyCounts();
  const byLanguage = new Map<"ko" | "en", MetricCounts>();
  const outcomes: EvalRunCase[] = [];

  for (const item of cases) {
    const result = search.search(item.query, { mode: "discovery", limit: 10 });
    all.cases += 1;
    if (result.abstained) all.abstained += 1;
    if (item.label === "unlabeled") continue;

    all.labeled += 1;
    const language = evaluationLanguage(item.query);
    const languageCounts = language === "ko" || language === "en"
      ? (byLanguage.get(language) ?? (() => { const next = emptyCounts(); byLanguage.set(language, next); return next; })())
      : undefined;
    const counts = [all, ...(languageCounts ? [languageCounts] : [])];
    if (languageCounts) {
      languageCounts.cases += 1;
      languageCounts.labeled += 1;
    }

    if (item.label === "skill") {
      const position = item.expectedUri === undefined ? -1 : result.candidates.findIndex((candidate) => candidate.uri === item.expectedUri);
      const rank = position >= 0 ? position + 1 : undefined;
      outcomes.push({ evalCaseId: item.id, label: "skill", ...(item.expectedUri ? { expectedUri: item.expectedUri } : {}), language, ...(rank ? { rank } : {}), abstained: Boolean(result.abstained) });
      for (const metric of counts) {
        metric.skillLabels += 1;
        if (rank === 1) { metric.top1 += 1; metric.labelCorrect += 1; }
        if (rank !== undefined && rank <= 3) metric.top3 += 1;
        if (rank !== undefined) metric.reciprocalRank += 1 / rank;
      }
    } else {
      const correct = Boolean(result.abstained);
      outcomes.push({ evalCaseId: item.id, label: "no_match", language, abstained: correct });
      for (const metric of counts) {
        metric.noMatchLabels += 1;
        if (correct) { metric.noMatchCorrect += 1; metric.labelCorrect += 1; }
      }
    }
  }

  const aggregate = metricsOf(all, all.cases - all.labeled, true);
  const byLanguageMetrics: EvalMetrics["byLanguage"] = {};
  for (const [language, counts] of byLanguage) {
    const metrics = metricsOf(counts, 0, false);
    byLanguageMetrics[language] = {
      labels: metrics.labeled,
      skillLabels: metrics.skillLabels,
      noMatchLabels: metrics.noMatchLabels,
      hitAt1: metrics.hitAt1,
      hitAt3: metrics.hitAt3,
      mrr: metrics.mrr,
      noMatchAccuracy: metrics.noMatchAccuracy,
      labelAccuracy: metrics.labelAccuracy,
    };
  }
  return { metrics: { ...aggregate, byLanguage: byLanguageMetrics }, outcomes };
}

export function evalRunFromRow(row: { id: string; catalog_fingerprint: string; catalog_size: number; created_at: number; baseline: number; metrics_json: string }): EvalRun {
  return { id: row.id, catalogFingerprint: row.catalog_fingerprint, catalogSize: row.catalog_size, createdAt: row.created_at,
    baseline: row.baseline === 1, metrics: JSON.parse(row.metrics_json) as EvalMetrics };
}
