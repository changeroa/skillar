// AGPL-3.0-only. 대시보드 재디자인 2단계: 세션 단위 읽기 API(평문 인덱스만 읽는다).
// 읽는 열은 승인된 평문(event_facts.session_id/kind/timestamp_ms)뿐이다. 본문·검색어는 복호화하지 않는다.
// 모든 질의는 event_facts_session 인덱스 범위 읽기이며(테스트에서 EXPLAIN QUERY PLAN으로 확인),
// 응답의 rowsRead는 D1 meta.rows_read의 합이다(없으면 null — 값을 지어내지 않는다).
import { z } from "zod";
import { contentKinds } from "../../../shared/activity-schema.ts";
import { reportScopeSchema } from "../../../shared/activity-query.ts";
import { CHIP_ID_CHUNK, chipTables, chipsSql, eventsSql, filterOptionsSql, filterSql, metricsSql, sessionCountSql, sessionListSql } from "./session-sql.ts";
import { activeFence } from "./content-db.ts";
import { contentScope, requireContentReadConsent } from "./content-consent.ts";
import { ActivityLedgerError } from "./types.ts";
import type { IngestPrincipal } from "./types.ts";
import type { ContentEnv } from "./content-env.ts";

export const SESSION_METRICS_MAX_IDS = 50;
export const SESSION_EVENTS_MAX_LIMIT = 500;

export const sessionMetricsSchema = reportScopeSchema.extend({
  sessionIds: z.array(z.string().min(1).max(256)).min(1).max(SESSION_METRICS_MAX_IDS),
});
export const sessionEventsSchema = reportScopeSchema.extend({
  sessionId: z.string().min(1).max(256),
  limit: z.number().int().min(1).max(SESSION_EVENTS_MAX_LIMIT).default(200),
  cursor: z.object({ timestampMs: z.number().int(), entityKey: z.string() }).optional(),
});

export const SESSION_LIST_MAX_LIMIT = 100;
export const sessionListSchema = reportScopeSchema.extend({
  /** 기간 필터는 최근 활동 시각(last_event_ms) 범위다. 세션 시작 시각이 아니다(시작은 모르는 세션이 있다). */
  activeFromMs: z.number().int().optional(),
  activeToMs: z.number().int().optional(),
  runtimes: z.array(z.string().min(1).max(64)).max(20).optional(),
  /** facet "검색 있음·읽기 없음": 검색 이벤트 ≥1이고 읽기 0. */
  searchWithoutRead: z.boolean().optional(),
  limit: z.number().int().min(1).max(SESSION_LIST_MAX_LIMIT).default(50),
  cursor: z.object({ lastEventMs: z.number().int(), sessionId: z.string() }).optional(),
});
export const sessionCountSchema = sessionListSchema.omit({ limit: true, cursor: true });

const listRow = z.object({
  sessionId: z.string(), startedMs: z.number().int().nullable(), firstEventMs: z.number().int(),
  lastEventMs: z.number().int(), events: z.number().int(), reads: z.number().int(),
  searches: z.number().int(), runtime: z.string().nullable(),
});
const chipRow = z.object({
  sessionId: z.string(), skillId: z.string(), digest: z.string(), firstReadMs: z.number().int(), reads: z.number().int(),
});

/** 세션 목록(최근 활동순, 키셋 페이지네이션). 요약 표 인덱스 범위 읽기만 한다. */
export async function readSessionList(env: ContentEnv, principal: IngestPrincipal, input: unknown) {
  const request = sessionListSchema.parse(input);
  await authorize(env, principal, request);
  const after = request.cursor;
  const result = await env.ACTIVITY.prepare(sessionListSql(request, after !== undefined)).bind(
    principal.accountId, request.generation, request.deviceId, request.sourceDomain, ...filterSql(request).args,
    ...(after === undefined ? [] : [after.lastEventMs, after.lastEventMs, after.sessionId]), request.limit + 1).all();
  const rows = z.array(listRow).parse(result.results);
  const page = rows.slice(0, request.limit);
  const last = page.at(-1);
  const merged = new Map<string, z.infer<typeof chipRow>>();
  const chipReads: (number | null)[] = [];
  const identity = [principal.accountId, request.generation, request.deviceId, request.sourceDomain];
  const pageIds = page.map(row => row.sessionId);
  for (const table of chipTables) {
    for (let from = 0; from < pageIds.length; from += CHIP_ID_CHUNK) {
      const ids = pageIds.slice(from, from + CHIP_ID_CHUNK);
      const chipResult = await env.ACTIVITY.prepare(chipsSql(table, ids.length)).bind(...identity, ...ids).all();
      chipReads.push(rowsRead(chipResult.meta));
      for (const chip of z.array(chipRow).parse(chipResult.results)) {
        const key = JSON.stringify([chip.sessionId, chip.skillId, chip.digest]);
        const seen = merged.get(key);
        merged.set(key, seen === undefined ? chip : {
          ...seen, firstReadMs: Math.min(seen.firstReadMs, chip.firstReadMs), reads: seen.reads + chip.reads,
        });
      }
    }
  }
  const chips = [...merged.values()].sort((a, b) => a.firstReadMs - b.firstReadMs ||
    (a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0) || (a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0));
  return {
    schemaVersion: 1 as const,
    sessions: page.map(row => ({
      ...row,
      skills: chips.filter(chip => chip.sessionId === row.sessionId).map(chip => ({
        skillId: chip.skillId, digest: chip.digest === "" ? null : chip.digest,
        firstReadMs: chip.firstReadMs, reads: chip.reads,
      })),
    })),
    nextCursor: rows.length > request.limit && last !== undefined ?
      { lastEventMs: last.lastEventMs, sessionId: last.sessionId } : null,
    rowsRead: sumRows([rowsRead(result.meta), ...chipReads]),
  };
}

