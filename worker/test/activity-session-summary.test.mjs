// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CHIP_ID_CHUNK, D1_MAX_BOUND_PARAMETERS, chipsSql, filterOptionsSql, sessionCountSql, sessionListSql } from "../src/activity/session-sql.ts";

const sql = name => readFile(new URL(`../activity-migrations/${name}`, import.meta.url), "utf8");
async function open() {
  const db = new DatabaseSync(":memory:");
  for (const n of ["0001_activity_ledger.sql", "0014_session_index.sql", "0016_session_activity.sql"]) db.exec(await sql(n));
  return db;
}
const SCOPE = ["a", 1, "d", "x"];
const putEvent = (db, key, session, kind, ts, rev = 1, acct = "a") => db.prepare(
  `INSERT INTO event_facts (account_id,generation,device_id,source_domain,entity_key,revision,facts_json,timestamp_ms,
     recording_orders_json,session_id,kind) VALUES (?,?,?,?,?,?,'{}',?,'{}',?,?)
   ON CONFLICT(account_id,generation,device_id,source_domain,entity_key) DO UPDATE SET revision=excluded.revision,
     timestamp_ms=excluded.timestamp_ms,session_id=excluded.session_id,kind=excluded.kind
   WHERE excluded.revision>event_facts.revision`).run(acct, 1, "d", "x", key, rev, ts, session, kind);
const putSession = (db, id, started, runtime) => db.prepare(
  `INSERT INTO session_facts (account_id,generation,device_id,source_domain,entity_key,revision,facts_json,runtime,started_ms)
   VALUES ('a',1,'d','x',?,1,'{}',?,?) ON CONFLICT(account_id,generation,device_id,source_domain,entity_key)
   DO UPDATE SET runtime=excluded.runtime,started_ms=excluded.started_ms`).run(id, runtime, started);
const summary = (db, acct = "a") => db.prepare(`SELECT session_id s,first_event_ms f,last_event_ms l,events e,reads r,searches q,started_ms st,runtime rt
  FROM session_activity WHERE account_id=? ORDER BY session_id`).all(acct).map(r => ({ ...r }));
// 요약은 항상 event_facts에서 처음부터 다시 센 값과 같아야 한다.
const recomputed = db => db.prepare(`SELECT account_id,session_id s,MIN(timestamp_ms) f,MAX(timestamp_ms) l,COUNT(*) e,
  SUM(kind='load') r,SUM(kind='search') q FROM event_facts WHERE session_id IS NOT NULL
  GROUP BY account_id,session_id ORDER BY account_id,session_id`).all()
  .map(r => ({ ...r })).filter(r => r.account_id === "a").map(({ account_id, ...r }) => r);
const core = rows => rows.map(({ st, rt, ...r }) => r);

test("summary follows insert, retry, revision update, session move, delete; started/runtime stay NULL until a real row exists", async () => {
  const db = await open();
  putEvent(db, "e1", "s1", "search", 10); putEvent(db, "e2", "s1", "load", 30); putEvent(db, "e3", "s2", "search", 5);
  putEvent(db, "e2", "s1", "load", 30); // 같은 revision 재시도: 증감 없음
  assert.deepEqual(summary(db), [
    { s: "s1", f: 10, l: 30, e: 2, r: 1, q: 1, st: null, rt: null },
    { s: "s2", f: 5, l: 5, e: 1, r: 0, q: 1, st: null, rt: null }]);
  putSession(db, "s1", 7, "codex"); putSession(db, "s2", 1, "unknown");
  assert.deepEqual(summary(db).map(r => [r.s, r.st, r.rt]), [["s1", 7, "codex"], ["s2", 1, null]]);
  putEvent(db, "e2", "s1", "search", 40, 2);       // kind·시각 갱신
  putEvent(db, "e3", "s1", "load", 12, 2);         // 세션 이동 s2 → s1 (s2는 비어 사라진다)
  assert.deepEqual(core(summary(db)), recomputed(db));
  assert.deepEqual(summary(db).map(r => [r.s, r.f, r.l, r.e, r.r, r.q]), [["s1", 10, 40, 3, 1, 2]]);
  db.prepare("DELETE FROM event_facts WHERE entity_key='e2'").run();
  assert.deepEqual(core(summary(db)), recomputed(db));
  assert.deepEqual(summary(db).map(r => [r.s, r.f, r.l, r.e]), [["s1", 10, 12, 2]]);
  db.prepare("DELETE FROM session_facts WHERE entity_key='s1'").run();
  assert.deepEqual(summary(db).map(r => [r.st, r.rt]), [[null, null]]);
  db.prepare("DELETE FROM event_facts").run();
  assert.deepEqual(summary(db), []);
});

test("scopes are isolated and a mixed random workload always equals a fresh recomputation", async () => {
  const db = await open();
  putEvent(db, "e1", "s1", "load", 1, 1, "b"); putEvent(db, "e1", "s1", "search", 2);
  assert.equal(summary(db, "b")[0].e, 1);
  assert.equal(summary(db, "a")[0].q, 1);
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const rev = new Map();
  for (let i = 0; i < 400; i++) {
    const key = `k${rnd(25)}`;
    if (rnd(5) === 0) db.prepare("DELETE FROM event_facts WHERE account_id='a' AND entity_key=?").run(key);
    else { const r = (rev.get(key) ?? 1) + 1; rev.set(key, r); putEvent(db, key, `s${rnd(6)}`, ["load", "search", "x", null][rnd(4)], rnd(100), r); }
    if (i % 25 === 0) assert.deepEqual(core(summary(db)), recomputed(db));
  }
  assert.deepEqual(core(summary(db)), recomputed(db));
  assert.equal(summary(db, "b").length, 1);
});

