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
const eventValuesSchema = z.looseObject({
  id: z.string(), kind: z.string(), ts: z.number(), runtime: z.string(),
  session_id: z.string(),
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
  skillUri: string; kind: "read" | "exposure" };
export type SkillUsageDeltas = {
  uses: PendingUse[];
  /** 같은 배치/스냅샷 안 세션 행의 client_name(메모리에서만 사용, 저장하지 않음). */
  sessionClients: Map<string, string>;
  /** 집계에 필요한 필드가 없어 제외된 이벤트 수(관측용). */
  skipped: number;
};

/** 배치 행에서 사용 이벤트와 세션 client_name 참조를 뽑는다(아직 저장 형태 아님). 리드 결정
 *  (2026-11-20): 세션 상태가 아니라 이벤트 단위로 센다 — load=reads+1, search 후보=exposures+1,
 *  일자=이벤트 ts의 KST 일자, 에이전트=이벤트 runtime(아래 skillUsageCounts에서 보완). */
export function skillUsageDeltas(rows: readonly ContentRow[]): SkillUsageDeltas {
  const uses: PendingUse[] = [];
  const sessionClients = new Map<string, string>();
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
    if (row.table !== "events") continue;
    // 계약 검증을 통과한 행이라도 집계에 필요한 필드가 없으면 건너뛴다(집계 실패가 수집을 막으면 안 된다).
    const parsed = eventValuesSchema.safeParse(row.values);
    if (!parsed.success) { skipped++; continue; }
    const value = parsed.data;
    const data = parseJson<Record<string, unknown>>(value.data_json, {});
    if (value.kind === "load") {
      const uri = value.skill_uri ?? (typeof data.uri === "string" ? data.uri : undefined);
      if (uri !== undefined) uses.push({ sessionId: value.session_id, ts: value.ts,
        runtime: value.runtime, skillUri: uri, kind: "read" });
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
  return { uses, sessionClients, skipped };
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
  ];
  const mergedDeltas: SkillUsageDeltas = { uses: [], sessionClients: new Map(), skipped: 0 };
  const merge = (deltas: SkillUsageDeltas) => {
    mergedDeltas.uses.push(...deltas.uses);
    mergedDeltas.skipped += deltas.skipped;
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
    merge(skillUsageDeltas(exported.document.rows));
  }
  // 스냅샷 cut 이후에 이미 수신된 보관 배치를 재생한다. 보관 기간 만료·삭제로 읽을 수 없는
  // 배치는 건너뛰고 skipped에 센다.
  const retained = z.array(z.object({ batch_id: z.string() })).parse((await env.ACTIVITY.prepare(
    `SELECT r.batch_id AS batch_id FROM ingest_receipts r
    JOIN content_manifests m ON m.account_id=r.account_id AND m.generation=r.generation
      AND m.device_id=r.device_id AND m.source_domain=r.source_domain AND m.batch_id=r.batch_id
    WHERE r.account_id=? AND r.generation=? AND r.device_id=? AND r.source_domain=?
      AND r.journal_through>? AND NOT EXISTS (SELECT 1 FROM skill_usage_batches b
      WHERE b.account_id=r.account_id AND b.batch_id=r.batch_id)
    ORDER BY r.journal_through`,
  ).bind(...identity, cut).all()).results);
  for (const candidate of retained) {
    try {
      const document = await readBatchContent(env, principal,
        { sourceDomain: scope.sourceDomain, batchId: candidate.batch_id });
      merge(skillUsageDeltas(document.rows));
    } catch (error) {
      if (!(error instanceof ContentStorageError)) throw error;
      mergedDeltas.skipped++;
    }
  }
  const merged = skillUsageCounts(mergedDeltas);
  for (const acc of merged.values()) {
    statements.push(env.ACTIVITY.prepare(`INSERT INTO skill_daily_usage_backfill
      (account_id,generation,device_id,source_domain,day,skill_id,agent,reads,exposures)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(...identity, acc.day, acc.skillUri, acc.agent, acc.reads, acc.exposures));
  }
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
  };
}
