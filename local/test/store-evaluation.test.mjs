import assert from "node:assert/strict";
import { test } from "node:test";
import { makeTempDir, removeDir } from "./_helpers.mjs";
import { openStore, uri } from "./helpers/store.mjs";

const { evaluateCases, evaluationLanguage } = await import("../dist/evaluation.js");

function searchFor(ranks) {
  return {
    search(query) {
      const rank = ranks[query];
      const candidates = rank === undefined || rank === null ? [] : Array.from({ length: rank }, (_, index) => ({
        uri: index === rank - 1 ? uri("correct") : uri(`other-${index}`), rank: index + 1,
      }));
      return { traceId: `trace-${query}`, query, mode: "discovery", candidates,
        ...(rank === null ? { abstained: { reason: "no_overlap", hint: "none" } } : {}), elapsedMs: 0 };
    },
  };
}

function metrics({ hitAt1, labelAccuracy }) {
  return { cases: 3, labeled: 2, unlabeled: 1, skillLabels: 1, noMatchLabels: 1, hitAt1, hitAt3: 1, mrr: hitAt1 ? 1 : 0.5,
    noMatchAccuracy: 1, labelAccuracy, abstainRate: 1 / 3, byLanguage: {} };
}

test("evaluation keeps unlabeled queries neutral, records language metrics, and compares persisted ranks", () => {
  const { store } = openStore();
  try {
    const korean = store.addEvalCase({ query: "코드 리뷰 부탁해", expectedUri: uri("correct") });
    const englishNoMatch = store.addEvalCase({ query: "obscure unsupported topic", label: "no_match" });
    const unlabeled = store.addEvalCase({ query: "captured without judgement" });
    assert.deepEqual(store.evaluationCases().map((item) => item.label), ["skill", "no_match", "unlabeled"]);

    const before = evaluateCases(store.evaluationCases(), searchFor({ [korean.query]: 2, [englishNoMatch.query]: null, [unlabeled.query]: 1 }));
    assert.deepEqual(before.metrics, {
      cases: 3, labeled: 2, unlabeled: 1, skillLabels: 1, noMatchLabels: 1, hitAt1: 0, hitAt3: 1, mrr: 0.5,
      noMatchAccuracy: 1, labelAccuracy: 0.5, abstainRate: 1 / 3,
      byLanguage: {
        ko: { labels: 1, skillLabels: 1, noMatchLabels: 0, hitAt1: 0, hitAt3: 1, mrr: 0.5, noMatchAccuracy: null, labelAccuracy: 0 },
        en: { labels: 1, skillLabels: 0, noMatchLabels: 1, hitAt1: null, hitAt3: null, mrr: null, noMatchAccuracy: 1, labelAccuracy: 1 },
      },
    });
    assert.equal(evaluationLanguage("한국어 English"), "ko");
    assert.equal(evaluationLanguage("english only"), "en");
    assert.equal(evaluationLanguage("12345"), "other");

    store.saveEvalRun({ catalogFingerprint: "before", catalogSize: 1, baseline: true, metrics: before.metrics, outcomes: before.outcomes });
    const after = evaluateCases(store.evaluationCases(), searchFor({ [korean.query]: 1, [englishNoMatch.query]: null, [unlabeled.query]: 1 }));
    store.saveEvalRun({ catalogFingerprint: "after", catalogSize: 2, baseline: false, metrics: after.metrics, outcomes: after.outcomes });
    const summary = store.evaluationSummary();
    assert.ok(summary.comparison);
    assert.deepEqual(summary.comparison && {
      paired: summary.comparison.paired, improved: summary.comparison.improved, regressed: summary.comparison.regressed,
      newlyFound: summary.comparison.newlyFound, lost: summary.comparison.lost, hitAt1Delta: summary.comparison.hitAt1Delta,
    }, { paired: 2, improved: 1, regressed: 0, newlyFound: 0, lost: 0, hitAt1Delta: 1 });

    const relabeled = store.updateEvalCase(korean.id, { label: "no_match" });
    assert.deepEqual(relabeled && { label: relabeled.label, expectedUri: relabeled.expectedUri }, { label: "no_match", expectedUri: undefined });
  } finally {
    store.close();
  }
});

