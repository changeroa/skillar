import type { Candidate, SkillUri } from "../../src/types.js";
import { termCoverage } from "../../src/search/fusion.js";
import { terms } from "../../src/search/lexical.js";

// Candidates panel for one search step (todo 15). The store's trace() attaches `chosen: boolean` to each
// candidate next to the step-level `chosen: SkillUri[]`; both are accepted so either source marks the row.
export type CandidateLike = Candidate & { chosen?: boolean };

export type CandidatesProps = { candidates: readonly CandidateLike[]; chosen?: readonly SkillUri[]; query?: string };

/** Rank order as the router returned it; the match score is coverage-scaled and need not descend with rank. */
export function orderCandidates<T extends CandidateLike>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) => a.rank - b.rank);
}

/** "3/5 terms": query terms the candidate matched, counted with the router's own term rules; undefined without terms. */
export function coverageLabel(query: string | undefined, matched: readonly string[] | undefined): string | undefined {
  const queryTerms = query ? terms(query) : [];
  if (!queryTerms.length) return undefined;
  const { hit, total } = termCoverage(queryTerms, matched ?? []);
  return `단어 ${hit}/${total} 일치`;
}

/** Root id of skill://local/<rootId>/<dir>/SKILL.md, or undefined for a URI of another shape. */
export function rootOf(uri: string): string | undefined {
  const match = /^skill:\/\/local\/([^/]+)\//.exec(uri);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

/** URIs whose name appears more than once in the list, mapped to their root hint. */
export function rootHints(candidates: readonly CandidateLike[]): Map<SkillUri, string> {
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const hints = new Map<SkillUri, string>();
  for (const c of candidates) {
    const root = (counts.get(c.name) ?? 0) > 1 ? rootOf(c.uri) : undefined;
    if (root) hints.set(c.uri, root);
  }
  return hints;
}

export function chosenUris(candidates: readonly CandidateLike[], chosen: readonly SkillUri[] | undefined): Set<SkillUri> {
  const set = new Set<SkillUri>(chosen ?? []);
  for (const candidate of candidates) if (candidate.chosen) set.add(candidate.uri);
  return set;
}

export function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(2) : "-";
}

export function scoreWidth(score: number): string {
  const clamped = Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0;
  return `${Math.round(clamped * 100)}%`;
}

export const INVOCATION_LABEL: Record<Candidate["invocation"], string> = { automatic: "자동", explicit: "명시" };
export const INVOCATION_TITLE: Record<Candidate["invocation"], string> = {
  automatic: "automatic: 검색에서 자동으로 추천될 수 있습니다.",
  explicit: "explicit: 스킬 이름을 직접 지정했을 때만 읽습니다.",
};

function CheckIcon() {
  // Lucide "check"
  return (
    <svg class="cand__check" viewBox="0 0 24 24" width="16" height="16" role="img" aria-label="이 검색 후 읽음" focusable="false">
      <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function Candidates({ candidates, chosen, query }: CandidatesProps) {
  if (!candidates.length) return <p class="cands__none">반환된 후보가 없습니다.</p>;
  const picked = chosenUris(candidates, chosen);
  const roots = rootHints(candidates);
  return (
    <>
    <p class="cands__legend">일치도 = 순위 점수 {"\u00d7"} 일치한 검색어 단어 비율</p>
    <ol class="cands" aria-label="검색 후보">
      {orderCandidates(candidates).map((candidate) => {
        const isChosen = picked.has(candidate.uri);
        const root = roots.get(candidate.uri);
        const coverage = coverageLabel(query, candidate.matched);
        return (
          <li
            key={candidate.uri}
            class={isChosen ? "cand cand--chosen" : "cand"}
            data-uri={candidate.uri}
            data-score={formatScore(candidate.score)}
            data-chosen={isChosen ? "true" : "false"}
          >
            <span class="cand__rank" aria-label={`순위 ${candidate.rank}`}>{candidate.rank}</span>
            <span class="cand__name" title={candidate.uri}>
              <span class="cand__nm">{candidate.name}</span>
              {root ? <span class="cand__root" data-root={root}>{root}</span> : null}
            </span>
            <span class="cand__inv" title={INVOCATION_TITLE[candidate.invocation] ?? candidate.invocation}>
              {INVOCATION_LABEL[candidate.invocation] ?? candidate.invocation}
            </span>
            <span class="cand__bar" role="img" title="일치도" aria-label={`일치도 ${formatScore(candidate.score)}${coverage ? `, ${coverage}` : ""}`}>
              <span class="cand__fill" style={{ width: scoreWidth(candidate.score) }} />
            </span>
            <span class="cand__score">{formatScore(candidate.score)}</span>
            <span class="cand__cov">{coverage ?? ""}</span>
            <span class="cand__pick">{isChosen ? <CheckIcon /> : null}</span>
            <span class="cand__desc">
              {candidate.description}
              {candidate.matched?.length ? <span class="cand__matched"> {"\u00b7"} 일치 단어 {candidate.matched.join(", ")}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
    </>
  );
}
