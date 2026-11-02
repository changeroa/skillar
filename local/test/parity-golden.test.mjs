import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { PACKAGE_ROOT, distImport, makeTempDir, removeDir } from "./_helpers.mjs";

const { openDb, SCHEMA_VERSION } = await distImport("store/db.js");
const { createStore } = await distImport("store/index.js");
const { FtsIndex, ftsTokens } = await distImport("search/fts.js");
const { createSearchIndex } = await distImport("search/index.js");

const fixture = (name) => JSON.parse(readFileSync(new URL(`../shared/parity-fixtures/${name}.json`, PACKAGE_ROOT), "utf8"));
const substring = fixture("session-substring");
const migrations = fixture("migrations");
const recording = fixture("recording-order");
const ranking = fixture("search-ranking");
const rows = (db, sql) => db.prepare(sql).all().map((row) => ({ ...row }));
const expand = (value) => typeof value === "string" ? value : value.repeat.repeat(value.count) + value.suffix;
const scopeFacts = ({ eventIds, priorEventIds, boundary }) => ({ eventIds, priorEventIds, boundary });
const ref = { runtime: "codex", conversationId: "conversation" };
const attr = { sessionId: "s", method: "runtime_id" };

function memoryStore(t, options = {}) {
  const db = openDb(":memory:");
  const store = createStore(db, { now: () => 1200, tz: "UTC", ...options });
  t.after(() => store.close());
  return { db, store };
}

function entry(value) {
  return {
    rootId: "parity", dir: value.uri, name: "", description: "", tags: [], examples: [], aliasesKo: [],
    invocation: "automatic", bodyHead: "", digest: "sha256:fixture", manifestDigest: "sha256:manifest",
    resources: [], mtimeMs: 0, ...value,
  };
}

function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-15, Math.abs(expected) * 1e-12),
    `${label}: expected ${expected}, got ${actual}`);
}

test("parity 001-006: fresh Store installs the real migration registry", (t) => {
  const { db } = memoryStore(t);
  assert.equal(SCHEMA_VERSION, 6);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 6);
  const indexes = rows(db, "SELECT name FROM sqlite_master WHERE type='index'").map((row) => row.name);
  for (const index of migrations.indexes) assert.ok(indexes.includes(index), index);
  assert.deepEqual(rows(db, "PRAGMA foreign_key_check"), []);
});

for (const version of [1, 2, 3, 4, 5, 6]) {
  test(`parity 001-006: v${version} upgrade and reopen preserve explicit legacy goldens`, (t) => {
    const dir = makeTempDir("skillar-parity-migration-");
    t.after(() => removeDir(dir));
    const path = join(dir, "legacy.db");
    const old = new DatabaseSync(path);
    try {
      old.exec("PRAGMA foreign_keys=ON");
      for (let step = 1; step <= version; step++) {
        old.exec(readFileSync(new URL(`dist/store/${migrations.files[step - 1]}`, PACKAGE_ROOT), "utf8"));
        old.exec(`PRAGMA user_version=${step}`);
        for (const seed of migrations.seed.filter((seed) => seed.after === step)) old.exec(seed.sql);
      }
    } finally { old.close(); }
    for (let reopen = 0; reopen < 2; reopen++) {
      const db = openDb(path);
      const store = createStore(db, { now: () => 1100 });
      try {
        assert.equal(db.prepare("PRAGMA user_version").get().user_version, 6);
        for (const check of migrations.checks) {
          // A v1 snapshot has no topology or spans to preserve.
          if (version === 1 && /^(003|005|006-no-invented-order|006-span-mark)/.test(check.id)) continue;
          assert.deepEqual(rows(db, check.sql), check.expected, check.id);
        }
        assert.deepEqual(rows(db, "PRAGMA foreign_key_check"), []);
        if (version >= 2) {
          assert.deepEqual(scopeFacts(store.flowEventScope("legacy")), migrations.legacyScope);
          const { row: spec } = store.putWorkflowSpec({ name: "future", steps: [] });
          const { flow } = store.createFlow({ workspaceId: "w", specId: spec.id });
          assert.deepEqual(scopeFacts(store.flowEventScope(flow.id)), migrations.futureScope);
          // Remove only the newly generated flow so the second open sees the same historical snapshot.
          db.prepare("DELETE FROM flows WHERE id=?").run(flow.id);
        }
      } finally { store.close(); }
    }
  });
}