test("list/count/facet/filter-options plans: summary indexes only, no table or event scans; keyset pages", async () => {
  const db = await open();
  for (let s = 0; s < 120; s++) {
    for (let k = 0; k < 20; k++) putEvent(db, `e${s}-${k}`, `s${String(s).padStart(3, "0")}`, k === 0 && s % 3 === 0 ? "load" : "search", s * 1000 + k);
  }
  const plan = (q, args) => db.prepare(`EXPLAIN QUERY PLAN ${q}`).all(...args).map(r => r.detail).join("|");
  const cases = [
    ["list", sessionListSql({}, false), [...SCOPE, 50], /session_activity_recent/],
    ["list cursor", sessionListSql({}, true), [...SCOPE, 5000, 5000, "s010", 50], /session_activity_recent/],
    ["list period", sessionListSql({ activeFromMs: 0, activeToMs: 9e9 }, false), [...SCOPE, 0, 9e9, 50], /session_activity_recent/],
    ["list facet", sessionListSql({ searchWithoutRead: true }, false), [...SCOPE, 50], /session_activity_search_no_read/],
    ["count", sessionCountSql({}), SCOPE, /session_activity/],
    ["count facet", sessionCountSql({ searchWithoutRead: true }), SCOPE, /session_activity_search_no_read/],
    ["filter-options", filterOptionsSql, SCOPE, /session_activity/],
  ];
  for (const [name, q, args, want] of cases) {
    const p = plan(q, args);
    assert.match(p, want, `${name}: ${p}`);
    assert.doesNotMatch(p, /SCAN (event_facts|session_facts)|SCAN session_activity(?! USING)/, `${name}: ${p}`);
    assert.doesNotMatch(p, /event_facts/, `${name}: ${p}`);
  }
  const ins = (t, sid, skill, dg, ms, n) => db.prepare(`INSERT INTO ${t} (account_id,generation,device_id,source_domain,session_id,skill_id,digest,first_read_ms,reads)
    VALUES ('a',1,'d','x',?,?,?,?,?)`).run(sid, skill, dg, ms, n);
  ins("session_skill_reads", "s001", "k1", "", 5, 2); ins("session_skill_reads_backfill", "s001", "k1", "", 3, 1);
  ins("session_skill_reads_backfill", "s001", "k2", "dg", 4, 1);
  const chipArgs = [...SCOPE, "s001", "s002"];
  const rowsOf = t => db.prepare(chipsSql(t, 2)).all(...chipArgs).map(r => ({ ...r }));
  assert.deepEqual(rowsOf("session_skill_reads"), [{ sessionId: "s001", skillId: "k1", digest: "", firstReadMs: 5, reads: 2 }]);
  assert.deepEqual(rowsOf("session_skill_reads_backfill").map(r => r.skillId).sort(), ["k1", "k2"]);
  for (const t of ["session_skill_reads", "session_skill_reads_backfill"]) {
    const cp = plan(chipsSql(t, 2), chipArgs);
    assert.doesNotMatch(cp, /SCAN session_skill_reads(_backfill)?(?! USING)/, cp);
    assert.match(cp, /SEARCH session_skill_reads(_backfill)? USING (COVERING )?INDEX sqlite_autoindex/, cp);
  }
  // 회귀: 목록 한 쪽 최대 100행에서 한 질의의 바인딩 수가 D1 한도(100)를 넘지 않는다(운영 503).
  for (const n of [50, 100, CHIP_ID_CHUNK]) {
    for (let from = 0; from < n; from += CHIP_ID_CHUNK) {
      const count = Math.min(CHIP_ID_CHUNK, n - from);
      assert.ok(4 + count <= D1_MAX_BOUND_PARAMETERS, `chips ${n}`);
      assert.equal((chipsSql("session_skill_reads", count).match(/\?/g) ?? []).length, 4 + count);
    }
  }
  assert.ok((sessionListSql({ runtimes: Array(20).fill("r"), activeFromMs: 1, activeToMs: 2 }, true).match(/\?/g) ?? []).length + 4 <= D1_MAX_BOUND_PARAMETERS);
  const first = db.prepare(sessionListSql({}, false)).all(...SCOPE, 50).map(r => r.sessionId);
  assert.equal(first.length, 50);
  assert.deepEqual(first.slice(0, 2), ["s119", "s118"]);
  const last = db.prepare("SELECT last_event_ms l FROM session_activity WHERE session_id=?").get(first[49]).l;
  const next = db.prepare(sessionListSql({}, true)).all(...SCOPE, last, last, first[49], 50).map(r => r.sessionId);
  assert.equal(next[0], "s069");
  assert.equal(db.prepare(sessionCountSql({ searchWithoutRead: true })).get(...SCOPE).total, 80);
  assert.equal(db.prepare(sessionCountSql({})).get(...SCOPE).total, 120);
  // 2400 이벤트 행이어도 목록은 세션 요약 행만 본다(요약 표 행 수 = 세션 수).
  assert.equal(db.prepare("SELECT COUNT(*) c FROM session_activity").get().c, 120);
  // facet 의미: 검색≥1, 읽기 0
  const facet = db.prepare(sessionListSql({ searchWithoutRead: true }, false)).all(...SCOPE, 200);
  assert.ok(facet.every(r => r.searches > 0 && r.reads === 0));
});
