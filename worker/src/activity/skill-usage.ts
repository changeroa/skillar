// SPDX-License-Identifier: AGPL-3.0-only
// 스킬 탭 활동 필터용 평문 일별 집계 (v3 거친 집계: 리드 설계 결정, 2026-11-20 16:34 KST 판단 반영).
// 저장 행 = (account_id, generation, device_id, source_domain, KST 일자, skill_id, agent)
// + reads/exposures 횟수뿐. 세션 ID·초 단위 시각·이벤트 원장은 저장하지 않는다.
// 집계는 이벤트 단위: load 이벤트=reads+1, search 노출=exposures+1, 일자=이벤트 ts의 KST 일자,
// 에이전트=이벤트의 runtime('unknown'이면 빈 값). 세션 행에 의존하지 않으므로 배치를 넘나드는
// 세션의 이벤트도 누락 없이 센다. 멱등: 일반 수신 배치는 배치 영수증 1회 증분이고, 같은 저널
// 범위의 재전송(다른 batch_id)은 적용된 영수증 범위 검사로, 백필 커버 범위(snapshot_cut 이하)
// 재도착은 표식 검사로 건너뛴다. 재기준선·백필은 증분 가산 없이 출처 집계를 현재 데이터로
// 재계산해 교체한다. 툼스톤(개별 삭제)은 거친 행 감산이 불가해 출처 범위 집계를 회수한다.
import { z } from "zod";
import { contentKinds } from "../../../shared/activity-schema.ts";
import type { ContentRow } from "../../../shared/activity-content.ts";
import { reportScopeSchema } from "../../../shared/activity-query.ts";
import { migrationBeginSchema } from "../../../shared/activity-sync.ts";
import { parseJson } from "../../../shared/facts/base.ts";
import { parsePrivateSkillUri } from "../../../shared/private-skills.ts";
import { activeFence } from "./content-db.ts";
import { contentScope, requireContentConsent, requireContentReadConsent } from "./content-consent.ts";
import { commitGuard } from "./projections.ts";
import { exportMigration } from "./migrations.ts";
import { ContentStorageError } from "./content-keys.ts";
import { readBatchContent } from "./content-service.ts";
import { ReportError } from "./report-types.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal, StreamIdentity } from "./types.ts";
import type { ContentEnv } from "./content-env.ts";

const sessionValuesSchema = z.looseObject({
  id: z.string(), client_name: z.string().nullable(),
});
const loadValuesSchema = z.looseObject({
  load_id: z.string(), manifest_digest: z.string().nullable().optional(),
});
const eventValuesSchema = z.looseObject({
  id: z.string(), kind: z.string(), ts: z.number(), runtime: z.string(),
  session_id: z.string(), load_id: z.string().nullable().optional(),
  skill_uri: z.string().nullable(), data_json: z.string(),
});

export const SKILL_USAGE_WINDOW_DAYS = 30;
/** KST(UTC+9) 일자 문자열. */
export const kstDay = (ms: number): string =>
  new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
/** 조회 창의 첫 KST 일자: 오늘(KST)을 포함한 최근 30개 일자. */
export const skillUsageWindowStart = (now: number): string =>
  kstDay(now - (SKILL_USAGE_WINDOW_DAYS - 1) * 86_400_000);

export type SkillUsageCount = {
  day: string; skillUri: string; agent: string; reads: number; exposures: number;
};
type PendingUse = { sessionId: string; ts: number; runtime: string;
  skillUri: string; kind: "read" | "exposure"; loadId?: string;
  /** 읽음 이벤트의 skill_uri에 든 버전(digest). 비공개 스킬 URI만 가진다. */
  uriDigest?: string };
/** 비공개 스킬 URI(skillar://private/<id>/<digest>/<path>)에 든 버전 digest. 다른 URI는 undefined. */
function uriDigest(uri: string): string | undefined {
  try { return parsePrivateSkillUri(uri).digest; } catch { return undefined; }
}
export type SkillUsageDeltas = {
  uses: PendingUse[];
  /** 같은 배치/스냅샷 안 세션 행의 client_name(메모리에서만 사용, 저장하지 않음). */
  sessionClients: Map<string, string>;
  /** 같은 배치/스냅샷 안 loads 행의 load_id → manifest_digest(메모리에서만 사용). */
  loadDigests: Map<string, string>;
  /** 집계에 필요한 필드가 없어 제외된 이벤트 수(관측용). */
  skipped: number;
};

/** 배치 행에서 사용 이벤트와 세션 client_name 참조를 뽑는다(아직 저장 형태 아님). 리드 결정
 *  (2026-11-20): 세션 상태가 아니라 이벤트 단위로 센다 — load=reads+1, search 후보=exposures+1,
 *  일자=이벤트 ts의 KST 일자, 에이전트=이벤트 runtime(아래 skillUsageCounts에서 보완). */