test("parity 002/004: source deduplication, candidate update and cascade are live SQLite behavior", (t) => {
  const { db, store } = memoryStore(t);
  db.exec("INSERT INTO sessions(id,runtime,started_at) VALUES ('s','codex',900)");
  const event = { id: "resolved", ts: 1050, kind: "load", source: "mcp", ref, sourceKey: "source-load",
    data: { attributionCandidates: ["s", "b"] } };
  assert.equal(store.append(event, { sessionId: "unattributed", method: "none", reason: "ambiguous" }), true);
  assert.equal(store.append({ ...event, id: "replay" }, attr), recording.duplicateResult);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1);
  db.prepare("UPDATE events SET data_json=? WHERE id='resolved'").run(JSON.stringify({ attributionCandidates: ["b"] }));
  assert.deepEqual(rows(db, "SELECT load_id,session_id,ts FROM load_candidates ORDER BY session_id"), migrations.candidateUpdate);
  db.exec("DELETE FROM events WHERE id='resolved'");
  assert.deepEqual(rows(db, "SELECT * FROM load_candidates"), []);
  // NULL source keys remain independent, unlike a known source identity.
  for (const id of ["no-key-a", "no-key-b"]) {
    assert.equal(store.append({ ...event, id, sourceKey: undefined, data: {} }, attr), true);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 2);
});

for (const check of substring.cases) {
  test(`parity Unicode session substring: ${check.id}`, (t) => {
    const { db, store } = memoryStore(t);
    for (const session of substring.sessions) {
      db.prepare("INSERT INTO sessions(id,runtime,started_at,first_prompt) VALUES (?,'codex',900,?)")
        .run(session.id, session.firstPrompt);
      for (const [i, event] of (session.events ?? []).entries()) {
        const data = { ...event.data };
        if (data.query !== undefined) data.query = expand(data.query);
        store.append({ id: `${session.id}-${i}`, ts: 1000 + i, source: "hook", ref, ...event,
          ...(event.text !== undefined ? { text: expand(event.text) } : {}), data },
        { sessionId: session.id, method: "runtime_id" });
      }
    }
    const actual = store.sessions({ q: expand(check.q), automated: "include" }).map((row) => row.id).sort();
    assert.deepEqual(actual, [...check.expected].sort());
  });
}

test("parity unknown is not zero: attribution rates and optional span timestamps", (t) => {
  const { db, store } = memoryStore(t);
  db.exec("INSERT INTO sessions(id,runtime,conversation_id,started_at) VALUES ('s','codex','conversation',0)");
  store.append({ id: "orphan", ts: 0, kind: "search", source: "mcp", ref: { runtime: "codex" }, data: {} },
    { sessionId: "unattributed", method: "none" });
  store.append({ id: "attributed", ts: 0, kind: "search", source: "mcp", ref: { runtime: "claude-code" }, data: {} }, attr);
  const rates = store.stats().attributionRate;
  assert.deepEqual({ absent: rates.gemini, unattributed: rates.codex, attributed: rates["claude-code"] }, recording.nullStats);
  store.putSpans([
    { traceId: "times", spanId: "unknown", name: "tool", runtime: "codex", conversationId: "conversation", receivedAt: 0 },
    { traceId: "times", spanId: "zero", name: "tool", runtime: "codex", conversationId: "conversation", receivedAt: 0, startMs: 0, endMs: 0 },
  ]);
  assert.deepEqual(store.treeSessionData("s").spans.map(({ spanId, startMs, endMs }) => ({
    spanId, ...(startMs !== undefined ? { startMs } : {}), ...(endMs !== undefined ? { endMs } : {}),
  })), recording.spanTimes);
});