test("portable export/import preserves labels and persisted comparison snapshots", () => {
  const dir = makeTempDir();
  const source = openStore();
  const target = openStore();
  try {
    const skill = source.store.addEvalCase({ query: "ranked query", expectedUri: uri("correct") });
    const noMatch = source.store.addEvalCase({ query: "nothing applies", label: "no_match" });
    const unlabeled = source.store.addEvalCase({ query: "keep but do not judge" });
    const outcomes = [
      { evalCaseId: skill.id, label: "skill", expectedUri: uri("correct"), language: "en", rank: 2, abstained: false },
      { evalCaseId: noMatch.id, label: "no_match", language: "en", abstained: true },
    ];
    source.store.saveEvalRun({ catalogFingerprint: "before", catalogSize: 1, baseline: true, metrics: metrics({ hitAt1: 0, labelAccuracy: 0.5 }), outcomes });
    source.store.saveEvalRun({ catalogFingerprint: "after", catalogSize: 2, baseline: false, metrics: metrics({ hitAt1: 1, labelAccuracy: 1 }), outcomes: [{ ...outcomes[0], rank: 1 }, outcomes[1]] });
    source.store.exportTo(dir, { withHistory: false });

    const preview = target.store.importFrom(dir, { merge: false });
    assert.deepEqual(preview.details, {
      evalCases: { added: 3, skipped: 0 }, evaluationRuns: { added: 2, skipped: 0 }, roots: { added: [], skipped: [] },
      configKeys: { added: [], kept: [] }, aliases: { added: [], skipped: [] }, history: null,
    });
    target.store.importFrom(dir, { merge: true });
    assert.deepEqual(target.store.evaluationCases().map((item) => item.label), ["skill", "no_match", "unlabeled"]);
    assert.ok(target.store.evaluationSummary().comparison, "portable snapshots retain their before/after comparison");
    assert.equal(unlabeled.label, "unlabeled");
  } finally {
    source.store.close();
    target.store.close();
    removeDir(dir);
  }
});

test("comparison metrics use only unchanged paired judgements when labels and cases change", () => {
  const { store } = openStore();
  try {
    const stable = store.addEvalCase({ query: "stable ranking", expectedUri: uri("correct") });
    const changed = store.addEvalCase({ query: "changed judgement", expectedUri: uri("correct") });
    const negative = store.addEvalCase({ query: "still unsupported", label: "no_match" });
    const before = evaluateCases(store.evaluationCases(), searchFor({
      [stable.query]: 2, [changed.query]: 3, [negative.query]: null,
    }));
    store.saveEvalRun({ catalogFingerprint: "before", catalogSize: 2, baseline: true, ...before });
    store.updateEvalCase(changed.id, { label: "no_match" });
    const added = store.addEvalCase({ query: "new easy query", expectedUri: uri("correct") });
    const after = evaluateCases(store.evaluationCases(), searchFor({
      [stable.query]: 2, [changed.query]: null, [negative.query]: null, [added.query]: 1,
    }));
    store.saveEvalRun({ catalogFingerprint: "after", catalogSize: 3, baseline: false, ...after });
    const summary = store.evaluationSummary();
    assert.equal(summary.latest.metrics.hitAt1, 0.5, "the full current set has an additional easy positive");
    assert.equal(summary.comparison.paired, 2);
    assert.equal(summary.comparison.pairedBaseline.hitAt1, 0);
    assert.equal(summary.comparison.pairedCurrent.hitAt1, 0);
    assert.equal(summary.comparison.hitAt1Delta, 0, "new labels cannot fabricate an improvement");
    assert.equal(summary.comparison.noMatchAccuracyDelta, 0);
    assert.equal(summary.comparison.mrrDelta, 0);
  } finally {
    store.close();
  }
});

test("portable snapshots preserve case identity after relabeling repeated queries", () => {
  const dir = makeTempDir();
  const source = openStore(), target = openStore();
  try {
    const cases = Array.from({ length: 3 }, () => source.store.addEvalCase({ query: "repeated query", expectedUri: uri("correct") }));
    const before = evaluateCases(source.store.evaluationCases(), searchFor({ "repeated query": 2 }));
    source.store.saveEvalRun({ catalogFingerprint: "before", catalogSize: 2, baseline: true, ...before });
    source.store.updateEvalCase(cases[0].id, { label: "no_match" });
    const after = evaluateCases(source.store.evaluationCases(), searchFor({ "repeated query": 1 }));
    source.store.saveEvalRun({ catalogFingerprint: "after", catalogSize: 3, baseline: false, ...after });
    source.store.exportTo(dir, { withHistory: false });
    target.store.importFrom(dir, { merge: true });
    assert.deepEqual(target.store.evaluationCases().map((row) => row.id), cases.map((row) => row.id));
    const restored = target.store.evaluationSummary();
    assert.equal(restored.cases.length, 3);
    assert.equal(restored.cases[0].label, "no_match");
    assert.equal(restored.comparison.paired, 2);
    assert.equal(restored.comparison.improved, 2);
    assert.equal(restored.comparison.mrrDelta, 0.5);
    assert.equal(target.store.importFrom(dir, { merge: true }).added, 0);
  } finally {
    source.store.close();
    target.store.close();
    removeDir(dir);
  }
});
