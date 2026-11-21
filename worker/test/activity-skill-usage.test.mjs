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

test("ingest counts events per skill, agent and KST day without any session join", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const now = Date.now();
  const rows = [
    ev("e1", "load", now - 1000, "claude-code", { uri: SKILL }),
    ev("e2", "search", now - 1000, "claude-code",
      { data: { candidates: [{ uri: SKILL }, { uri: SKILL2 }, { uri: SKILL }] } }),
    // search 후보 안의 load 대체 위치(uri 필드 없이 data.uri)
    ev("e3", "load", now - 2000, "codex", { data: { uri: SKILL2 } }),
    // runtime 'unknown' → 에이전트 빈 값(표시는 '알 수 없음')
    ev("e4", "load", now - 3000, "unknown", { uri: SKILL }),
  ];
  const accepted = await ingest(f, begin, rows);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  // 저장은 (KST 일자, 스킬, 에이전트)별 횟수 행뿐: 세션 ID·시각·이벤트 원장 없음.
  const stored = await f.rows("SELECT * FROM skill_daily_usage");
  assert.equal(stored.length, 4);
  assert.deepEqual(stored.map(r => [r.day, r.skill_id, r.agent, r.reads, r.exposures]).sort(), [
    [kstDay(now - 1000), SKILL, "claude-code", 1, 1],
    [kstDay(now - 1000), SKILL2, "claude-code", 0, 1],
    [kstDay(now - 2000), SKILL2, "codex", 1, 0],
    [kstDay(now - 3000), SKILL, "", 1, 0],
  ].sort());
  assert.equal((await f.rows("SELECT * FROM skill_usage_batches")).length, 1);
  const usage = await readUsage(f, begin);
  assert.equal(usage.status, 200, JSON.stringify(usage.body));
  assert.equal(usage.body.coverage, "pending_backfill");
  assert.deepEqual(usage.body.rows, [
    { skillUri: SKILL, agent: null, reads: 1, exposures: 0 },
    { skillUri: SKILL, agent: "claude-code", reads: 1, exposures: 1 },
    { skillUri: SKILL2, agent: "claude-code", reads: 0, exposures: 1 },
    { skillUri: SKILL2, agent: "codex", reads: 1, exposures: 0 },
  ]);
});

test("unknown runtime falls back to the recorded session client_name in the same batch", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const now = Date.now();
  // 리드 결정(v3.1) 2번: runtime 'unknown'이면 실제 기록된 연결 정보(같은 배치의 세션
  // client_name)으로 대체한다. 추정 매핑 없음.
  const rows = [
    sess("sess-a", "Claude Code"),
    ev("e1", "load", now - 1000, "unknown", { uri: SKILL, sessionId: "sess-a" }),
    // client_name이 null로 기록된 세션은 대체할 정보가 없다 → 알 수 없음 유지.
    sess("sess-b", null),
    ev("e2", "load", now - 1000, "unknown", { uri: SKILL, sessionId: "sess-b" }),
  ];
  const accepted = await ingest(f, begin, rows);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const stored = await f.rows("SELECT * FROM skill_daily_usage");
  assert.deepEqual(stored.map(r => [r.skill_id, r.agent, r.reads]).sort(), [
    [SKILL, "", 1],
    [SKILL, "Claude Code", 1],
  ].sort());
});

test("session client_name in another batch is not substituted (no queryable record)", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const now = Date.now();
  // 세션 행이 먼저 수집되고 이벤트가 다음 배치에 오면 서버에는 조회 가능한 client_name
  // 기록이 없다(콘텐츠 행은 보관하지 않고 session_facts는 runtime·시각만 보관).
  // 이 경로는 리드 결정대로 '알 수 없음'을 유지한다.
  assert.equal((await ingest(f, begin, [sess("sess-c", "Codex")])).status, 200);
  const accepted = await ingest(f, begin,
    [ev("e1", "load", now, "unknown", { uri: SKILL, sessionId: "sess-c", revision: 3 })],
    { sequence: 2, from: 2, through: 3 });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const stored = await f.rows("SELECT * FROM skill_daily_usage");
  assert.deepEqual(stored.map(r => [r.skill_id, r.agent, r.reads]), [[SKILL, "", 1]]);
});

