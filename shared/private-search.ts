export { buildSearchCore } from "./search/core.js";
export type { SearchResult, FtsChannel } from "./search/core.js";
export { RRF_K, DEFAULT_THRESHOLD, termCoverage, fuse, calibrate } from "./search/fusion.js";
export type { Fused } from "./search/fusion.js";
export { SEARCH_TOOL_GUIDANCE, ABSTAIN_HINTS } from "./search/guidance.js";
export { normalize, stem, words, isStopword, terms, keywordsOf, buildLexical } from "./search/lexical.js";
export type { LexicalHit, LexicalIndex } from "./search/lexical.js";
export {
  FTS_MIN_CHARS, FTS_SCHEMA, FTS_INSERT, FTS_DELETE, FTS_SEARCH,
  ftsTokens, ftsMatchExpression, ftsFields, ftsHits,
} from "./search/fts.js";
export type { FtsHit } from "./search/fts.js";
export type { SkillUri, SearchEntry, SearchMode, SearchOptions, Candidate, AbstainReason, SearchOutcome } from "./search/types.js";
