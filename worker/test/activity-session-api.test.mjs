// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { fixture as migrationFixture, snapshot, ref } from "./helpers/activity-migrations.mjs";
import { packet } from "./helpers/activity-content.mjs";

const row = (table, key, values, revision = 1) => ({ table, key: JSON.stringify([key]), revision,
  operation: "upsert", sourceOrder: 1, values });
// 수집 배치의 행은 journal (from, through] 범위의 revision이어야 한다(from=1, through=2 → 2).
const row2 = (table, key, values) => row(table, key, values, 2);
const SKILL = "skill://private/00000000-0000-4000-8000-000000000001/aaaa/skill.md";
const SKILL2 = "skill://private/00000000-0000-4000-8000-000000000002/bbbb/skill.md";
const DAY = 86_400_000, START = 10000;
// worker skill-usage.ts kstDay와 같은 정의(KST=UTC+9 고정).
const kstDay = ms => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
// 리드 결정(2026-11-20): 이벤트 단위 집계 — 이벤트의 ts(KST 일자)와 runtime(에이전트)을 쓴다.
const ev = (id, kind, ts, runtime, { uri = null, data = {}, revision, sessionId } = {}) =>
  (revision === undefined ? row2 : (t, k, v) => row(t, k, v, revision))("events", id,
    { id, session_id: sessionId ?? `sess-${id}`, kind, ts, runtime, skill_uri: uri,
      data_json: JSON.stringify(data) });
const sess = (id, clientName, revision) =>
  (revision === undefined ? row2 : (t, k, v) => row(t, k, v, revision))("sessions", id,
    { id, runtime: "unknown", client_name: clientName, started_at: 1000, ended_at: null });

async function fixture(t, { lifecycle = false } = {}) {
  return migrationFixture(t, {
    ...(lifecycle ? { sourceSuffix: `
import { sweepSourceContent } from "./src/activity/content-retention.ts";
let nowMs=10000;
Date.now=()=>nowMs;
fixtureActions.clock=(_env,_principal,input)=>{nowMs=input.nowMs;return {nowMs};};
fixtureActions.sourceSweep=(env,_principal,input)=>sweepSourceContent(env,input);
` } : {}),
    migrations: ["0004_reports.sql", "0005_runtime.sql", "0006_dashboard_eval.sql"],
  });
}
async function publish(f, documents) {
  const migration = await snapshot(f, documents, {
    cut: 1, snapshotId: randomUUID(), projectId: "device:device-a",
    range: { fromMs: -8_640_000_000_000_000, toMs: 8_640_000_000_000_000 },
  });
  await f.consent(migration.begin, { scope: {
    deviceId: "device-a", projectIds: ["device:device-a"], rootIds: [],
  } });
  assert.equal((await f.send("begin", migration.begin)).status, 200);
  for (let page = 0; page < documents.length; page++) { const staged = await migration.stage(page); assert.equal(staged.status, 200, JSON.stringify(staged.body)); }
  assert.equal((await f.send("complete", ref(migration.begin))).status, 200);
  return migration.begin;
}
async function ingest(f, begin, rows, options = {}) {
  const p = await packet({ schemaVersion: 2, rows }, {
    batchId: options.batchId ?? randomUUID(), sequence: options.sequence ?? 1,
    from: options.from ?? 1, through: options.through ?? 2,
    metadataMutations: options.metadataMutations ?? [],
  });
  const scope = scopeOf(begin);
  for (const upload of p.uploads) {
    assert.equal((await f.api("/v1/activity/chunks", { ...upload, ...scope })).status, 201);
  }
  const accepted = await f.api("/v1/activity/batches", { ...p.batch, ...scope });
  return { status: accepted.status, body: await accepted.json() };
}
const scopeOf = begin => ({ deviceId: begin.deviceId, sourceDomain: begin.sourceDomain,
  generation: begin.generation, consentVersion: begin.consentVersion,
  projectId: begin.projectId, rootId: begin.rootId, range: begin.range, backfill: begin.backfill });
async function readUsage(f, begin) {
  const response = await f.api("/v1/activity/skill-usage", scopeOf(begin));
  return { status: response.status, body: await response.json() };
}


const read = async (f, path, begin, extra = {}) => {
  const r = await f.api(path, { ...scopeOf(begin), ...extra });
  return { status: r.status, body: await r.json() };
};
const plan = async (f, q) => (await f.rows(`EXPLAIN QUERY PLAN ${q}`)).map(r => r.detail).join("|");