/** 같은 필터의 총 개수. 요약 표(세션당 1행)만 읽는다: rows_read는 일치 세션 수에 비례한다(이벤트 수가 아니다). */
export async function readSessionCount(env: ContentEnv, principal: IngestPrincipal, input: unknown) {
  const request = sessionCountSchema.parse(input);
  await authorize(env, principal, request);
  const result = await env.ACTIVITY.prepare(sessionCountSql(request)).bind(
    principal.accountId, request.generation, request.deviceId, request.sourceDomain, ...filterSql(request).args).all();
  const total = z.array(z.object({ total: z.number().int() })).parse(result.results)[0]?.total ?? 0;
  return { schemaVersion: 1 as const, total, rowsRead: rowsRead(result.meta) };
}

/** runtime별 세션 수(알 수 없는 runtime은 null로 따로 센다). */
export async function readSessionFilterOptions(env: ContentEnv, principal: IngestPrincipal, input: unknown) {
  const request = reportScopeSchema.parse(input);
  await authorize(env, principal, request);
  const result = await env.ACTIVITY.prepare(filterOptionsSql).bind(
    principal.accountId, request.generation, request.deviceId, request.sourceDomain).all();
  return {
    schemaVersion: 1 as const,
    runtimes: z.array(z.object({ runtime: z.string().nullable(), sessions: z.number().int() })).parse(result.results),
    rowsRead: rowsRead(result.meta),
  };
}


const metricRow = z.object({
  sessionId: z.string(), events: z.number().int(), reads: z.number().int(), searches: z.number().int(),
  firstEventMs: z.number().int(), lastEventMs: z.number().int(),
});
const eventRow = z.object({
  entityKey: z.string(), kind: z.string().nullable(), timestampMs: z.number().int(),
});

function rowsRead(meta: unknown): number | null {
  const value = (meta as { rows_read?: unknown } | undefined)?.rows_read;
  return typeof value === "number" ? value : null;
}
function sumRows(values: readonly (number | null)[]): number | null {
  return values.some((value) => value === null) ? null : values.reduce<number>((a, b) => a + (b ?? 0), 0);
}

async function authorize(env: ContentEnv, principal: IngestPrincipal, scope: z.infer<typeof reportScopeSchema>) {
  if (!principal.scopes.includes("activity:read")) throw new ActivityLedgerError("forbidden");
  await activeFence(env.ACTIVITY, principal);
  await requireContentReadConsent(env.ACCOUNTS, principal, contentScope(scope, contentKinds));
}

/** 세션별 이벤트 수·읽기(load)·검색(search). 세션 id 목록(≤50)에 대한 인덱스 범위 읽기. */
export async function readSessionMetrics(env: ContentEnv, principal: IngestPrincipal, input: unknown) {
  const request = sessionMetricsSchema.parse(input);
  await authorize(env, principal, request);
  const ids = [...new Set(request.sessionIds)];
  const result = await env.ACTIVITY.prepare(metricsSql(ids.length)).bind(principal.accountId, request.generation, request.deviceId, request.sourceDomain, ...ids).all();
  return {
    schemaVersion: 1 as const,
    rows: z.array(metricRow).parse(result.results),
    rowsRead: rowsRead(result.meta),
  };
}

/** 한 세션의 이벤트(시각순). 키셋 페이지네이션: (timestampMs, entityKey) 이후. */
export async function readSessionEvents(env: ContentEnv, principal: IngestPrincipal, input: unknown) {
  const request = sessionEventsSchema.parse(input);
  await authorize(env, principal, request);
  const after = request.cursor;
  const result = await env.ACTIVITY.prepare(eventsSql(after !== undefined)).bind(principal.accountId, request.generation, request.deviceId, request.sourceDomain, request.sessionId,
    ...(after === undefined ? [] : [after.timestampMs, after.timestampMs, after.entityKey]), request.limit + 1).all();
  const rows = z.array(eventRow).parse(result.results);
  const page = rows.slice(0, request.limit);
  const last = page.at(-1);
  return {
    schemaVersion: 1 as const,
    events: page,
    nextCursor: rows.length > request.limit && last !== undefined ?
      { timestampMs: last.timestampMs, entityKey: last.entityKey } : null,
    rowsRead: sumRows([rowsRead(result.meta)]),
  };
}