test("events split across batches are all counted (no cross-batch session dependency)", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const now = Date.now();
  const batch1 = [ev("e1", "load", now, "claude-code", { uri: SKILL }),
    ev("e2", "load", now, "claude-code", { uri: SKILL })];
  assert.equal((await ingest(f, begin, batch1)).status, 200);
  const later = Array.from({ length: 8 }, (_, i) =>
    ev(`x${i}`, "load", now, "claude-code", { uri: SKILL, revision: 3 }));
  assert.equal((await ingest(f, begin, later, { sequence: 2, from: 2, through: 3 })).status, 200);
  // 10개 모두 집계(이벤트가 자기 ts·runtime을 가지므로 배치 분할과 무관).
  const stored = await f.rows("SELECT * FROM skill_daily_usage");
  assert.equal(stored.reduce((sum, r) => sum + r.reads, 0), 10);
  const usage = await readUsage(f, begin);
  assert.deepEqual(usage.body.rows, [{ skillUri: SKILL, agent: "claude-code", reads: 10, exposures: 0 }]);
});

test("read window is the last 30 KST days: older day rows are stored but not read", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const now = Date.now();
  const rows = [
    ev("e1", "load", now - 2 * DAY, "claude-code", { uri: SKILL }),
    ev("e2", "load", now - 31 * DAY, "old", { uri: SKILL2 }),
  ];
  assert.equal((await ingest(f, begin, rows)).status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage")).length, 2);
  const usage = await readUsage(f, begin);
  assert.deepEqual(usage.body.rows, [{ skillUri: SKILL, agent: "claude-code", reads: 1, exposures: 0 }]);
});

test("same batch re-POST does not double count (batch receipt idempotency)", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const batchId = randomUUID();
  const rows = [ev("e1", "load", Date.now(), "claude-code", { uri: SKILL })];
  assert.equal((await ingest(f, begin, rows, { batchId })).status, 200);
  const retry = await ingest(f, begin, rows, { batchId });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  const stored = await f.rows("SELECT * FROM skill_daily_usage");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].reads, 1);
});

test("retransmission of an applied journal range is rejected at intake; counts stay unchanged", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const rows = [ev("e1", "load", Date.now(), "claude-code", { uri: SKILL })];
  assert.equal((await ingest(f, begin, rows, { from: 1, through: 2 })).status, 200);
  // 다른 batch_id로 같은 저널 범위 (1,2] 재전송: 수집 계약이 sequence_gap 409로 거부한다.
  // (SQL의 영수증 범위·cut 검사는 그 아래 방어선.)
  const resent = await ingest(f, begin, rows, { sequence: 2, from: 1, through: 2 });
  assert.equal(resent.status, 409);
  const stored = await f.rows("SELECT * FROM skill_daily_usage");
  assert.equal(stored.reduce((sum, r) => sum + r.reads, 0), 1);
  // 다음 구간 (2,3]의 정상 배치는 반영된다.
  const next = [ev("e2", "load", Date.now(), "claude-code", { uri: SKILL2, revision: 3 })];
  assert.equal((await ingest(f, begin, next, { sequence: 2, from: 2, through: 3 })).status, 200);
  const usage = await readUsage(f, begin);
  assert.deepEqual(usage.body.rows, [
    { skillUri: SKILL, agent: "claude-code", reads: 1, exposures: 0 },
    { skillUri: SKILL2, agent: "claude-code", reads: 1, exposures: 0 },
  ]);
});

test("tombstone invalidates the whole source scope (coarse rows cannot be decremented)", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const rows = [ev("e1", "load", Date.now(), "claude-code", { uri: SKILL })];
  assert.equal((await ingest(f, begin, rows)).status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage")).length, 1);
  const tombstone = (target, key, revision) => ({ entity: "tombstone", target, key, revision });
  assert.equal((await ingest(f, begin, [], {
    sequence: 2, from: 2, through: 3, metadataMutations: [tombstone("event", "e1", 3)],
  })).status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage")).length, 0);
  // 원본 콘텐츠는 남아 있으므로 coverage는 pending_backfill로 되돌아간다(재백필로 복구).
  const usage = await readUsage(f, begin);
  assert.equal(usage.body.coverage, "pending_backfill");
  assert.deepEqual(usage.body.rows, []);
});

test("backfill recomputes from the latest complete snapshot and flips coverage to current", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", Date.now(), "claude-code", { uri: SKILL, revision: 0 }),
  ] }]);
  const before = await readUsage(f, begin);
  assert.equal(before.body.coverage, "pending_backfill");
  const backfilled = await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin));
  assert.equal(backfilled.status, 200, JSON.stringify(await backfilled.clone().json().catch(() => null)));
  const result = await backfilled.json();
  assert.deepEqual(result, { schemaVersion: 1, deviceId: begin.deviceId,
    sourceDomain: begin.sourceDomain, snapshotCut: begin.cut, rows: 1, skipped: 0 });
  const after = await readUsage(f, begin);
  assert.equal(after.body.coverage, "current");
  assert.deepEqual(after.body.rows, [{ skillUri: SKILL, agent: "claude-code", reads: 1, exposures: 0 }]);
  // 재실행 멱등: 같은 스냅샷에서 같은 행으로 교체.
  const again = await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin));
  assert.equal(again.status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage_backfill")).length, 1);
});