function sourceHistory(t) {
  const dir = makeTempDir("skillar-parity-order-");
  t.after(() => removeDir(dir));
  const db = openDb(join(dir, "source.db"));
  let clock = recording.start;
  const store = createStore(db, { now: () => clock });
  t.after(() => store.close());
  db.prepare("UPDATE recording_clock SET domain=?").run(recording.sourceDomain);
  db.exec(`INSERT INTO sessions(id,runtime,conversation_id,started_at) VALUES ('s','codex','conversation',900);
    INSERT INTO herdr_panes(id,workspace_id,created_ms) VALUES ('pane','w',0);
    INSERT INTO pane_sessions(pane_id,agent_session_value,session_id,source) VALUES ('pane','conversation','s','reported');`);
  const add = (event) => store.append({ ...event, kind: "llm_call", source: "otel", ref, data: {}, sourceKey: event.id }, attr);
  for (const event of recording.events.filter((event) => event.phase === "prior")) add(event);
  const { row: spec } = store.putWorkflowSpec({ name: "parity", steps: [] });
  const { flow } = store.createFlow({ workspaceId: "w", specId: spec.id });
  for (const event of recording.events.filter((event) => event.phase === "inside")) add(event);
  store.putSpans([{ traceId: "trace", spanId: "endpoint", name: "tool", runtime: "codex",
    conversationId: "conversation", startMs: recording.end, receivedAt: 0 }]);
  clock = recording.end;
  store.endFlow(flow.id);
  for (const event of recording.events.filter((event) => event.phase === "late")) add(event);
  return { db, store, dir, flowId: flow.id, add };
}

test("parity 006: equal timestamps use source recording cuts, not UUID order or receipt time", (t) => {
  const f = sourceHistory(t);
  assert.deepEqual(scopeFacts(f.store.flowEventScope(f.flowId)), recording.sourceScope);
  assert.deepEqual(f.store.flowEventScope(f.flowId).spanKeys, recording.spanKeys);
  assert.deepEqual(rows(f.db, "SELECT id,recording_orders_json FROM events ORDER BY rowid")
    .map(({ id, recording_orders_json }) => ({ id, orders: JSON.parse(recording_orders_json) })), recording.sourceOrders);
  assert.deepEqual(JSON.parse(f.db.prepare("SELECT recording_orders_json FROM otel_spans").get().recording_orders_json), recording.spanOrders);
  assert.equal(f.add(recording.events[1]), recording.duplicateResult);
  f.db.exec("BEGIN");
  f.add({ id: "rolled-back", ts: recording.end });
  f.db.exec("ROLLBACK");
  assert.equal(f.db.prepare("SELECT position FROM recording_clock").get().position, recording.rollbackPosition);
  f.db.exec("DELETE FROM events; DELETE FROM otel_spans; VACUUM");
  f.add({ id: "after-delete", ts: recording.end });
  assert.equal(f.db.prepare("SELECT position FROM recording_clock").get().position, recording.afterDeletePosition);
  assert.deepEqual(f.store.flowEventScope(f.flowId).eventIds, []);
  assert.throws(() => f.db.exec("UPDATE recording_clock SET position=0"), /moved backwards/);
  f.db.exec("UPDATE recording_clock SET position=9007199254740991");
  assert.throws(() => f.add({ id: "overflow", ts: recording.end }), /recording clock exhausted/);
  assert.equal(f.db.prepare("SELECT id FROM events WHERE id='overflow'").get(), undefined);
});

for (const collision of [false, true]) {
  test(`parity source domain survives Store export/import${collision ? " with unknown duplicate identity order" : ""}`, (t) => {
    const f = sourceHistory(t);
    const out = join(f.dir, "export");
    f.store.exportTo(out, { withHistory: true });
    const db = openDb(join(f.dir, "destination.db"));
    const store = createStore(db, { now: () => recording.end });
    t.after(() => store.close());
    db.prepare("UPDATE recording_clock SET domain=?").run(recording.destinationDomain);
    if (collision) {
      store.append({ id: "z-end", ts: recording.end, kind: "llm_call", source: "otel", ref, data: {} }, attr);
    }
    store.importFrom(out, { merge: true });
    assert.deepEqual(scopeFacts(store.flowEventScope(f.flowId)), collision ? recording.collisionScope : recording.foreignScope);
    for (const expected of recording.sourceOrders) {
      const orders = JSON.parse(db.prepare("SELECT recording_orders_json FROM events WHERE id=?").get(expected.id).recording_orders_json);
      if (collision && expected.id === "z-end") assert.equal(Object.hasOwn(orders, recording.sourceDomain), false);
      else assert.equal(orders[recording.sourceDomain], expected.orders[recording.sourceDomain], expected.id);
      assert.ok(Number.isSafeInteger(orders[recording.destinationDomain]) && orders[recording.destinationDomain] > 0);
    }
    const before = db.prepare("SELECT position FROM recording_clock").get().position;
    store.importFrom(out, { merge: true });
    assert.equal(db.prepare("SELECT position FROM recording_clock").get().position, before, "reimport consumes no order");
  });
}