export function skillUsageDeltas(rows: readonly ContentRow[]): SkillUsageDeltas {
  const uses: PendingUse[] = [];
  const sessionClients = new Map<string, string>();
  const loadDigests = new Map<string, string>();
  let skipped = 0;
  for (const row of rows) {
    if (row.operation !== "upsert" || row.values === null) continue;
    if (row.table === "sessions") {
      const parsed = sessionValuesSchema.safeParse(row.values);
      if (parsed.success && parsed.data.client_name !== null) {
        sessionClients.set(parsed.data.id, parsed.data.client_name);
      }
      continue;
    }
    if (row.table === "loads") {
      const parsed = loadValuesSchema.safeParse(row.values);
      if (parsed.success && typeof parsed.data.manifest_digest === "string") {
        loadDigests.set(parsed.data.load_id, parsed.data.manifest_digest);
      }
      continue;
    }
    if (row.table !== "events") continue;
    // 계약 검증을 통과한 행이라도 집계에 필요한 필드가 없으면 건너뛴다(집계 실패가 수집을 막으면 안 된다).
    const parsed = eventValuesSchema.safeParse(row.values);
    if (!parsed.success) { skipped++; continue; }
    const value = parsed.data;
    const data = parseJson<Record<string, unknown>>(value.data_json, {});
    if (value.kind === "load") {
      const uri = value.skill_uri ?? (typeof data.uri === "string" ? data.uri : undefined);
      if (uri !== undefined) uses.push({ sessionId: value.session_id, ts: value.ts,
        runtime: value.runtime, skillUri: uri, kind: "read",
        ...(typeof value.load_id === "string" ? { loadId: value.load_id } : {}),
        ...(uriDigest(uri) !== undefined ? { uriDigest: uriDigest(uri) } : {}) });
      else skipped++;
    } else if (value.kind === "search") {
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      const seen = new Set<string>();
      for (const candidate of candidates) {
        const uri = typeof candidate === "object" && candidate !== null &&
          "uri" in candidate && typeof candidate.uri === "string" ? candidate.uri : undefined;
        if (uri !== undefined && !seen.has(uri)) {
          seen.add(uri);
          uses.push({ sessionId: value.session_id, ts: value.ts, runtime: value.runtime,
            skillUri: uri, kind: "exposure" });
        }
      }
    }
  }
  return { uses, sessionClients, loadDigests, skipped };
}

/** 델타를 (KST 일자, 스킬, 에이전트)별 횟수로 접는다. 리드 결정(v3.1): 에이전트는 이벤트
 *  runtime이 우선이고, 'unknown'이면 같은 배치/스냅샷에 기록된 세션 client_name을 쓴다.
 *  그마저 없는 경로(세션 행이 다른 배치에 있거나 client_name 미기록)는 알 수 없다 — 서버에
 *  조회 가능한 client_name 기록이 없으므로(session_facts는 runtime·시각만 보관) 빈 값을
 *  저장하고 표시는 '알 수 없음'. 제품명 추정 매핑은 하지 않는다. */
export function skillUsageCounts(deltas: SkillUsageDeltas): Map<string, SkillUsageCount> {
  const counts = new Map<string, SkillUsageCount>();
  for (const use of deltas.uses) {
    let agent = use.runtime === "unknown" ? "" : use.runtime;
    if (agent === "") agent = deltas.sessionClients.get(use.sessionId) ?? "";
    const day = kstDay(use.ts);
    const key = `${day}\n${use.skillUri}\n${agent}`;
    const acc = counts.get(key) ?? { day, skillUri: use.skillUri, agent, reads: 0, exposures: 0 };
    if (use.kind === "read") acc.reads++; else acc.exposures++;
    counts.set(key, acc);
  }
  return counts;
}

export type SessionSkillRead = {
  sessionId: string; skillId: string; digest: string; digestSource: "event" | "session_load" | null;
  firstReadMs: number; reads: number;
};
/** 읽음 이벤트를 (세션, 스킬, digest)별 행으로 접는다. 새 평문은 "세션 ID ↔ 스킬 ID ↔ digest ↔ 처음
 *  읽은 시각"과 읽음 횟수뿐이다(검색 노출은 넣지 않는다: skill_daily_usage 담당). digest는 같은 문서
 *  (수집 배치 하나 또는 스냅샷 페이지 하나) 안의 실제 증거만 쓴다:
 *  (1) 읽음 이벤트의 skill_uri에 든 버전, (2) 이벤트 load_id가 가리키는 loads.manifest_digest
 *  (둘 다 digest_source='event'), (3) 같은 세션·같은 스킬에서 이 읽음보다 시각이 엄격히 앞선, 증거를
 *  가진 load 이벤트의 digest('session_load'). 증거가 없으면 알 수 없음(digest='', digest_source NULL).
 *  과거 읽음의 digest를 증거 없이 전파하지 않고, 미래 load나 다른 문서·DB 행에서 찾지 않는다(수집 순서,
 *  배치 경계, 재생 순서와 무관하게 같은 문서는 같은 결과). */