test("backfill replays retained batches received after the snapshot cut (pre-deploy gap)", async t => {
  // PR152+153 운영 회귀: 배포 전에 이미 받은 post-cut 배치가 어느 테이블에도 반영되지 않았다.
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", Date.now(), "claude-code", { uri: SKILL, revision: 0 }),
  ] }]);
  assert.equal((await ingest(f, begin, [
    ev("e2", "load", Date.now(), "codex", { uri: SKILL2 }),
    ev("e3", "search", Date.now(), "codex", { data: { candidates: [{ uri: SKILL }] } }),
  ])).status, 200);
  // 배포 전 상태 시뮬레이션: 집계 행·영수증이 없던 시절에 수신된 배치(수신 기록·보관 콘텐츠는 남음).
  await f.db.prepare("DELETE FROM skill_daily_usage").run();
  await f.db.prepare("DELETE FROM skill_usage_batches").run();
  const backfilled = await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin));
  assert.equal(backfilled.status, 200, JSON.stringify(await backfilled.clone().json().catch(() => null)));
  const usage = await readUsage(f, begin);
  assert.equal(usage.body.coverage, "current");
  assert.deepEqual(usage.body.rows, [
    { skillUri: SKILL, agent: "claude-code", reads: 1, exposures: 0 },
    { skillUri: SKILL, agent: "codex", reads: 0, exposures: 1 },
    { skillUri: SKILL2, agent: "codex", reads: 1, exposures: 0 },
  ]);
  // 재백필 멱등: 재생 대상은 영수증이 없는 보관 배치로 안정적이며 합계가 두 배가 되지 않는다.
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  const again = await readUsage(f, begin);
  assert.deepEqual(again.body.rows, usage.body.rows);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage")).length, 0);
});

test("repeated backfills over the same retained batches keep totals; a later overlapping ingest counts exactly once", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", Date.now(), "claude-code", { uri: SKILL, revision: 0 }),
  ] }]);
  // 배포 전 수신분(집계 없이 보관만 된 배치): 같은 스킬·에이전트·일자로 겹치게 둔다.
  assert.equal((await ingest(f, begin, [
    ev("e2", "load", Date.now(), "codex", { uri: SKILL2 }),
  ], { batchId: "batch-old" })).status, 200);
  await f.db.prepare("DELETE FROM skill_daily_usage").run();
  await f.db.prepare("DELETE FROM skill_usage_batches").run();
  // 배포 후 증분(영수증 있음)이 이미 있는 상태에서 신규 ingest: 같은 (스킬, 에이전트, 일자)에
  // 정확히 한 번만 더해진다.
  assert.equal((await ingest(f, begin, [
    ev("e3", "load", Date.now(), "codex", { uri: SKILL2, revision: 3 }),
  ], { sequence: 2, from: 2, through: 3, batchId: "batch-new" })).status, 200);
  // 백필 전: 증분분(e3)만 보인다 — 배포 전 수신분(e2)과 스냅샷(e1)은 아직 어디에도 없다.
  assert.deepEqual((await readUsage(f, begin)).body.rows, [
    { skillUri: SKILL2, agent: "codex", reads: 1, exposures: 0 },
  ]);
  // 증분 7건이 있는 상태와 같은 구조에서 백필·재백필: 증분분은 영수증으로 재생 제외 — 합 불변.
  const expectedWithNew = () => [
    { skillUri: SKILL, agent: "claude-code", reads: 1, exposures: 0 },
    { skillUri: SKILL2, agent: "codex", reads: 2, exposures: 0 },
  ];
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  assert.deepEqual((await readUsage(f, begin)).body.rows, expectedWithNew());
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  assert.deepEqual((await readUsage(f, begin)).body.rows, expectedWithNew());
});