test("session metrics and events: counts, keyset pages, rowsRead, scope and consent", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "search", 10, "codex", { sessionId: "s1", revision: 0 }),
    ev("e2", "load", 20, "codex", { sessionId: "s1", uri: SKILL, revision: 0 }),
    ev("e3", "load", 20, "codex", { sessionId: "s1", uri: SKILL, revision: 0 }),
    ev("e4", "search", 5, "codex", { sessionId: "s2", revision: 0 }),
  ] }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  const m = await read(f, "/v1/activity/sessions/metrics", begin, { sessionIds: ["s1", "s2", "nope"] });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  const by = Object.fromEntries(m.body.rows.map(r => [r.sessionId, r]));
  assert.deepEqual(by.s1, { sessionId: "s1", events: 3, reads: 2, searches: 1, firstEventMs: 10, lastEventMs: 20 });
  assert.deepEqual(by.s2, { sessionId: "s2", events: 1, reads: 0, searches: 1, firstEventMs: 5, lastEventMs: 5 });
  assert.equal(by.nope, undefined);
  assert.equal(typeof m.body.rowsRead === "number" || m.body.rowsRead === null, true);
  const p1 = await read(f, "/v1/activity/sessions/events", begin, { sessionId: "s1", limit: 2 });
  assert.deepEqual(p1.body.events.map(e => e.entityKey), ["e1", "e2"]);
  assert.ok(p1.body.nextCursor);
  const p2 = await read(f, "/v1/activity/sessions/events", begin, { sessionId: "s1", limit: 2, cursor: p1.body.nextCursor });
  assert.deepEqual(p2.body.events.map(e => e.entityKey), ["e3"]);
  assert.equal(p2.body.nextCursor, null);
  const other = await f.api("/v1/activity/sessions/metrics", { ...scopeOf(begin), deviceId: "device-b", sessionIds: ["s1"] });
  assert.equal(other.status, 403);
  await f.accounts.prepare("DELETE FROM device_consents").run();
  assert.equal((await read(f, "/v1/activity/sessions/events", begin, { sessionId: "s1" })).status, 403);
});

test("session read queries use event_facts_session, never a table scan", async t => {
  const f = await fixture(t);
  const { metricsSql, eventsSql } = await import("../src/activity/session-sql.ts");
  for (const [q] of [[metricsSql(2)], [eventsSql(true)], [eventsSql(false)]]) {
    const p = await plan(f, q.replace(/\?/g, "'x'"));
    assert.match(p, /event_facts_session/, p);
    assert.doesNotMatch(p, /SCAN event_facts(?! USING)/, p);
  }
});

test("session list/count/filter-options over the real ingest path (D1 triggers), no start time invented", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "search", 10, "codex", { sessionId: "s1", revision: 0 }),
    ev("e2", "load", 20, "codex", { sessionId: "s1", uri: SKILL, revision: 0 }),
    ev("e4", "search", 5, "codex", { sessionId: "s2", revision: 0 }),
  ] }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  const list = await read(f, "/v1/activity/sessions", begin, { limit: 1 });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(list.body.sessions, [{ sessionId: "s1", startedMs: null, firstEventMs: 10, lastEventMs: 20,
    events: 2, reads: 1, searches: 1, runtime: null,
    skills: [{ skillId: SKILL, digest: null, firstReadMs: 20, reads: 1 }] }]);
  assert.deepEqual(list.body.nextCursor, { lastEventMs: 20, sessionId: "s1" });
  const next = await read(f, "/v1/activity/sessions", begin, { limit: 1, cursor: list.body.nextCursor });
  assert.deepEqual(next.body.sessions.map(s => s.sessionId), ["s2"]);
  const facet = await read(f, "/v1/activity/sessions", begin, { searchWithoutRead: true });
  assert.deepEqual(facet.body.sessions.map(s => s.sessionId), ["s2"]);
  assert.equal((await read(f, "/v1/activity/sessions/count", begin, { searchWithoutRead: true })).body.total, 1);
  assert.equal((await read(f, "/v1/activity/sessions/count", begin, {})).body.total, 2);
  assert.deepEqual((await read(f, "/v1/activity/sessions/filter-options", begin)).body.runtimes, [{ runtime: null, sessions: 2 }]);
  assert.equal((await f.api("/v1/activity/sessions", { ...scopeOf(begin), deviceId: "device-b" })).status, 403);
  console.log("rowsRead list/count:", list.body.rowsRead, (await read(f, "/v1/activity/sessions/count", begin, {})).body.rowsRead);
});

