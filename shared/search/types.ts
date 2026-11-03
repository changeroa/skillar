/** Parsed search projection; URI identity and corpus authority belong to the caller. */
export type SkillUri = string;
export type SearchEntry = {
  readonly uri: SkillUri;
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly examples: readonly string[];
  readonly aliasesKo: readonly string[];
  readonly invocation: "automatic" | "explicit";
  readonly bodyHead: string;
  readonly digest: string;
};
export type SearchMode = "discovery" | "automatic" | "explicit";
export type SearchOptions = { readonly mode: SearchMode; readonly limit: number };
export type Candidate = {
  uri: SkillUri; name: string; description: string; score: number; rank: number;
  invocation: "automatic" | "explicit"; digest: string; matched: string[];
};
export type AbstainReason = "empty_query" | "no_overlap" | "below_threshold" | "explicit_only";
export type SearchOutcome = {
  traceId: string; query: string; mode: SearchMode; candidates: Candidate[];
  abstained?: { reason: AbstainReason; hint: string }; elapsedMs: number;
};