test("snapshot-less source backfills from retained batches only; empty source stays 404", async t => {
  const f = await fixture(t);
  // 스냅샷이 없는 출처(MCP 직접 수집)를 만든다: 초기 마이그레이션으로 계정·동의를 구성한 뒤
  // 마이그레이션 기록만 제거해 완료 스냅샷이 없는 상태로 둔다(수신 기록·보관 배치는 남음).
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  await f.db.prepare("DELETE FROM migration_pages").run();
  await f.db.prepare("DELETE FROM migration_runs").run();
  assert.equal((await ingest(f, begin, [
    ev("e1", "load", Date.now(), "claude-code", { uri: SKILL }),
  ])).status, 200);
  assert.equal((await ingest(f, begin, [
    ev("e2", "search", Date.now(), "claude-code", { data: { candidates: [{ uri: SKILL2 }] }, revision: 3 }),
  ], { sequence: 2, from: 2, through: 3 })).status, 200);
  await f.db.prepare("DELETE FROM skill_daily_usage").run();
  await f.db.prepare("DELETE FROM skill_usage_batches").run();
  const backfilled = await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin));
  assert.equal(backfilled.status, 200, JSON.stringify(await backfilled.clone().json().catch(() => null)));
  const result = await backfilled.json();
  assert.equal(result.snapshotCut, 0);
  const usage = await readUsage(f, begin);
  assert.equal(usage.body.coverage, "current");
  assert.deepEqual(usage.body.rows, [
    { skillUri: SKILL, agent: "claude-code", reads: 1, exposures: 0 },
    { skillUri: SKILL2, agent: "claude-code", reads: 0, exposures: 1 },
  ]);
  // 스냅샷도 수신 배치도 없는 출처는 여전히 source_missing.
  const missing = await f.api("/v1/activity/skill-usage/backfill",
    { ...scopeOf(begin), sourceDomain: "empty-source" });
  assert.equal(missing.status, 404, JSON.stringify(await missing.json().catch(() => null)));
});

test("purged retained batch is skipped and reported, never zero-filled", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", Date.now(), "claude-code", { uri: SKILL, revision: 0 }),
  ] }]);
  assert.equal((await ingest(f, begin, [
    ev("e2", "load", Date.now(), "codex", { uri: SKILL2 }),
  ], { batchId: "batch-old" })).status, 200);
  await f.db.prepare("DELETE FROM skill_daily_usage").run();
  await f.db.prepare("DELETE FROM skill_usage_batches").run();
  // 보관 기간 만료로 콘텐츠가 삭제된 배치는 재생할 수 없다(스냅샷 페이지는 그대로).
  await f.db.prepare("UPDATE content_uploads SET state='purged' WHERE batch_id='batch-old'").run();
  const backfilled = await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin));
  assert.equal(backfilled.status, 200);
  const result = await backfilled.json();
  assert.equal(result.skipped, 1);
  const usage = await readUsage(f, begin);
  // 스냅샷분만 남고, 삭제된 배치의 SKILL2 행은 만들어지지 않는다(0으로 채우지 않음).
  assert.deepEqual(usage.body.rows, [{ skillUri: SKILL, agent: "claude-code", reads: 1, exposures: 0 }]);
});

test("backfill resolves unknown runtime from a session row on another snapshot page", async t => {
  const f = await fixture(t);
  // 세션 행이 다른 페이지에 있어도 스냅샷 전체를 모은 뒤 접으므로 client_name을 찾는다.
  const begin = await publish(f, [
    { schemaVersion: 2, rows: [
      ev("e1", "load", Date.now(), "unknown", { uri: SKILL, revision: 0, sessionId: "sess-p" }),
    ] },
    { schemaVersion: 2, rows: [sess("sess-p", "Gemini CLI", 0)] },
  ]);
  const backfilled = await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin));
  assert.equal(backfilled.status, 200, JSON.stringify(await backfilled.clone().json().catch(() => null)));
  const after = await readUsage(f, begin);
  assert.deepEqual(after.body.rows, [{ skillUri: SKILL, agent: "Gemini CLI", reads: 1, exposures: 0 }]);
});

