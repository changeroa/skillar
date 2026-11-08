// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { entry, fixture, json, local, queries, result } from "./helpers/private-skill-search.mjs";

test("native trigram search equals Local across the benchmark corpus and query contract", async t => {
  // Given the same opaque URIs, complete corpus and existing Local benchmark queries.
  const catalog = await json("../../../local/bench/catalog.json");
  const entries = catalog.map((e, i) => entry(`opaque-${i}`, {
    name: e.name, description: e.description, examples: e.examples ?? [],
    aliasesKo: [...(e.keywords ?? []), ...(e.aliases_ko ?? [])],
    invocation: e.automatic ? "automatic" : "explicit", digest: e.digest,
  }));
  const cases = (await Promise.all(["search-cases", "paraphrase-cases", "real-log-cases"]
    .map(name => json(`../../../local/bench/${name}.json`)))).flat();
  const requests = queries([...cases.map(c => c.query), ...entries.map(e => e.name),
    "", " \n\t", "메", "메시", "메시지", "the and please", "zzqxv991", '"query"', "ＱＵＥＲＹ"]);
  const reference = await local(t, entries), native = await fixture(t);
  await native.rebuild(entries);
  // When each mode and limit executes in real workerd SQLite.
  const actual = await native.search(requests);
  // Then all public fields except execution-specific tracing/timing match exactly.
  assert.deepEqual(actual.map(result), reference.search(requests));
  assert.ok(actual.every(o => typeof o.traceId === "string" && Number.isFinite(o.elapsedMs) && o.elapsedMs >= 0));
});

test("native FTS preserves weighted BM25 and account-specific corpus statistics", async t => {
  // Given hand-derived BM25 expectations and a separate object's much larger corpus.
  const data = await json("../../../shared/parity-fixtures/search-ranking.json");
  const entries = data.entries.map(e => entry(e.uri.split("/").at(-1), e));
  const native = await fixture(t), reference = await local(t, entries);
  await native.rebuild(entries);
  const ask = queries(["quartz"]);
  const before = await native.search(ask);
  await native.rebuild([...entries, ...Array.from({ length: 70 }, (_, i) =>
    entry(`unrelated-${i}`, { name: "bbbbbb", description: "cccccc" }))], undefined, "account-b");
  // When the other account searches and account A searches again.
  const other = await native.search(ask, "account-b");
  const after = await native.search(ask);
  const aFts = await native.send("account-a", { kind: "fts", query: "quartz" });
  const bFts = await native.send("account-b", { kind: "fts", query: "quartz" });
  // Then unrelated documents cannot affect A's scores, matches, order or raw BM25.
  assert.deepEqual(before.map(result), reference.search(ask));
  assert.deepEqual(after.map(result), before.map(result));
  assert.deepEqual(aFts.map(r => r.uri), data.ftsExpected.map(r => r.uri));
  for (const [i, row] of aFts.entries()) assert.ok(Math.abs(row.score - data.ftsExpected[i].bm25) < 1e-18);
  assert.notEqual(aFts[0].score, bFts[0].score, "B has its own real BM25 corpus");
  assert.deepEqual(other.map(o => o.candidates.map(c => c.uri)), before.map(o => o.candidates.map(c => c.uri)));
});

test("native tie order and recall survive reconstruction and actual object eviction", async t => {
  // Given FTS-only equal-weight hits in reverse URI order and Korean/emoji field boundaries.
  const entries = [
    entry("z", { bodyHead: "quartz" }), entry("a", { bodyHead: "quartz" }),
    entry("korean", { aliasesKo: ["커밋 메시지"], whenToUse: "메시지 편집" }),
    entry("emoji", { bodyHead: "😀😀😀" }), entry("split", { name: "메시", description: "지" }),
    entry("stopword", { name: "how-to" }),
  ];
  const native = await fixture(t), reference = await local(t, entries);
  const ask = queries(["quartz", "메시지", "메시지를 다듬어줘", "메", "메시", "메시 지", "😀😀", "😀😀😀", "how-to"]);
  await native.rebuild(entries);
  const boot = await native.send("account-a", { kind: "inspect" });
  await native.send("account-a", { kind: "reconstruct" });
  await native.evict();
  // When a new object instance hydrates the persisted projection.
  const actual = await native.search(ask);
  // Then rowid-sensitive FTS order, lexical state, arrays and matched terms are unchanged.
  assert.deepEqual(actual.map(result), reference.search(ask));
  assert.notEqual((await native.send("account-a", { kind: "inspect" })).boot, boot.boot);
  assert.deepEqual(actual[1].candidates.map(c => c.uri), ["skill://remote/z", "skill://remote/a"]);
});

test("threshold and explicit-only abstention preserve Local precedence after eviction", async t => {
  // Given an explicit-only match and a score strictly below the persisted threshold.
  const entries = [
    entry("release", { aliasesKo: ["롤백 절차"], invocation: "explicit" }),
    entry("logs", { description: "Read error patterns" }),
  ];
  const native = await fixture(t), reference = await local(t, entries);
  reference.threshold(1.01);
  await native.rebuild(entries, 1.01);
  await native.evict();
  const ask = queries(["롤백 절차", "error patterns", "", "zzqxv991", "the and please"]);
  // When the query contract is applied against the hydrated threshold.
  const actual = await native.search(ask);
  // Then policy filtering precedes threshold checks, and all abstentions match.
  assert.deepEqual(actual.map(result), reference.search(ask));
  assert.ok(actual.some(o => o.abstained?.reason === "explicit_only"));
  assert.ok(actual.some(o => o.abstained?.reason === "below_threshold"));
  assert.ok(actual.some(o => o.abstained?.reason === "empty_query"));
  assert.ok(actual.some(o => o.abstained?.reason === "no_overlap"));
});

test("complete rebuild replaces heads and preserves separately supplied digest pins", async t => {
  // Given a head and immutable digest pin for the same logical skill.
  const head = entry("opaque-head", { name: "deploy", digest: "digest-old", bodyHead: "oldmarker" });
  const pin = entry("opaque-pin", { name: "deploy", digest: "digest-old", bodyHead: "oldmarker" });
  const next = { ...head, digest: "digest-new", bodyHead: "newmarker" };
  const native = await fixture(t), reference = await local(t, [head, pin]);
  await native.rebuild([head, pin, entry("removed", { bodyHead: "removedmarker" })]);
  reference.index.rebuild([next, pin]);
  // When authority supplies the new complete projection and the object is evicted.
  await native.rebuild([next, pin]);
  await native.evict();
  const ask = queries(["deploy", "oldmarker", "newmarker", "removedmarker"]);
  const actual = await native.search(ask);
  // Then candidates bind the supplied URI to the correct digest with no deleted remnants.
  assert.deepEqual(actual.map(result), reference.search(ask));
  assert.deepEqual(actual[1].candidates.map(c => [c.uri, c.digest]),
    [["skill://remote/opaque-head", "digest-new"], ["skill://remote/opaque-pin", "digest-old"]]);
});