export function sessionSkillReadCounts(deltas: SkillUsageDeltas): Map<string, SessionSkillRead> {
  const rows = new Map<string, SessionSkillRead>();
  const evidence = new Map<string, { digest: string; ts: number }[]>();
  const reads = deltas.uses.filter(use => use.kind === "read");
  const own = (use: PendingUse): string | undefined => {
    const digest = use.uriDigest ?? (use.loadId !== undefined ? deltas.loadDigests.get(use.loadId) : undefined);
    return digest !== undefined && digest !== "" ? digest : undefined;
  };
  for (const use of reads) {
    const digest = own(use);
    if (digest === undefined) continue;
    const pair = `${use.sessionId}\n${use.skillUri}`;
    const list = evidence.get(pair) ?? [];
    list.push({ digest, ts: use.ts });
    evidence.set(pair, list);
  }
  for (const use of reads) {
    const pair = `${use.sessionId}\n${use.skillUri}`;
    let digest = own(use);
    let source: SessionSkillRead["digestSource"] = digest !== undefined ? "event" : null;
    if (digest === undefined) {
      const prior = (evidence.get(pair) ?? []).filter(item => item.ts < use.ts)
        .sort((x, y) => y.ts - x.ts)[0];
      if (prior !== undefined) { digest = prior.digest; source = "session_load"; }
    }
    const resolved = digest ?? "";
    const key = `${pair}\n${resolved}`;
    const acc = rows.get(key) ?? { sessionId: use.sessionId, skillId: use.skillUri, digest: resolved,
      digestSource: source, firstReadMs: use.ts, reads: 0 };
    acc.firstReadMs = Math.min(acc.firstReadMs, use.ts);
    if (source === "event") acc.digestSource = "event";
    acc.reads++;
    rows.set(key, acc);
  }
  return rows;
}
/** 문서별 결과를 합친다(백필: 페이지·배치마다 따로 계산한 행을 같은 키로 더한다). */
export function mergeSessionSkillReads(
  into: Map<string, SessionSkillRead>, from: Map<string, SessionSkillRead>,
): void {
  for (const [key, row] of from) {
    const acc = into.get(key);
    if (acc === undefined) { into.set(key, { ...row }); continue; }
    acc.reads += row.reads;
    acc.firstReadMs = Math.min(acc.firstReadMs, row.firstReadMs);
    if (row.digestSource === "event") acc.digestSource = "event";
    else if (acc.digestSource === null) acc.digestSource = row.digestSource;
  }
}

const sessionIndexSessionSchema = z.looseObject({
  id: z.string(), runtime: z.string(), started_at: z.number(),
});
const sessionIndexEventSchema = z.looseObject({
  id: z.string(), session_id: z.string(), kind: z.string(), ts: z.number(),
});

/** 수집/백필에서 복호화한 콘텐츠 행으로 session_facts·event_facts를 채운다(현재 클라이언트는 메타데이터
 *  변이를 보내지 않아 이 표들이 비어 있다). 쓰는 값은 세션 id·runtime·시작 시각, 이벤트 id·session_id·
 *  kind·시각뿐이고 ended_ms·automated·status·토큰·source_key는 쓰지 않는다(승인 범위 밖이거나 미확정).
 *  리비전이 더 높을 때만 갱신하므로 재전송·재생에 멱등이다. commitId=null은 백필(커밋 없음). */