test("post-cut ingest after backfill is preserved and sums once with snapshot rows", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", Date.now(), "claude-code", { uri: SKILL, revision: 0 }),
  ] }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  // 스냅샷 cut(=1) 이후 구간 (1,2]의 정상 수집만 증분 반영된다.
  const rows = [ev("e2", "load", Date.now(), "claude-code", { uri: SKILL2 })];
  assert.equal((await ingest(f, begin, rows, { from: 1, through: 2 })).status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage")).length, 1);
  // 재백필은 백필 테이블만 교체하고 수집 증분은 유지한다.
  const again = await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin));
  assert.equal(again.status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage")).length, 1);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage_backfill")).length, 1);
  const usage = await readUsage(f, begin);
  assert.deepEqual(usage.body.rows, [
    { skillUri: SKILL, agent: "claude-code", reads: 1, exposures: 0 },
    { skillUri: SKILL2, agent: "claude-code", reads: 1, exposures: 0 },
  ]);
});

test("snapshot-covered journal ranges cannot re-arrive after backfill (intake 409; SQL cut guard is in-DB defense)", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", Date.now(), "claude-code", { uri: SKILL, revision: 0 }),
  ] }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  // cut(=1) 이하 구간 (0,1]의 늦은 재도착은 수집 계약이 거부한다.
  const late = [ev("e0", "load", Date.now(), "claude-code", { uri: SKILL })];
  const lateResult = await ingest(f, begin, late, { from: 0, through: 1 });
  assert.equal(lateResult.status, 409);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage")).length, 0);
  const usage = await readUsage(f, begin);
  assert.deepEqual(usage.body.rows, [{ skillUri: SKILL, agent: "claude-code", reads: 1, exposures: 0 }]);
});

test("read requires content read consent", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  await f.accounts.prepare("DELETE FROM device_consents").run();
  const denied = await readUsage(f, begin);
  assert.equal(denied.status, 403);
  const deniedBackfill = await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin));
  assert.equal(deniedBackfill.status, 403);
});

test("out-of-consent scope is denied and a content-less source has no rows", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const other = { ...scopeOf(begin), deviceId: "device-b" };
  const response = await f.api("/v1/activity/skill-usage", other);
  assert.equal(response.status, 403);
  const usage = await readUsage(f, begin);
  assert.equal(usage.body.coverage, "pending_backfill");
  assert.deepEqual(usage.body.rows, []);
});

test("expiry sweep of the last original batch revokes the scope aggregate and marker", async t => {
  const f = await fixture(t, { lifecycle: true });
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", 100, "claude-code", { uri: SKILL, revision: 0 }),
  ] }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage_backfill")).length, 1);
  assert.equal((await readUsage(f, begin)).body.coverage, "current");
  // 보존 만료: 마지막 원본 배치가 스윕되면 집계·영수증·표식도 함께 회수된다.
  await f.send("clock", { nowMs: START + 30 * DAY + 1 });
  const swept = await f.send("sourceSweep", {});
  assert.equal(swept.status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage_backfill")).length, 0);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage")).length, 0);
  assert.equal((await f.rows("SELECT * FROM skill_usage_batches")).length, 0);
  assert.equal((await f.rows("SELECT * FROM skill_usage_backfills")).length, 0);
  assert.equal((await readUsage(f, begin)).body.coverage, "pending_backfill");
});

test("consent withdrawal purges the scope aggregate on the next sweep", async t => {
  const f = await fixture(t, { lifecycle: true });
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", 100, "claude-code", { uri: SKILL, revision: 0 }),
  ] }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage_backfill")).length, 1);
  // 동의 철회: 원본 grant가 사라지면 배치 만료가 즉시 과거가 되어 스윕이 원본과 집계를 함께 회수한다.
  await f.accounts.prepare("DELETE FROM device_consents").run();
  const swept = await f.send("sourceSweep", {});
  assert.equal(swept.status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage_backfill")).length, 0);
  assert.equal((await f.rows("SELECT * FROM skill_usage_backfills")).length, 0);
});

