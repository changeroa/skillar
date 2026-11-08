import { DEFAULT_THRESHOLD, fuse } from "./fusion.js";
import { ABSTAIN_HINTS } from "./guidance.js";
import { buildLexical, normalize, terms } from "./lexical.js";
import type { FtsHit } from "./fts.js";
import type { AbstainReason, SearchEntry, SearchOptions, SearchOutcome } from "./types.js";

export type SearchResult = Pick<SearchOutcome, "candidates" | "abstained">;
export type FtsChannel = { search(query: string): FtsHit[] };

/** Pure ranking over one complete corpus and its corresponding SQLite FTS channel. */
export function buildSearchCore(list: readonly SearchEntry[], fts: FtsChannel) {
  const entries = new Map(list.map(e => [e.uri, e]));
  const lexical = buildLexical([...entries.values()]);
  return (query: string, opts: SearchOptions, threshold = DEFAULT_THRESHOLD): SearchResult => {
    const abstain = (reason: AbstainReason): SearchResult =>
      ({ candidates: [], abstained: { reason, hint: ABSTAIN_HINTS[reason] } });
    const text = normalize(query ?? "");
    if (!text) return abstain("empty_query");
    const fused = fuse(lexical.search(text), fts.search(text), terms(text)).filter(f => entries.has(f.uri));
    if (!fused.length) return abstain("no_overlap");
    const allowed = fused.flatMap(f => {
      const entry = entries.get(f.uri);
      return entry && (opts.mode !== "automatic" || entry.invocation === "automatic") ? [{ f, entry }] : [];
    });
    const first = allowed[0];
    if (!first) return abstain("explicit_only");
    if (first.f.score < threshold) return abstain("below_threshold");
    const limit = Math.max(1, Math.floor(opts.limit));
    return { candidates: allowed.slice(0, limit).map(({ f, entry: e }, i) => ({
      uri: e.uri, name: e.name, description: e.description, score: f.score, rank: i + 1,
      invocation: e.invocation, digest: e.digest, matched: f.matched,
    })) };
  };
}
