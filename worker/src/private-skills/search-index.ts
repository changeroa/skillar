// SPDX-License-Identifier: AGPL-3.0-only
import {
  buildSearchCore, DEFAULT_THRESHOLD, FTS_SCHEMA, FTS_INSERT, FTS_DELETE, FTS_SEARCH,
  ftsFields, ftsTokens, ftsMatchExpression, ftsHits, normalize,
} from "../../../shared/private-search.ts";
import type { SearchEntry, SearchOptions, SearchOutcome } from "../../../shared/private-search.ts";

export type PrivateSkillSearch = {
  readonly rebuild: (entries: readonly SearchEntry[], threshold?: number) => void;
  readonly search: (query: string, opts: SearchOptions) => SearchOutcome;
};

type EntryRow = {
  uri: string; name: string; description: string; when_to_use: string | null;
  examples: string; aliases_ko: string; invocation: "automatic" | "explicit"; body_head: string; digest: string;
};

/**
 * One account object's rebuildable projection, never an authority or a shared tenant corpus.
 * Caller supplies complete parsed entries with canonical opaque URIs and holds its actor gate.
 * No scheduling, HTTP, authorization, or D1/R2 access belongs to this adapter.
 */
export function createPrivateSkillSearch(storage: DurableObjectStorage): PrivateSkillSearch {
  const sql = storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS private_search_entries (
    uri TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, when_to_use TEXT,
    examples TEXT NOT NULL, aliases_ko TEXT NOT NULL, invocation TEXT NOT NULL,
    body_head TEXT NOT NULL, digest TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS private_search_meta (key TEXT PRIMARY KEY, value REAL NOT NULL);`);
  sql.exec(FTS_SCHEMA);

  const texts = new Map<string, string>();
  const fts = { search(query: string) {
    const tokens = ftsTokens(query);
    if (!tokens.length) return [];
    const rows = sql.exec<{ uri: string; score: number }>(FTS_SEARCH, ftsMatchExpression(tokens), 50).toArray();
    return ftsHits(rows, tokens, texts);
  } };
  const hydrate = () => {
    texts.clear();
    const entries: SearchEntry[] = [];
    for (const row of sql.exec<EntryRow>("SELECT * FROM private_search_entries ORDER BY rowid")) {
      const entry: SearchEntry = {
        uri: row.uri, name: row.name, description: row.description,
        ...(row.when_to_use === null ? {} : { whenToUse: row.when_to_use }),
        examples: sql.exec<{ value: string }>("SELECT value FROM json_each(?) ORDER BY key", row.examples).toArray().map(r => r.value),
        aliasesKo: sql.exec<{ value: string }>("SELECT value FROM json_each(?) ORDER BY key", row.aliases_ko).toArray().map(r => r.value),
        invocation: row.invocation, bodyHead: row.body_head, digest: row.digest,
      };
      entries.push(entry);
      texts.set(entry.uri, normalize(ftsFields(entry).join(" ")));
    }
    return buildSearchCore(entries, fts);
  };
  let search = hydrate();
  let threshold = sql.exec<{ value: number }>("SELECT value FROM private_search_meta WHERE key = 'threshold'").toArray()[0]?.value ?? DEFAULT_THRESHOLD;
  return {
    rebuild(entries, nextThreshold = DEFAULT_THRESHOLD) {
      const value = Number.isFinite(nextThreshold) ? nextThreshold : DEFAULT_THRESHOLD;
      storage.transactionSync(() => {
        sql.exec("DELETE FROM skills_fts; DELETE FROM private_search_entries");
        for (const e of entries) {
          sql.exec(`INSERT INTO private_search_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(uri) DO UPDATE SET name=excluded.name, description=excluded.description,
            when_to_use=excluded.when_to_use, examples=excluded.examples, aliases_ko=excluded.aliases_ko,
            invocation=excluded.invocation, body_head=excluded.body_head, digest=excluded.digest`,
          e.uri, e.name, e.description, e.whenToUse ?? null, JSON.stringify(e.examples),
          JSON.stringify(e.aliasesKo), e.invocation, e.bodyHead, e.digest);
          sql.exec(FTS_DELETE, e.uri);
          sql.exec(FTS_INSERT, e.uri, ...ftsFields(e));
        }
        sql.exec("INSERT OR REPLACE INTO private_search_meta VALUES ('threshold', ?)", value);
      });
      search = hydrate();
      threshold = value;
    },
    search(query, opts) {
      const started = performance.now();
      const traceId = crypto.randomUUID();
      return { traceId, query, mode: opts.mode, ...search(query, opts, threshold), elapsedMs: performance.now() - started };
    },
  };
}