test("partial expiry keeps surviving batches' rows and cleans days beyond the retention window", async t => {
  const f = await fixture(t, { lifecycle: true });
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    ev("e1", "load", 100, "claude-code", { uri: SKILL, revision: 0 }),
  ] }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  // 20일 뒤 신규 수집(살아 있는 배치), 31일 뒤 스윕: page 배치만 만료.
  await f.send("clock", { nowMs: START + 20 * DAY });
  const rows = [ev("e2", "load", START + 20 * DAY, "claude-code", { uri: SKILL2 })];
  assert.equal((await ingest(f, begin, rows)).status, 200);
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage")).length, 1);
  await f.send("clock", { nowMs: START + 31 * DAY });
  const swept = await f.send("sourceSweep", {});
  assert.equal(swept.status, 200);
  // 잔여 원본(수집 배치)이 있으므로 범위 회수는 없고, 보존 창(30일) 밖 일자 행만 정리된다.
  // 백필 행(1970-01-01)은 창 밖이라 삭제, 수집 행(20일차)은 창 안이라 유지.
  assert.equal((await f.rows("SELECT * FROM skill_daily_usage_backfill")).length, 0);
  const live = await f.rows("SELECT * FROM skill_daily_usage");
  assert.equal(live.length, 1);
  assert.equal(live[0].skill_id, SKILL2);
  assert.equal((await f.rows("SELECT * FROM skill_usage_backfills")).length, 1);
  const usage = await readUsage(f, begin);
  assert.equal(usage.body.coverage, "current");
  assert.deepEqual(usage.body.rows, [{ skillUri: SKILL2, agent: "claude-code", reads: 1, exposures: 0 }]);
});

// ---- 대시보드 재디자인 1단계: 세션 평문 인덱스 (0014_session_index.sql) ----
const D1 = "a".repeat(64), D2 = "b".repeat(64);
const PRIV = (digest, id = "00000000-0000-4000-8000-000000000009") =>
  `skillar://private/${id}/${digest}/SKILL.md`;
const loadRow = (id, digest) => row2("loads", id,
  { load_id: id, trace_id: "t", uri: SKILL, manifest_digest: digest, resources_json: "[]" });
const evLoad = (id, ts, sessionId, { loadId = null, uri = SKILL, revision } = {}) =>
  (revision === undefined ? row2 : (t, k, v) => row(t, k, v, revision))("events", id,
  { id, session_id: sessionId, kind: "load", ts, runtime: "codex", skill_uri: uri,
    load_id: loadId, data_json: "{}" });
const reads = f => f.rows(`SELECT session_id,skill_id,digest,digest_source,first_read_ms,reads
  FROM session_skill_reads ORDER BY session_id,skill_id,digest`);

test("session_skill_reads keeps reads only, with digest evidence and source, never guessed", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const now = Date.now();
  const rows = [
    loadRow("l1", "sha256:loaded"),
    // s1: URI digest (event), loads digest (event), then a read with no evidence after an explicit one
    evLoad("e1", now - 5000, "s1", { uri: PRIV(D1) }),
    evLoad("e2", now - 4000, "s1", { loadId: "l1" }),
    evLoad("e3", now - 3000, "s1", { uri: SKILL2 }),          // no evidence, earlier explicit reads are another skill
    // s2: explicit read then a later no-evidence read of the same skill -> session_load
    evLoad("e4", now - 2000, "s2", { uri: PRIV(D2) }),
    // 검색 노출은 이 표에 넣지 않는다.
    ev("e5", "search", now - 1000, "codex", { sessionId: "s1", data: { candidates: [{ uri: SKILL2 }] } }),
  ];
  assert.equal((await ingest(f, begin, rows)).status, 200);
  const got = (await reads(f)).map(r => [r.session_id, r.skill_id, r.digest, r.digest_source, r.reads]);
  assert.deepEqual(got.sort(), [
    ["s1", PRIV(D1), D1, "event", 1],
    ["s1", SKILL2, "", null, 1],
    ["s1", SKILL, "sha256:loaded", "event", 1],
    ["s2", PRIV(D2), D2, "event", 1],
  ].sort());
  assert.deepEqual(Object.keys((await reads(f))[0]).sort(),
    ["digest", "digest_source", "first_read_ms", "reads", "session_id", "skill_id"].sort());
  assert.equal((await f.rows("PRAGMA table_info(session_skill_reads)")).some(c => c.name === "exposures"), false);
});