export function sessionIndexStatements(
  db: D1Database,
  stream: StreamIdentity & { readonly commitId: string | null },
  rows: readonly ContentRow[],
): D1PreparedStatement[] {
  const identity = [stream.accountId, stream.generation, stream.deviceId, stream.sourceDomain];
  const guard = stream.commitId === null ? "1=1" : commitGuard;
  const guardArgs = stream.commitId === null ? [] : [stream.commitId];
  type Pending = { revision: number; sql: "upsert" | "delete"; values: (string | number)[] };
  const sessions = new Map<string, Pending>();
  const events = new Map<string, Pending>();
  const put = (map: Map<string, Pending>, key: string, next: Pending) => {
    const current = map.get(key);
    if (current === undefined || next.revision > current.revision) map.set(key, next);
  };
  for (const row of rows) {
    if (row.table !== "sessions" && row.table !== "events") continue;
    const map = row.table === "sessions" ? sessions : events;
    if (row.operation !== "upsert" || row.values === null) {
      let key: unknown;
      try { key = (JSON.parse(row.key) as unknown[])[0]; } catch { continue; }
      if (typeof key === "string") put(map, key, { revision: row.revision, sql: "delete", values: [] });
      continue;
    }
    if (row.table === "sessions") {
      const parsed = sessionIndexSessionSchema.safeParse(row.values);
      if (parsed.success) put(sessions, parsed.data.id, { revision: row.revision, sql: "upsert",
        values: [parsed.data.runtime, parsed.data.started_at] });
    } else {
      const parsed = sessionIndexEventSchema.safeParse(row.values);
      if (parsed.success) put(events, parsed.data.id, { revision: row.revision, sql: "upsert",
        values: [parsed.data.session_id, parsed.data.kind, parsed.data.ts] });
    }
  }
  const statements: D1PreparedStatement[] = [];
  for (const [key, item] of sessions) {
    statements.push(item.sql === "delete" ?
      db.prepare(`DELETE FROM session_facts WHERE account_id=? AND generation=? AND device_id=?
        AND source_domain=? AND entity_key=? AND revision<=? AND ${guard}`)
        .bind(...identity, key, item.revision, ...guardArgs) :
      db.prepare(`INSERT INTO session_facts
        (account_id,generation,device_id,source_domain,entity_key,revision,facts_json,runtime,started_ms)
        SELECT ?,?,?,?,?,?,'{}',?,? WHERE ${guard}
        AND NOT EXISTS (SELECT 1 FROM entity_tombstones t WHERE t.account_id=? AND t.generation=? AND t.device_id=?
          AND t.source_domain=? AND t.entity_type='session' AND t.entity_key=? AND t.revision>=?)
        ON CONFLICT(account_id,generation,device_id,source_domain,entity_key)
        DO UPDATE SET revision=excluded.revision,runtime=excluded.runtime,started_ms=excluded.started_ms
        WHERE excluded.revision>session_facts.revision`)
        .bind(...identity, key, item.revision, ...item.values, ...guardArgs,
          ...identity, key, item.revision));
  }
  for (const [key, item] of events) {
    statements.push(item.sql === "delete" ?
      db.prepare(`DELETE FROM event_facts WHERE account_id=? AND generation=? AND device_id=?
        AND source_domain=? AND entity_key=? AND revision<=? AND ${guard}`)
        .bind(...identity, key, item.revision, ...guardArgs) :
      db.prepare(`INSERT INTO event_facts
        (account_id,generation,device_id,source_domain,entity_key,revision,facts_json,timestamp_ms,
          recording_orders_json,session_id,kind)
        SELECT ?,?,?,?,?,?,'{}',?,'{}',?,? WHERE ${guard}
        AND NOT EXISTS (SELECT 1 FROM entity_tombstones t WHERE t.account_id=? AND t.generation=? AND t.device_id=?
          AND t.source_domain=? AND t.entity_type='event' AND t.entity_key=? AND t.revision>=?)
        ON CONFLICT(account_id,generation,device_id,source_domain,entity_key)
        DO UPDATE SET revision=excluded.revision,timestamp_ms=excluded.timestamp_ms,
          session_id=excluded.session_id,kind=excluded.kind
        WHERE excluded.revision>event_facts.revision`)
        .bind(...identity, key, item.revision, item.values[2], item.values[0], item.values[1],
          ...guardArgs, ...identity, key, item.revision));
  }
  return statements;
}

/** 수집 커밋과 같은 트랜잭션(commitGuard)에서 증분 갱신. 멱등:
 *  (1) 같은 batch_id 재POST는 영수증 NOT EXISTS가, (2) 이미 적용된 저널 범위의 재전송(다른
 *  batch_id)은 다른 영수증의 journal_through 검사가, (3) 백필이 커버한 범위(snapshot_cut 이하)
 *  의 늦은 재도착은 표식 검사가 건너뛴다. 영수증 INSERT는 증분 뒤에 실행되어 같은 커밋의
 *  증분을 막지 않는다. */
