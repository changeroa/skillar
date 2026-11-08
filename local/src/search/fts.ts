import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { SkillEntry, SkillUri } from "../types.js";
import { normalize } from "./lexical.js";
import { FTS_INSERT, FTS_DELETE, FTS_SEARCH, ftsFields, ftsTokens, ftsMatchExpression, ftsHits } from "../../../shared/dist/private-search.js";
import type { FtsHit } from "../../../shared/dist/private-search.js";
export { FTS_MIN_CHARS, ftsTokens, ftsMatchExpression } from "../../../shared/dist/private-search.js";
export type { FtsHit } from "../../../shared/dist/private-search.js";

export class FtsIndex {
  private readonly insertStmt: StatementSync;
  private readonly deleteStmt: StatementSync;
  private readonly searchStmt: StatementSync;
  private readonly texts = new Map<SkillUri, string>();

  constructor(private readonly db: DatabaseSync) {
    this.insertStmt = db.prepare(FTS_INSERT);
    this.deleteStmt = db.prepare(FTS_DELETE);
    // bm25 weights follow column order: uri, name, description, when_to_use, examples, aliases_ko, body_head.
    this.searchStmt = db.prepare(FTS_SEARCH);
  }

  clear(): void {
    this.db.exec("DELETE FROM skills_fts");
    this.texts.clear();
  }

  remove(uris: SkillUri[]): void {
    for (const uri of uris) { this.deleteStmt.run(uri); this.texts.delete(uri); }
  }

  upsert(entries: SkillEntry[]): void {
    for (const e of entries) {
      this.deleteStmt.run(e.uri);
      const fields = ftsFields(e);
      this.insertStmt.run(e.uri, ...fields);
      this.texts.set(e.uri, normalize(fields.join(" ")));
    }
  }

  search(query: string, limit = 50): FtsHit[] {
    const tokens = ftsTokens(query);
    if (!tokens.length) return [];
    const rows = this.searchStmt.all(ftsMatchExpression(tokens), limit).map(row => {
      if (typeof row.uri !== "string" || typeof row.score !== "number") throw new TypeError("Invalid SQLite FTS row");
      return { uri: row.uri, score: row.score };
    });
    return ftsHits(rows, tokens, this.texts);
  }
}