for (const check of ranking.tokenCases) {
  test(`parity FTS token code-point minimum and normalization: ${check.q}`, () => {
    assert.deepEqual(ftsTokens(check.q), check.expected);
  });
}

test("parity real SQLite trigram recall stays within indexed fields and code-point limits", (t) => {
  const { db } = memoryStore(t);
  const fts = new FtsIndex(db);
  fts.upsert(ranking.recall.entries.map(entry));
  for (const check of ranking.recall.cases) {
    assert.deepEqual(fts.search(check.q).map((hit) => hit.uri), check.expected, check.q);
  }
});

test("parity weighted BM25, fused ranks and corpus profiles have independent explicit goldens", (t) => {
  const local = memoryStore(t);
  const expanded = memoryStore(t);
  const localIndex = createSearchIndex(local.db);
  const expandedIndex = createSearchIndex(expanded.db);
  const entries = ranking.entries.map(entry);
  const background = Array.from({ length: ranking.background.count }, (_, i) =>
    entry({ uri: `skill://background/${i}`, ...ranking.background.entry }));
  localIndex.rebuild(entries);
  expandedIndex.rebuild([...entries, ...background]);
  // Use both the real FtsIndex wrapper and the independently written literal SQL query.
  for (const [db, index, scoreKey] of [[local.db, localIndex, "bm25"], [expanded.db, expandedIndex, "expandedBm25"]]) {
    const fts = new FtsIndex(db);
    fts.upsert(entries);
    for (const query of [ranking.query, "ＱＵＡＲＴＺ"]) {
      const hits = fts.search(query);
      assert.deepEqual(hits.map(({ uri, rank, matched }) => ({ uri, rank, matched })),
        ranking.ftsExpected.map(({ uri, rank, matched }) => ({ uri, rank, matched })));
      hits.forEach((hit, i) => near(hit.bm25, ranking.ftsExpected[i][scoreKey], `${scoreKey} ${hit.uri}`));
      const outcome = index.search(query, { mode: "discovery", limit: 20 });
      assert.equal(outcome.abstained, undefined);
      assert.deepEqual(outcome.candidates.map(({ uri, rank, score }) => ({ uri, rank, score })), ranking.searchExpected);
    }
    const sql = db.prepare(`SELECT uri,bm25(skills_fts,0,8,2,3,5,6,1) AS score
      FROM skills_fts WHERE skills_fts MATCH ? ORDER BY score`).all('"quartz"');
    assert.deepEqual(sql.map(({ uri }) => uri), ranking.ftsExpected.map(({ uri }) => uri));
    sql.forEach((hit, i) => near(hit.score, ranking.ftsExpected[i][scoreKey], `SQL ${hit.uri}`));
    assert.equal(index.search(ranking.query, { mode: "discovery", limit: 2 }).candidates.length, 2);
    assert.equal(index.search("zzqx", { mode: "discovery", limit: 20 }).abstained.reason, "no_overlap");
  }
  assert.equal(local.db.prepare("SELECT COUNT(*) AS n FROM skills_fts").get().n, 6);
  assert.equal(expanded.db.prepare("SELECT COUNT(*) AS n FROM skills_fts").get().n, 13);
  // A second profile rebuild cannot alter the first profile's IDF or result ranks.
  expandedIndex.rebuild(background);
  const localHits = new FtsIndex(local.db).search(ranking.query);
  localHits.forEach((hit, i) => near(hit.bm25, ranking.ftsExpected[i].bm25, `isolated ${hit.uri}`));
  assert.deepEqual(expandedIndex.search(ranking.query, { mode: "discovery", limit: 20 }).candidates, []);
});