export function skillUsageStatements(
  db: D1Database,
  stream: StreamIdentity & { readonly commitId: string; readonly batchId: string;
    readonly journalFrom: number; readonly journalThrough: number },
  rows: readonly ContentRow[],
): D1PreparedStatement[] {
  const identity = [stream.accountId, stream.generation, stream.deviceId, stream.sourceDomain];
  const counts = skillUsageCounts(skillUsageDeltas(rows));
  const statements: D1PreparedStatement[] = [];
  // skill_daily_usage와 같은 멱등 조건(배치 영수증, 저널 범위 재전송, 백필 커버)을 그대로 쓴다.
  const idempotent = `AND NOT EXISTS (SELECT 1 FROM skill_usage_batches b
          WHERE b.account_id=? AND b.batch_id=?)
        AND NOT EXISTS (SELECT 1 FROM ingest_receipts r
          WHERE r.account_id=? AND r.generation=? AND r.device_id=? AND r.source_domain=?
            AND r.batch_id!=? AND r.journal_from<? AND r.journal_through>?)
        AND NOT EXISTS (SELECT 1 FROM skill_usage_backfills bf
          WHERE bf.account_id=? AND bf.generation=? AND bf.device_id=? AND bf.source_domain=?
            AND bf.snapshot_cut>=?)`;
  for (const acc of sessionSkillReadCounts(skillUsageDeltas(rows)).values()) {
    statements.push(db.prepare(`INSERT INTO session_skill_reads
      (account_id,generation,device_id,source_domain,session_id,skill_id,digest,first_read_ms,reads,digest_source)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${commitGuard} ${idempotent.replace('skill_usage_batches','session_index_batches')}
      ON CONFLICT(account_id,generation,device_id,source_domain,session_id,skill_id,digest)
      DO UPDATE SET reads=reads+excluded.reads,
        first_read_ms=MIN(first_read_ms,excluded.first_read_ms),
        digest_source=CASE WHEN digest_source='event' OR excluded.digest_source='event' THEN 'event'
          ELSE COALESCE(digest_source,excluded.digest_source) END`)
      .bind(...identity, acc.sessionId, acc.skillId, acc.digest, acc.firstReadMs, acc.reads,
        acc.digestSource, stream.commitId, stream.accountId, stream.batchId,
        ...identity, stream.batchId, stream.journalThrough, stream.journalFrom,
        ...identity, stream.journalThrough));
  }
  statements.push(...sessionIndexStatements(db, stream, rows));
  statements.push(db.prepare(`INSERT OR IGNORE INTO session_index_batches
    (account_id,generation,device_id,source_domain,batch_id,applied_at)
    SELECT ?,?,?,?,?,? WHERE ${commitGuard}`)
    .bind(...identity, stream.batchId, Date.now(), stream.commitId));
  for (const acc of counts.values()) {
    statements.push(db.prepare(`INSERT INTO skill_daily_usage
      (account_id,generation,device_id,source_domain,day,skill_id,agent,reads,exposures)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${commitGuard}
        AND NOT EXISTS (SELECT 1 FROM skill_usage_batches b
          WHERE b.account_id=? AND b.batch_id=?)
        AND NOT EXISTS (SELECT 1 FROM ingest_receipts r
          WHERE r.account_id=? AND r.generation=? AND r.device_id=? AND r.source_domain=?
            AND r.batch_id!=? AND r.journal_from<? AND r.journal_through>?)
        AND NOT EXISTS (SELECT 1 FROM skill_usage_backfills bf
          WHERE bf.account_id=? AND bf.generation=? AND bf.device_id=? AND bf.source_domain=?
            AND bf.snapshot_cut>=?)
      ON CONFLICT(account_id,generation,device_id,source_domain,day,skill_id,agent)
      DO UPDATE SET reads=reads+excluded.reads, exposures=exposures+excluded.exposures`)
      .bind(...identity, acc.day, acc.skillUri, acc.agent, acc.reads, acc.exposures,
        stream.commitId, stream.accountId, stream.batchId,
        ...identity, stream.batchId, stream.journalThrough, stream.journalFrom,
        ...identity, stream.journalThrough));
  }
  statements.push(db.prepare(`INSERT OR IGNORE INTO skill_usage_batches
    (account_id,generation,device_id,source_domain,batch_id,applied_at)
    SELECT ?,?,?,?,?,? WHERE ${commitGuard}`)
    .bind(...identity, stream.batchId, Date.now(), stream.commitId));
  return statements;
}

/** 툼스톤(개별 세션/이벤트 삭제) 커밋과 같은 트랜잭션에서 집계를 회수한다. 거친 행은 개별
 *  삭제분을 감산할 수 없으므로 출처 범위 행을 전부 지우고 완료 표식도 지워 coverage를
 *  honest(pending_backfill/empty)로 되돌린다(재백필로 복구 가능). */
export function skillUsageTombstoneStatements(
  db: D1Database,
  stream: StreamIdentity & { readonly commitId: string },
): D1PreparedStatement[] {
  const identity = [stream.accountId, stream.generation, stream.deviceId, stream.sourceDomain];
  return [
    db.prepare(`DELETE FROM skill_daily_usage
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND ${commitGuard}`)
      .bind(...identity, stream.commitId),
    db.prepare(`DELETE FROM skill_daily_usage_backfill
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND ${commitGuard}`)
      .bind(...identity, stream.commitId),
    db.prepare(`DELETE FROM skill_usage_backfills
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND ${commitGuard}`)
      .bind(...identity, stream.commitId),
    db.prepare(`DELETE FROM session_skill_reads
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND ${commitGuard}`)
      .bind(...identity, stream.commitId),
    db.prepare(`DELETE FROM session_skill_reads_backfill
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND ${commitGuard}`)
      .bind(...identity, stream.commitId),
    db.prepare(`DELETE FROM session_index_batches
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND ${commitGuard}`)
      .bind(...identity, stream.commitId),
  ];
}