test("digest is never inferred from past reads, future loads or other documents", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const now = Date.now();
  assert.equal((await ingest(f, begin, [
    loadRow("l1", D1),
    evLoad("e0", now - 5000, "s1"),                       // 뒤에만 증거가 있음(미래 load): 알 수 없음
    evLoad("e1", now - 4000, "s1", { loadId: "l1" }),     // 증거: loads.manifest_digest
    evLoad("e2", now - 3000, "s1"),                       // 같은 문서의 앞선 증거 load: session_load
    evLoad("e6", now - 3000, "s2"),                       // 다른 세션은 증거 없음
  ])).status, 200);
  // 다음 배치: 앞선 배치에 증거가 있어도 이 문서에는 없으므로 알 수 없음. 단순 과거 읽음으로 채우지 않는다.
  assert.equal((await ingest(f, begin, [evLoad("e3", now - 1000, "s1", { revision: 3 }),
    evLoad("e4", now - 900, "s9", { revision: 3 })], { sequence: 2, from: 2, through: 3 })).status, 200);
  // 역순 도착: 증거 load가 더 늦은 배치로 와도 이미 쌓인 읽음의 digest를 소급해 바꾸지 않는다.
  assert.equal((await ingest(f, begin, [evLoad("e5", now - 800, "s1", { uri: PRIV(D2), revision: 4 })],
    { sequence: 3, from: 3, through: 4 })).status, 200);
  const got = (await reads(f)).map(r => [r.session_id, r.skill_id, r.digest, r.digest_source, r.reads]);
  assert.deepEqual(got.sort(), [
    ["s1", SKILL, "", null, 2],            // e0 (미래 증거만), e3 (다른 문서)
    ["s1", SKILL, D1, "event", 2],         // e1 + e2(session_load; 행은 첫 증거 'event'를 유지)
    ["s1", PRIV(D2), D2, "event", 1],
    ["s2", SKILL, "", null, 1],
    ["s9", SKILL, "", null, 1],
  ].sort());
});

test("backfill resolves digests per document only and never from past reads or other pages", async t => {
  const f = await fixture(t);
  const now = Date.now();
  const begin = await publish(f, [
    { schemaVersion: 2, rows: [
      row("loads", "l1", { load_id: "l1", trace_id: "t", uri: SKILL, manifest_digest: D1, resources_json: "[]" }, 0),
      row("events", "e1", { id: "e1", session_id: "s1", kind: "load", ts: now - 3000, runtime: "codex",
        skill_uri: SKILL, load_id: "l1", data_json: "{}" }, 0)] },
    { schemaVersion: 2, rows: [
      row("events", "e2", { id: "e2", session_id: "s1", kind: "load", ts: now - 1000, runtime: "codex",
        skill_uri: SKILL, load_id: null, data_json: "{}" }, 0)] },
  ]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  const got = (await f.rows("SELECT digest,digest_source,reads FROM session_skill_reads_backfill ORDER BY digest"))
    .map(r => [r.digest, r.digest_source, r.reads]);
  assert.deepEqual(got, [["", null, 1], [D1, "event", 1]]);
});

test("session_skill_reads is idempotent on re-POST and cleared by a tombstone", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const rows = [loadRow("l1", D1), evLoad("e1", Date.now(), "s1", { loadId: "l1" })];
  const batchId = randomUUID();
  assert.equal((await ingest(f, begin, rows, { batchId })).status, 200);
  await ingest(f, begin, rows, { batchId });
  assert.equal((await f.rows("SELECT reads FROM session_skill_reads"))[0].reads, 1);
  const tombstone = (target, key, revision) => ({ entity: "tombstone", target, key, revision });
  assert.equal((await ingest(f, begin, [], {
    sequence: 2, from: 2, through: 3, metadataMutations: [tombstone("event", "e1", 3)],
  })).status, 200);
  assert.equal((await f.rows("SELECT * FROM session_skill_reads")).length, 0);
});

test("ingest derives session_facts and event_facts from decrypted content rows (approved fields only)", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const now = Date.now();
  const rows = [
    row2("sessions", "s1", { id: "s1", runtime: "codex", client_name: "x", started_at: now - 9000,
      ended_at: now - 100, first_prompt: "secret prompt" }),
    evLoad("e1", now - 5000, "s1", { uri: PRIV(D1) }),
    ev("e2", "search", now - 4000, "codex", { sessionId: "s1" }),
  ];
  assert.equal((await ingest(f, begin, rows)).status, 200);
  assert.deepEqual((await f.rows("SELECT entity_key,runtime,started_ms,ended_ms,automated,facts_json FROM session_facts"))
    .map(r => [r.entity_key, r.runtime, r.started_ms, r.ended_ms, r.automated, r.facts_json]),
    [["s1", "codex", now - 9000, null, null, "{}"]]);
  assert.deepEqual((await f.rows("SELECT entity_key,session_id,kind,timestamp_ms,source_key,facts_json FROM event_facts ORDER BY entity_key"))
    .map(r => [r.entity_key, r.session_id, r.kind, r.timestamp_ms, r.source_key, r.facts_json]), [
    ["e1", "s1", "load", now - 5000, null, "{}"], ["e2", "s1", "search", now - 4000, null, "{}"]]);
  // 요청문은 어떤 평문 표에도 없다.
  for (const table of ["session_facts", "event_facts", "session_skill_reads"]) {
    assert.equal(JSON.stringify(await f.rows(`SELECT * FROM ${table}`)).includes("secret prompt"), false);
  }
  // 재전송과 낮은 리비전은 덮어쓰지 않는다.
  await ingest(f, begin, rows, { batchId: randomUUID(), sequence: 2, from: 2, through: 3 }).catch(() => null);
  assert.equal((await f.rows("SELECT * FROM event_facts")).length, 2);
});

