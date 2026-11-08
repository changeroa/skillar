import { useEffect, useRef, useState } from "preact/hooks";
import type { EvalLabel, EvalMetrics, EvaluationComparison } from "../../src/types.js";
import { api, type EvaluationDto } from "../api";
import { installStyles } from "../charts/sankey";
import { skillName, type ViewProps } from "../state";

export function metricText(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

export function labelUpdate(value: string): { label: EvalLabel; expectedUri?: string } {
  if (value === "unlabeled" || value === "no_match") return { label: value };
  return { label: "skill", expectedUri: value };
}

export function comparisonText(comparison: EvaluationComparison): string {
  const changes = [
    comparison.improved ? `${comparison.improved} improved` : "",
    comparison.regressed ? `${comparison.regressed} regressed` : "",
    comparison.newlyFound ? `${comparison.newlyFound} found` : "",
    comparison.lost ? `${comparison.lost} lost` : "",
  ].filter(Boolean);
  return changes.length ? changes.join(" · ") : "No paired rank changes";
}

function Metric({ label, value, detail }: { label: string; value: number | null | undefined; detail: string }) {
  return <div class="eval__metric"><dt>{label}</dt><dd>{metricText(value)}</dd><small>{detail}</small></div>;
}

function Metrics({ metrics }: { metrics: EvalMetrics }) {
  const languages = (["ko", "en"] as const).flatMap((language) => metrics.byLanguage[language] ? [[language, metrics.byLanguage[language]!]] as const : []);
  return (
    <>
      <dl class="eval__metrics">
        <Metric label="Label accuracy" value={metrics.labelAccuracy} detail={`${metrics.labeled} labeled queries`} />
        <Metric label="Hit @1" value={metrics.hitAt1} detail={`${metrics.skillLabels} skill labels`} />
        <Metric label="Hit @3" value={metrics.hitAt3} detail="correct skill in top three" />
        <Metric label="MRR" value={metrics.mrr} detail="skill-label ranking" />
        <Metric label="No-match accuracy" value={metrics.noMatchAccuracy} detail={`${metrics.noMatchLabels} explicit no-match labels`} />
        <Metric label="Abstain rate" value={metrics.abstainRate} detail={`${metrics.cases} saved queries`} />
      </dl>
      {languages.length > 0 && (
        <section class="eval__languages" aria-label="Labeled query language breakdown">
          <h2>Language breakdown</h2>
          <div class="eval__language-grid">
            {languages.map(([language, metrics]) => (
              <div key={language} class="eval__language">
                <b>{language === "ko" ? "Korean" : "English"}</b>
                <span>{metrics.labels} labels</span>
                <span>top 1 {metricText(metrics.hitAt1)}</span>
                <span>no-match {metricText(metrics.noMatchAccuracy)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ComparisonMetric({ label, before, after }: { label: string; before: number | null; after: number | null }) {
  const delta = before === null || after === null ? "no common denominator" : `${after >= before ? "+" : ""}${Math.round((after - before) * 100)} pp`;
  return <div class="eval__metric"><dt>{label}</dt><dd>{metricText(before)} → {metricText(after)}</dd><small>{delta}</small></div>;
}

function Comparison({ comparison }: { comparison: EvaluationComparison }) {
  return (
    <section class="eval__comparison card">
      <div>
        <p class="eval__eyebrow">Persisted comparison</p>
        <h2>Baseline to current catalog</h2>
        <p class="eval__copy">{comparison.paired} comparable labels · {comparisonText(comparison)}</p>
      </div>
      <dl class="eval__deltas">
        <ComparisonMetric label="Hit @1" before={comparison.pairedBaseline.hitAt1} after={comparison.pairedCurrent.hitAt1} />
        <ComparisonMetric label="Hit @3" before={comparison.pairedBaseline.hitAt3} after={comparison.pairedCurrent.hitAt3} />
        <ComparisonMetric label="MRR" before={comparison.pairedBaseline.mrr} after={comparison.pairedCurrent.mrr} />
        <ComparisonMetric label="No-match" before={comparison.pairedBaseline.noMatchAccuracy} after={comparison.pairedCurrent.noMatchAccuracy} />
      </dl>
      {(comparison.noMatchImproved > 0 || comparison.noMatchRegressed > 0) && <p class="eval__copy">No-match judgements: {comparison.noMatchImproved} improved · {comparison.noMatchRegressed} regressed</p>}
    </section>
  );
}

export function EvaluationView(_props: ViewProps) {
  const [data, setData] = useState<EvaluationDto>();
  const [skills, setSkills] = useState<{ uri: string; name: string }[]>([]);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState<string>();
  const [running, setRunning] = useState<"baseline" | "current">();
  const [error, setError] = useState<string>();
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    let cancelled = false;
    Promise.all([api.evaluation(), api.skills()]).then(([next, entries]) => {
      if (!cancelled && generation.current === request) { setData(next); setSkills(entries); setError(undefined); }
    }, (reason: unknown) => {
      if (!cancelled && generation.current === request) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [revision]);

  const refresh = () => setRevision((value) => value + 1);
  const update = (id: string, value: string) => {
    if (saving !== undefined || running !== undefined) return;
    generation.current += 1;
    setSaving(id);
    setError(undefined);
    api.updateEvalCase(id, labelUpdate(value)).then(refresh, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(undefined));
  };
  const run = (baseline: boolean) => {
    if (saving !== undefined || running !== undefined) return;
    generation.current += 1;
    setRunning(baseline ? "baseline" : "current");
    setError(undefined);
    api.runEvaluation({ baseline }).then((next) => setData(next), (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setRunning(undefined));
  };

  if (!data) return <section class="empty"><h1>Loading search evaluation</h1>{error && <p role="alert">{error}</p>}</section>;
  const labeled = data.cases.filter((item) => item.label !== "unlabeled").length;
  const stale = data.latest && data.latest.catalogFingerprint !== data.currentCatalogFingerprint;
  return (
    <section class="eval">
      <header class="eval__head card">
        <div>
          <p class="eval__eyebrow">Search improvement loop</p>
          <h1>Search evaluation</h1>
          <p class="eval__copy">Label saved searches with the correct catalog skill or an explicit no-match. Unlabeled captures are retained but never scored as negative.</p>
        </div>
        <div class="eval__actions">
          <button type="button" class="btn" data-evaluation-action="baseline" disabled={labeled === 0 || saving !== undefined || running !== undefined} onClick={() => run(true)}>
            {running === "baseline" ? "Capturing…" : "Capture baseline"}
          </button>
          <button type="button" class="btn" data-evaluation-action="current" disabled={labeled === 0 || saving !== undefined || running !== undefined} onClick={() => run(false)}>
            {running === "current" ? "Evaluating…" : "Evaluate current ranking"}
          </button>
        </div>
        {stale && <p class="eval__notice">The catalog changed since the last evaluation. Run the current ranking to compare it with the saved baseline.</p>}
        {error && <p class="eval__error" role="alert">{error}</p>}
      </header>

      {data.latest ? <section class="eval__results card"><div class="eval__results-head"><div><p class="eval__eyebrow">Latest evaluation</p><h2>{data.latest.baseline ? "Baseline" : "Current ranking"}</h2></div><span>{data.latest.catalogSize} catalog skills</span></div><Metrics metrics={data.latest.metrics} /></section>
        : <section class="eval__results card"><h2>No evaluation run yet</h2><p class="eval__copy">Label at least one saved query, then capture a baseline before changing a skill or catalog entry.</p></section>}
      {data.comparison && <Comparison comparison={data.comparison} />}

      <section class="eval__cases card">
        <div class="eval__cases-head"><div><p class="eval__eyebrow">Saved queries</p><h2>{data.cases.length} captured · {labeled} labeled</h2></div><button type="button" class="btn" data-evaluation-action="refresh" disabled={saving !== undefined || running !== undefined} onClick={refresh}>Refresh</button></div>
        {data.cases.length === 0 ? <p class="eval__copy">Save a search from a session trace to start an evaluation set.</p> : (
          <ol class="eval__list">
            {data.cases.map((item) => {
              const value = item.label === "skill" ? item.expectedUri ?? "unlabeled" : item.label;
              const known = item.expectedUri && skills.some((skill) => skill.uri === item.expectedUri);
              return <li key={item.id} class="eval__case" data-eval-case={item.id}>
                <blockquote>{item.query}</blockquote>
                <label>
                  <span class="eval__label">Judgement</span>
                  <select class="field eval__select" data-eval-label={item.id} value={value} disabled={saving !== undefined || running !== undefined} onChange={(event) => update(item.id, event.currentTarget.value)}>
                    <option value="unlabeled">Unlabeled</option>
                    <option value="no_match">No matching catalog skill</option>
                    {item.label === "skill" && !known && <option value={item.expectedUri} disabled>Unavailable: {skillName(item.expectedUri!)}</option>}
                    <optgroup label="Correct catalog skill">
                      {skills.map((skill) => <option key={skill.uri} value={skill.uri}>{skill.name}</option>)}
                    </optgroup>
                  </select>
                </label>
                {item.fromTraceId && <span class="eval__trace" title="source trace">trace {item.fromTraceId}</span>}
              </li>;
            })}
          </ol>
        )}
      </section>
    </section>
  );
}

const EVALUATION_CSS = `
.eval { display: grid; gap: var(--s-4); }
.eval__head, .eval__results, .eval__cases, .eval__comparison { padding: var(--s-4) var(--s-5); }
.eval__head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--s-3) var(--s-6); align-items: start; }
.eval h1, .eval h2 { margin: 0; font-size: var(--fs-title); font-weight: 600; letter-spacing: -0.01em; }
.eval__eyebrow { margin: 0 0 var(--s-1); color: var(--ink-3); font-size: var(--fs-cap); font-weight: 500; }
.eval__copy, .eval__notice, .eval__error { margin: var(--s-2) 0 0; color: var(--ink-2); font-size: var(--fs-sm); }
.eval__notice { grid-column: 1 / -1; padding: var(--s-2) var(--s-3); border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--wash); }
.eval__error { color: var(--bad); grid-column: 1 / -1; }
.eval__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--s-2); }
.eval__results { display: grid; gap: var(--s-4); }
.eval__results-head, .eval__cases-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-3); }
.eval__results-head > span { color: var(--ink-3); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; }
.eval__metrics, .eval__deltas { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--s-2); margin: 0; }
.eval__metric { display: grid; gap: var(--s-1); min-width: 0; padding: var(--s-2); border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); }
.eval__metric dt, .eval__metric small { color: var(--ink-3); font-size: var(--fs-cap); font-weight: 500; }
.eval__metric dd { margin: 0; color: var(--ink); font-size: var(--fs-title); font-weight: 600; font-variant-numeric: tabular-nums; }
.eval__languages { display: grid; gap: var(--s-2); }
.eval__languages h2 { font-size: var(--fs-sm); }
.eval__language-grid { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.eval__language { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-1) var(--s-2); padding: var(--s-2); border: 1px solid var(--line); border-radius: var(--r-sm); color: var(--ink-2); font-size: var(--fs-cap); }
.eval__language b { color: var(--ink); font-size: var(--fs-sm); }
.eval__comparison { display: grid; gap: var(--s-3); }
.eval__deltas { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.eval__cases { display: grid; gap: var(--s-3); }
.eval__list { display: grid; gap: var(--s-2); margin: 0; padding: 0; list-style: none; }
.eval__case { display: grid; grid-template-columns: minmax(0, 1fr) minmax(12rem, 18rem) auto; gap: var(--s-2) var(--s-3); align-items: center; padding: var(--s-3) 0; border-top: 1px solid var(--line); }
.eval__case blockquote { margin: 0; color: var(--ink); font-size: var(--fs-sm); overflow-wrap: anywhere; }
.eval__case label { display: grid; gap: var(--s-1); min-width: 0; }
.eval__label, .eval__trace { color: var(--ink-3); font-size: var(--fs-cap); font-weight: 500; }
.eval__select { width: 100%; min-width: 0; }
.eval__trace { font-family: var(--font-mono); overflow-wrap: anywhere; }
@media (max-width: 639.98px) {
  .eval__head, .eval__results, .eval__cases, .eval__comparison { padding: var(--s-4); }
  .eval__head { grid-template-columns: 1fr; }
  .eval__actions { justify-content: flex-start; }
  .eval__metrics, .eval__deltas { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .eval__case { grid-template-columns: 1fr; }
}
`;

installStyles("evaluation", EVALUATION_CSS);