export const skillUsageReadSchema = reportScopeSchema.readonly();

const aggregateRowSchema = z.object({
  skillUri: z.string(), agent: z.string().nullable(),
  reads: z.number().int(), exposures: z.number().int(),
});

/** 최근 30개 KST 일자 창을 SQL 한 번에. 창 경계는 서버가 KST 일자로 계산한다(기존 롤링
 *  [now−30일, now)에서 KST 일별 경계로 바뀐 조회 의미는 문서에 명시). */
export async function readSkillUsage(env: ContentEnv, principal: IngestPrincipal, input: unknown) {
  if (!principal.scopes.includes("activity:read")) throw new ActivityLedgerError("forbidden");
  const request = skillUsageReadSchema.parse(input);
  await activeFence(env.ACTIVITY, principal);
  await requireContentReadConsent(env.ACCOUNTS, principal, contentScope(request, contentKinds));
  const identity = [principal.accountId, request.generation, request.deviceId, request.sourceDomain];
  const startDay = skillUsageWindowStart(Date.now());
  const rows = z.array(aggregateRowSchema).parse((await env.ACTIVITY.prepare(
    `SELECT skill_id AS skillUri, NULLIF(agent,'') AS agent,
      SUM(reads) AS reads, SUM(exposures) AS exposures
    FROM (
      SELECT skill_id, agent, reads, exposures FROM skill_daily_usage
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND day>=?
      UNION ALL
      SELECT skill_id, agent, reads, exposures FROM skill_daily_usage_backfill
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND day>=?
    ) GROUP BY skill_id, agent ORDER BY skillUri, agent`,
  ).bind(...identity, startDay, ...identity, startDay).all()).results);
  const backfilled = await env.ACTIVITY.prepare(`SELECT snapshot_cut FROM skill_usage_backfills
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?`).bind(...identity).first();
  const hasContent = backfilled !== null ||
    (await env.ACTIVITY.prepare(`SELECT 1 AS x FROM migration_runs
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND state='complete' LIMIT 1`)
      .bind(...identity).first()) !== null ||
    (await env.ACTIVITY.prepare(`SELECT 1 AS x FROM ingest_receipts
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? LIMIT 1`)
      .bind(...identity).first()) !== null;
  return {
    schemaVersion: 1 as const,
    coverage: backfilled !== null ? "current" as const : hasContent ? "pending_backfill" as const : "empty" as const,
    rows,
  };
}

/** 관리용 1회 백필: 최신 완료 스냅샷과 그 cut 이후에 이미 수신된 보관 배치를 재생해 일별
 *  집계를 다시 만들어 백필 테이블을 교체한다(수집 경로의 skill_daily_usage는 건드리지 않는다).
 *  스냅샷이 없는 출처(MCP 직접 수집 등)는 cut 0으로 보관 배치만 재생한다. 재생 대상은
 *  journal_through > cut이고 skill_usage_batches 영수증이 없는 배치 — 영수증이 있는 배치는
 *  수집 경로 증분에 이미 반영됐다(이중 계산 금지). 재생분에 영수증을 새로 쓰지 않는다:
 *  영수증은 증분 적용과 같은 커밋에서만 쓰며, 여기서 쓰면 재백필 때 재생 대상에서 빠져
 *  집계가 사라진다. 이후 증분과의 중복은 ingest_receipts의 배치/저널-범위 거부(409)가 막는다.
 *  보관 기간이 지나 삭제된 배치는 재생할 수 없으므로 건너뛰고 skipped로 보고한다(없는 값을
 *  0으로 채우지 않는다). 멱등: 재실행하면 같은 입력에서 같은 행으로 교체된다(운영 실행은
 *  리드가 수행). */
