import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  buildSearchCore, normalize, ftsTokens, ftsMatchExpression, ftsFields, ftsHits,
  FTS_SCHEMA, FTS_INSERT, FTS_SEARCH, terms,
} from "../dist/private-search.js";

test("portable core preserves independently derived field-weight scores and ranks", async t => {
  // Given equal-length documents with one quartz phrase each and the Local trigram options.
  const data = JSON.parse(await readFile(new URL("../parity-fixtures/search-ranking.json", import.meta.url), "utf8"));
  const entries = data.entries.map(e => ({
    description: "", examples: [], aliasesKo: [], invocation: "automatic", bodyHead: "", digest: "pin", ...e,
  }));
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(FTS_SCHEMA);
  const texts = new Map();
  for (const e of entries) {
    db.prepare(FTS_INSERT).run(e.uri, ...ftsFields(e));
    texts.set(e.uri, normalize(ftsFields(e).join(" ")));
  }
  const search = buildSearchCore(entries, { search(query) {
    const tokens = ftsTokens(query);
    const rows = db.prepare(FTS_SEARCH).all(ftsMatchExpression(tokens), 50);
    return ftsHits(rows, tokens, texts);
  } });
  // When both real SQLite FTS and lexical channels rank the identical phrase.
  const actual = search("quartz", { mode: "discovery", limit: 10 });
  // Then the fixed-point scores and ranks match the mathematical fixture, not generated output.
  assert.deepEqual(actual.candidates.map(({ uri, rank, score }) => ({ uri, rank, score })), data.searchExpected);
  assert.deepEqual(actual.candidates.map(c => c.matched), entries.map(() => ["quartz"]));
  assert.ok(actual.candidates.every(c => c.digest === "pin"));
});

test("portable tokenizer preserves Korean short-query and Unicode boundaries", () => {
  // Given short codepoint lengths, full-width Latin, quotes and Korean particles.
  const cases = [
    ["메", []], ["메시", []], ["메시지", ["메시지"]],
    ["😀😀", []], ["😀😀😀", ["😀😀😀"]], ["ＱＵＡＲＴＺ", ["quartz"]],
    ['"quartz"', ["quartz", '"quartz"']],
  ];
  // When normalized FTS tokens and lexical terms are computed.
  const actual = cases.map(([q]) => ftsTokens(q));
  const lexical = terms("메시지를 API가 react 19로");
  // Then short FTS inputs do not recall partial trigrams and stems remain lexical.
  assert.deepEqual(actual, cases.map(([, expected]) => expected));
  assert.deepEqual(lexical, ["메시지", "api", "react", "19"]);
  assert.equal(ftsMatchExpression(['"quartz"', "메시지"]), '"""quartz""" OR "메시지"');
});
