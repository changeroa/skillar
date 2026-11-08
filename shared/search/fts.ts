import type { SearchEntry, SkillUri } from "./types.js";
import { isStopword, normalize, stem, words } from "./lexical.js";

export const FTS_MIN_CHARS = 3;
const length = (s: string) => Array.from(s).length;

export function ftsTokens(query: string): string[] {
  const text = normalize(query);
  if (length(text) < FTS_MIN_CHARS) return [];
  const tokens = new Set<string>();
  for (const word of words(text)) {
    if (isStopword(word)) continue;
    for (const t of [word, stem(word)]) if (length(t) >= FTS_MIN_CHARS) tokens.add(t);
  }
  tokens.add(text);
  return [...tokens];
}

export const ftsMatchExpression = (tokens: string[]) => tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(" OR ");
export type FtsHit = { uri: SkillUri; rank: number; bm25: number; matched: string[] };

// Identical column order, tokenizer, weights and implicit rowid tie order on both SQLite runtimes.
export const FTS_SCHEMA = `CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
  uri UNINDEXED, name, description, when_to_use, examples, aliases_ko, body_head, tokenize = 'trigram'
)`;
export const FTS_INSERT = "INSERT INTO skills_fts(uri, name, description, when_to_use, examples, aliases_ko, body_head) VALUES (?, ?, ?, ?, ?, ?, ?)";
export const FTS_DELETE = "DELETE FROM skills_fts WHERE uri = ?";
export const FTS_SEARCH = "SELECT uri, bm25(skills_fts, 0, 8, 2, 3, 5, 6, 1) AS score FROM skills_fts WHERE skills_fts MATCH ? ORDER BY score LIMIT ?";
export const ftsFields = (e: SearchEntry) =>
  [e.name, e.description, e.whenToUse ?? "", e.examples.join("\n"), e.aliasesKo.join("\n"), e.bodyHead] as const;

export function ftsHits(rows: readonly { uri: string; score: number }[], tokens: string[], texts: ReadonlyMap<string, string>): FtsHit[] {
  return rows.map((row, i) => {
    const text = texts.get(row.uri) ?? "";
    return { uri: row.uri, rank: i + 1, bm25: row.score, matched: tokens.filter(t => text.includes(t)) };
  });
}