test("a full 100-row list page returns every session's skill chips (D1 allows 100 bound variables per query)", async t => {
  const f = await fixture(t);
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(ev(`e${i}`, "load", 1000 + i, "codex", { sessionId: `s${String(i).padStart(3, "0")}`, uri: SKILL, revision: 0 }));
  const begin = await publish(f, [{ schemaVersion: 2, rows }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  for (const limit of [50, 100]) {
    const list = await read(f, "/v1/activity/sessions", begin, { limit });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.sessions.length, limit);
    assert.ok(list.body.sessions.every(s => s.skills.length === 1 && s.skills[0].reads === 1));
  }
});

test("skill reads by digest: a session in both read tables counts once, the period is the first read, other skills and scopes stay out", async t => {
  const f = await fixture(t);
  const ID = "00000000-0000-4000-8000-000000000001";
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", 20, "codex", { sessionId: "s1", uri: SKILL, revision: 0 }),
    ev("e2", "load", 25, "codex", { sessionId: "s3", uri: SKILL2, revision: 0 }),
  ] }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  // 백필 뒤에 수집된 증분: s1은 두 표 모두에, s2는 수집 표에만 있다.
  await ingest(f, begin, [
    ev("e3", "load", 50, "codex", { sessionId: "s1", uri: SKILL }),
    ev("e4", "load", 60, "codex", { sessionId: "s2", uri: SKILL }),
  ]);
  const all = await read(f, "/v1/activity/skills/reads", begin, { skillId: ID });
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.totalSessions, 2, "s1은 두 표에 있어도 한 세션");
  assert.deepEqual(all.body.rows.map(r => [r.digest, r.sessions, r.reads, r.firstReadMs, r.lastFirstReadMs]), [[null, 2, 3, 20, 60]]);
  const recent = await read(f, "/v1/activity/skills/reads", begin, { skillId: ID, firstReadFromMs: 30 });
  assert.equal(recent.body.totalSessions, 1, "s1은 처음 읽은 시각이 기간 밖");
  assert.deepEqual(recent.body.rows.map(r => [r.sessions, r.reads]), [[1, 1]]);
  const other = await read(f, "/v1/activity/skills/reads", begin, { skillId: "00000000-0000-4000-8000-000000000002" });
  assert.deepEqual([other.body.totalSessions, other.body.rows.length], [1, 1]);
  assert.equal((await read(f, "/v1/activity/skills/reads", begin, { skillId: "not-a-uuid" })).status >= 400, true);
  assert.equal((await f.api("/v1/activity/skills/reads", { ...scopeOf(begin), deviceId: "device-b", skillId: ID })).status, 403);
  assert.match(await plan(f, "SELECT 1 FROM session_skill_reads WHERE account_id='a' AND generation=1 AND device_id='d' AND source_domain='s' AND skill_id>='skill://private/x/' AND skill_id<'skill://private/x0'"), /session_skill_reads_skill/);
});

test("session list/count can filter by skill: either read table, both URI forms, never another skill", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", 20, "codex", { sessionId: "s1", uri: SKILL, revision: 0 }),
    ev("e2", "load", 30, "codex", { sessionId: "s2", uri: SKILL2, revision: 0 }),
    ev("e3", "search", 40, "codex", { sessionId: "s3", revision: 0 }),
  ] }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  await ingest(f, begin, [ev("e4", "load", 50, "codex", { sessionId: "s4", uri: SKILL })]);
  const ID = "00000000-0000-4000-8000-000000000001";
  const list = await read(f, "/v1/activity/sessions", begin, { skillId: ID });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(list.body.sessions.map(r => r.sessionId), ["s4", "s1"]);
  assert.equal((await read(f, "/v1/activity/sessions/count", begin, { skillId: ID })).body.total, 2);
  assert.equal((await read(f, "/v1/activity/sessions/count", begin, { skillId: "00000000-0000-4000-8000-000000000002" })).body.total, 1);
  assert.equal((await read(f, "/v1/activity/sessions/count", begin, { skillId: "00000000-0000-4000-8000-0000000000ff" })).body.total, 0);
  assert.equal((await read(f, "/v1/activity/sessions/count", begin, { skillId: ID, activeFromMs: 25 })).body.total, 1);
  assert.equal((await read(f, "/v1/activity/sessions", begin, { skillId: "nope" })).status >= 400, true);
});

test("the unclassified-error log line carries only an event tag, the route and the error name", async () => {
  // 정적 계약 검사: 로컬 워커 로그는 Miniflare 안에서 나므로 소스의 console.error 호출 형태를 고정한다.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/activity/content-api.ts", import.meta.url), "utf8");
  const calls = [...source.matchAll(/console\.(error|warn|log)\(([^;]*)\);/g)];
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].replace(/\s+/g, " "),
    'JSON.stringify({ event: "activity_unclassified_error", route: url.pathname, name: error.name })');
});