test("backfill rebuilds session_skill_reads_backfill and session/event facts from the snapshot, idempotently", async t => {
  const f = await fixture(t);
  const now = Date.now();
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    row("sessions", "s1", { id: "s1", runtime: "codex", client_name: null, started_at: now - 9000, ended_at: null }, 0),
    row("events", "e1", { id: "e1", session_id: "s1", kind: "load", ts: now, runtime: "codex",
      skill_uri: PRIV(D1), load_id: null, data_json: "{}" }, 0),
  ] }]);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  assert.deepEqual((await f.rows("SELECT session_id,skill_id,digest,digest_source,first_read_ms,reads FROM session_skill_reads_backfill"))
    .map(r => [r.session_id, r.skill_id, r.digest, r.digest_source, r.first_read_ms, r.reads]),
    [["s1", PRIV(D1), D1, "event", now, 1]]);
  assert.equal((await f.rows("SELECT * FROM session_facts")).length, 1);
  assert.equal((await f.rows("SELECT * FROM event_facts")).length, 1);
});

test("metadata mutations from a client still fill the session index columns", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const mutations = [
    { entity: "session", key: "s1", revision: 2, facts: { runtime: "codex", startedMs: 1000,
      endedMs: null, automated: true } },
    { entity: "event", key: "e1", revision: 2, facts: { sessionId: "s1", kind: "search",
      timestampMs: 1500, sourceOrder: null, recordingOrders: {}, sourceKey: null, status: "unknown",
      inputTokens: null, outputTokens: null } },
  ];
  assert.equal((await ingest(f, begin, [], { metadataMutations: mutations })).status, 200);
  assert.deepEqual((await f.rows("SELECT entity_key,automated FROM session_facts")).map(r => [r.entity_key, r.automated]), [["s1", 1]]);
  assert.deepEqual((await f.rows("SELECT session_id,kind FROM event_facts")).map(r => [r.session_id, r.kind]), [["s1", "search"]]);
  const plan = async sql => (await f.rows(`EXPLAIN QUERY PLAN ${sql}`)).map(r => r.detail).join("|");
  assert.match(await plan(`SELECT entity_key FROM session_facts WHERE account_id='a' AND generation=1
    AND device_id='d' AND source_domain='x' AND started_ms BETWEEN 0 AND 9 ORDER BY started_ms DESC LIMIT 50`),
    /session_facts_started/);
  assert.match(await plan(`SELECT kind,count(*) FROM event_facts WHERE account_id='a' AND generation=1
    AND device_id='d' AND source_domain='x' AND session_id IN ('s1','s2') GROUP BY session_id,kind`),
    /event_facts_session/);
});

test("RECOVERY: backfill restores session index rows for retained batches that already have a skill-usage receipt", async t => {
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }]);
  const now = Date.now();
  const rows = [
    row2("sessions", "s1", { id: "s1", runtime: "codex", client_name: null, started_at: now - 9000, ended_at: null }),
    evLoad("e1", now - 5000, "s1", { uri: PRIV(D1) }),
  ];
  assert.equal((await ingest(f, begin, rows)).status, 200);
  // 0014 배포 전에 수집된 배치처럼: 스킬 집계 영수증은 있고 세션 인덱스는 비어 있다.
  await f.rows("DELETE FROM session_facts");
  await f.rows("DELETE FROM event_facts");
  await f.rows("DELETE FROM session_skill_reads");
  assert.equal((await f.api("/v1/activity/skill-usage/backfill", scopeOf(begin))).status, 200);
  assert.equal((await f.rows("SELECT * FROM session_facts")).length, 1, "session_facts restored");
  assert.equal((await f.rows("SELECT * FROM event_facts")).length, 1, "event_facts restored");
});
