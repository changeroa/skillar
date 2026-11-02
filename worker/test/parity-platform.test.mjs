import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";

test("D1 supports weighted trigram ranking, JSON null and transactional trigger rollback", async t => {
  // Given: the actual workerd D1 implementation, not a SQLite-shaped mock.
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    workers: [{ config: {
      type: "worker", name: "parity-platform", compatibilityDate: "2026-09-03",
      manifest: { mainModule: "index.js", modules: {
        "index.js": { type: "esm", contents: "export default { fetch() { return new Response('probe'); } }" },
      } },
      env: { PROBE: { type: "d1", name: "parity-platform" } }, exports: {},
    } }],
  });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("PROBE");
  const sql = await readFile(new URL("../scripts/parity-probe.sql", import.meta.url), "utf8");
  const local = new DatabaseSync(":memory:");
  t.after(() => local.close());
  local.exec(sql);
  // D1 exec is line-oriented; preserve the trigger as a single statement.
  const statements = sql.replace(/^--.*$/gm, "").split(/;\s*(?:\n|$)/)
    .map(value => value.trim()).filter(Boolean);
  const triggerStart = statements.findIndex(value => value.startsWith("CREATE TRIGGER"));
  statements.splice(triggerStart, 2, `${statements[triggerStart]}; END`);
  // When
  const results = await db.batch(statements.map(value => db.prepare(value)));
  // Then
  const ranks = results.find(value => value.results?.[0]?.score !== undefined).results;
  assert.deepEqual(ranks.map(row => row.uri), ["skill://probe/name", "skill://probe/body"]);
  assert.ok(ranks[0].score < ranks[1].score);
  const localRanks = local.prepare(`SELECT uri, bm25(parity_fts, 0, 8, 2, 3, 5, 6, 1) AS score
    FROM parity_fts WHERE parity_fts MATCH '"workflow"' ORDER BY score`).all();
  assert.deepEqual(ranks.map(row => ({ uri: row.uri, score: row.score })),
    localRanks.map(row => ({ uri: row.uri, score: row.score })));
  const json = results.find(value => value.results?.[0]?.sql_lower !== undefined).results[0];
  assert.equal(json.unknown, null);
  assert.equal(json.zero, 0);
  assert.notEqual(json.sql_lower, "İSTANBUL".toLowerCase(),
    "SQL lower is not the JS Unicode substring predicate; remote q must use exact Worker calculation");
  assert.deepEqual(results.find(value => value.results?.[0]?.uri && value.results[0].score === undefined).results,
    [{ uri: "skill://probe/name" }]);
  assert.equal(results.at(-1).results[0].indexed_rows, 1);
  assert.ok(results.at(-1).meta.size_after > 0);
  assert.ok(results.some(value => value.meta.rows_written > 0));
  assert.ok(results.some(value => value.meta.rows_read > 0));
});

test("D1 batch rolls back both rows and trigger effects when a statement fails", async t => {
  // Given
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    workers: [{ config: {
      type: "worker", name: "parity-rollback", compatibilityDate: "2026-09-03",
      manifest: { mainModule: "index.js", modules: {
        "index.js": { type: "esm", contents: "export default { fetch() { return new Response('probe'); } }" },
      } },
      env: { PROBE: { type: "d1", name: "parity-rollback" } }, exports: {},
    } }],
  });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("PROBE");
  await db.batch([
    db.prepare("CREATE TABLE facts (id TEXT PRIMARY KEY, revision INTEGER)"),
    db.prepare("CREATE TABLE audit (id TEXT)"),
    db.prepare("CREATE TRIGGER changed AFTER INSERT ON facts BEGIN INSERT INTO audit VALUES (NEW.id); END"),
  ]);
  // When
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO facts VALUES ('same', 1)"),
    db.prepare("INSERT INTO facts VALUES ('same', 2)"),
  ]), /UNIQUE/);
  // Then
  assert.equal(await db.prepare("SELECT COUNT(*) FROM facts").first("COUNT(*)"), 0);
  assert.equal(await db.prepare("SELECT COUNT(*) FROM audit").first("COUNT(*)"), 0);
});
