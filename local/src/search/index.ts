import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { DatabaseSync } from "node:sqlite";
import type { CatalogDelta, SearchIndex, SearchMode, SearchOutcome, SkillEntry, SkillUri } from "../types.js";
import { FtsIndex } from "./fts.js";
import { DEFAULT_THRESHOLD } from "./fusion.js";
import { buildSearchCore } from "../../../shared/dist/private-search.js";

export { DEFAULT_THRESHOLD, RRF_K, calibrate, fuse, termCoverage } from "./fusion.js";
export { SEARCH_TOOL_GUIDANCE, ABSTAIN_HINTS } from "./guidance.js";
export { normalize, terms } from "./lexical.js";
export { ftsTokens } from "./fts.js";

export function createSearchIndex(db: DatabaseSync): SearchIndex {
  const entries = new Map<SkillUri, SkillEntry>();
  const fts = new FtsIndex(db);
  let search = buildSearchCore([], fts);
  const thresholdStmt = db.prepare("SELECT value FROM meta WHERE key = 'search_threshold'");

  const threshold = () => {
    const row = thresholdStmt.get();
    const value = row?.value == null ? NaN : Number(row.value);
    return Number.isFinite(value) ? value : DEFAULT_THRESHOLD;
  };

  const transaction = (fn: () => void) => {
    db.exec("BEGIN");
    try { fn(); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
  };

  return {
    rebuild(list) {
      transaction(() => { fts.clear(); fts.upsert(list); });
      entries.clear();
      for (const e of list) entries.set(e.uri, e);
      search = buildSearchCore([...entries.values()], fts);
    },

    apply(delta: CatalogDelta) {
      const upserts = [...delta.added, ...delta.changed];
      transaction(() => { fts.remove(delta.removed); fts.upsert(upserts); });
      for (const uri of delta.removed) entries.delete(uri);
      for (const e of upserts) entries.set(e.uri, e);
      search = buildSearchCore([...entries.values()], fts);
    },

    search(query: string, opts: { mode: SearchMode; limit: number }): SearchOutcome {
      const started = performance.now();
      const traceId = randomUUID();
      return {
        traceId, query, mode: opts.mode, ...search(query, opts, threshold()),
        elapsedMs: performance.now() - started,
      };
    },
  };
}