export async function backfillSkillUsage(env: ContentEnv, principal: IngestPrincipal, input: unknown) {
  if (!principal.scopes.includes("activity:read")) throw new ActivityLedgerError("forbidden");
  const scope = reportScopeSchema.parse(input);
  await activeFence(env.ACTIVITY, principal);
  await requireContentConsent(env.ACCOUNTS, principal, contentScope(scope, contentKinds));
  const identity = [principal.accountId, principal.generation, scope.deviceId, scope.sourceDomain];
  const raw = await env.ACTIVITY.prepare(`SELECT begin_json FROM migration_runs
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND state='complete'
      AND json_extract(begin_json,'$.projectId')=? AND json_extract(begin_json,'$.rootId') IS ?
    ORDER BY cut DESC,json_extract(begin_json,'$.counts.recording_clock') DESC,snapshot_id LIMIT 1`)
    .bind(...identity, scope.projectId, scope.rootId).first();
  // 스냅샷이 없는 출처는 보관 배치 재생만으로 집계한다(cut 0). 스냅샷도 수신 배치도 없는
  // 출처만 source_missing.
  const begin = raw === null ? null : migrationBeginSchema.parse(
    JSON.parse(z.object({ begin_json: z.string() }).parse(raw).begin_json));
  if (begin === null) {
    const received = await env.ACTIVITY.prepare(`SELECT 1 AS x FROM ingest_receipts
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? LIMIT 1`)
      .bind(...identity).first();
    if (received === null) throw new ReportError("source_missing", 404);
  } else {
    const reference = {
      deviceId: scope.deviceId, sourceDomain: scope.sourceDomain,
      generation: scope.generation, snapshotId: begin.snapshotId,
    };
    const status = await exportMigration(env, principal, reference);
    if (!status.accepted || status.migration.snapshotHash !== begin.snapshotHash) {
      throw new ReportError("source_gap");
    }
  }
  const cut = begin?.cut ?? 0;
  const statements: D1PreparedStatement[] = [
    env.ACTIVITY.prepare(`DELETE FROM skill_daily_usage_backfill
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?`).bind(...identity),
    env.ACTIVITY.prepare(`DELETE FROM session_skill_reads_backfill
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?`).bind(...identity),
  ];
  const mergedDeltas: SkillUsageDeltas = { uses: [], sessionClients: new Map(),
    loadDigests: new Map(), skipped: 0 };
  const mergedRows: ContentRow[] = [];
  const mergedReads = new Map<string, SessionSkillRead>();
  // 삭제(tombstone)된 세션/이벤트는 재생으로 되살리지 않는다: 같은 revision 이하의 content 행은 걸러낸다.
  const tombstones = new Map(z.array(z.object({
    entity_type: z.string(), entity_key: z.string(), revision: z.number(),
  })).parse((await env.ACTIVITY.prepare(`SELECT entity_type,entity_key,revision FROM entity_tombstones
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
      AND entity_type IN ('session','event')`).bind(...identity).all()).results)
    .map(t => [`${t.entity_type}\u0000${t.entity_key}`, t.revision] as const));
  const liveRows = (rows: readonly ContentRow[]) => tombstones.size === 0 ? rows : rows.filter(row => {
    const type = row.table === "sessions" ? "session" : row.table === "events" ? "event" : null;
    if (type === null) return true;
    let key: unknown;
    try { key = (JSON.parse(row.key) as unknown[])[0]; } catch { return true; }
    const at = typeof key === "string" ? tombstones.get(`${type}\u0000${key}`) : undefined;
    return at === undefined || row.revision > at;
  });
  const merge = (deltas: SkillUsageDeltas, opts = { daily: true, reads: true }) => {
    if (opts.reads) mergeSessionSkillReads(mergedReads, sessionSkillReadCounts(deltas));
    if (!opts.daily) return;
    mergedDeltas.uses.push(...deltas.uses);
    mergedDeltas.skipped += deltas.skipped;
    for (const [k, v] of deltas.loadDigests) mergedDeltas.loadDigests.set(k, v);
    for (const [k, v] of deltas.sessionClients) {
      if (!mergedDeltas.sessionClients.has(k)) mergedDeltas.sessionClients.set(k, v);
    }
  };
  for (let page = 0; page < (begin?.pageCount ?? 0); page++) {
    const exported = await exportMigration(env, principal, {
      deviceId: scope.deviceId, sourceDomain: scope.sourceDomain,
      generation: scope.generation, snapshotId: begin?.snapshotId ?? "", page,
    });
    if (exported.document === null || exported.migration.snapshotHash !== begin?.snapshotHash) {
      throw new ReportError("source_gap");
    }
    // 전체 페이지를 모은 뒤 접는다: 세션 행이 다른 페이지에 있어도 client_name을 찾을 수 있다.
    const pageRows = liveRows(exported.document.rows);
    mergedRows.push(...pageRows);
    merge(skillUsageDeltas(pageRows));
  }
  // 스냅샷 cut 이후에 이미 수신된 보관 배치를 재생한다. 보관 기간 만료·삭제로 읽을 수 없는
  // 배치는 건너뛰고 skipped에 센다.
  // 세션 인덱스(session_facts/event_facts)는 스킬 영수증과 별개 기준이다: 보관 배치 전부를 재생한다
  // (키 기반 revision-gated upsert라 멱등). 일별 집계는 skill_usage_batches 영수증이 없는 배치만,
  // 세션 읽음 재계산은 session_index_batches 영수증이 없는 배치만 넣는다(수집 경로 증분과 이중 계산 금지).
  const retained = z.array(z.object({
    batch_id: z.string(), skill_receipted: z.number(), index_receipted: z.number(),
  })).parse((await env.ACTIVITY.prepare(
    `SELECT r.batch_id AS batch_id,
      EXISTS (SELECT 1 FROM skill_usage_batches b
        WHERE b.account_id=r.account_id AND b.batch_id=r.batch_id) AS skill_receipted,
      EXISTS (SELECT 1 FROM session_index_batches i
        WHERE i.account_id=r.account_id AND i.batch_id=r.batch_id) AS index_receipted
    FROM ingest_receipts r
    JOIN content_manifests m ON m.account_id=r.account_id AND m.generation=r.generation
      AND m.device_id=r.device_id AND m.source_domain=r.source_domain AND m.batch_id=r.batch_id
    WHERE r.account_id=? AND r.generation=? AND r.device_id=? AND r.source_domain=?
      AND r.journal_through>?
    ORDER BY r.journal_through`,
  ).bind(...identity, cut).all()).results);
  // 읽을 수 없는 배치는 원인을 구분한다. 보관 만료·삭제(content_missing/content_expired)만 skipped로
  // 세고 계속한다. 내용 불일치(content_conflict)는 unreadable로 따로 세고 계속하되 응답에 드러낸다.
  // 키·저장소 장애(key_unavailable, 그 밖의 오류)는 조용히 건너뛰지 않는다: 아무것도 쓰기 전에
  // 중단해 완료로 보이지 않게 하고(coverage는 그대로), 배치 ID와 오류 종류만 로그에 남긴다.
  let unreadable = 0;
  for (const candidate of retained) {
    try {
      const document = await readBatchContent(env, principal,
        { sourceDomain: scope.sourceDomain, batchId: candidate.batch_id });
      const batchRows = liveRows(document.rows);
      mergedRows.push(...batchRows);
      merge(skillUsageDeltas(batchRows),
        { daily: candidate.skill_receipted === 0, reads: candidate.index_receipted === 0 });
    } catch (error) {
      if (error instanceof ContentStorageError &&
          (error.code === "content_missing" || error.code === "content_expired")) {
        mergedDeltas.skipped++;
        continue;
      }
      if (error instanceof ContentStorageError && error.code === "content_conflict") {
        unreadable++;
        continue;
      }
      console.error("skill-usage backfill aborted", candidate.batch_id,
        error instanceof Error ? error.name : "unknown");
      throw error;
    }
  }
  const merged = skillUsageCounts(mergedDeltas);
  for (const acc of merged.values()) {
    statements.push(env.ACTIVITY.prepare(`INSERT INTO skill_daily_usage_backfill
      (account_id,generation,device_id,source_domain,day,skill_id,agent,reads,exposures)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(...identity, acc.day, acc.skillUri, acc.agent, acc.reads, acc.exposures));
  }
  for (const acc of mergedReads.values()) {
    // 문서(스냅샷 페이지·보관 배치)마다 따로 근거를 찾고 합친다. 문서 밖 근거로 digest를 채우지 않는다.
    statements.push(env.ACTIVITY.prepare(`INSERT INTO session_skill_reads_backfill
      (account_id,generation,device_id,source_domain,session_id,skill_id,digest,first_read_ms,reads,digest_source)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(...identity, acc.sessionId, acc.skillId, acc.digest, acc.firstReadMs, acc.reads,
        acc.digestSource));
  }
  statements.push(...sessionIndexStatements(env.ACTIVITY,
    { accountId: principal.accountId, generation: principal.generation, deviceId: scope.deviceId,
      sourceDomain: scope.sourceDomain, commitId: null }, mergedRows));
  const now = Date.now();
  statements.push(env.ACTIVITY.prepare(`INSERT INTO skill_usage_backfills
    (account_id,generation,device_id,source_domain,snapshot_cut,backfilled_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(account_id,generation,device_id,source_domain)
    DO UPDATE SET snapshot_cut=excluded.snapshot_cut,backfilled_at=excluded.backfilled_at`)
    .bind(...identity, cut, now));
  await env.ACTIVITY.batch(statements);
  return {
    schemaVersion: 1 as const, deviceId: scope.deviceId, sourceDomain: scope.sourceDomain,
    snapshotCut: cut, rows: merged.size, skipped: mergedDeltas.skipped,
    ...(unreadable > 0 ? { unreadable } : {}),
  };
}
