import { z } from "zod";
import { deviceIdSchema, sourceDomainSchema } from "./activity-schema.js";
import { consentSchema } from "./activity-consent.js";
import { activityQuerySchema } from "./activity-query.js";

/** Browser requests use the Google session; no device bearer reaches the browser. */
export const dashboardPaths = {
  profiles: "/api/dashboard/profiles",
  status: "/api/dashboard/status",
  query: "/api/dashboard/query",
  skillUsage: "/api/dashboard/skill-usage",
  skillUsageBackfill: "/api/dashboard/skill-usage/backfill",
  sessions: "/api/dashboard/sessions",
  sessionsCount: "/api/dashboard/sessions/count",
  sessionsFilterOptions: "/api/dashboard/sessions/filter-options",
  sessionsMetrics: "/api/dashboard/sessions/metrics",
  sessionsEvents: "/api/dashboard/sessions/events",
  skillReads: "/api/dashboard/skills/reads",
  reportStatus: "/api/dashboard/reports/status",
  reportResult: "/api/dashboard/reports/result",
  evalCases: "/api/dashboard/eval-cases",
} as const;
export const dashboardServicePaths = {
  profiles: "/v1/activity/dashboard/profiles",
  evalCases: "/v1/activity/dashboard/eval-cases",
} as const;
export const dashboardSourceSchema = z.strictObject({
  deviceId: deviceIdSchema, sourceDomain: sourceDomainSchema,
}).readonly();
export type DashboardSource = z.infer<typeof dashboardSourceSchema>;
const timestamp = z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000);
export const dashboardSourceHeadSchema = dashboardSourceSchema.unwrap().extend({
  sourceSequence: z.number().int().nonnegative(),
  journalThrough: z.number().int().nonnegative(),
  runtimeSequence: z.number().int().positive().nullable(),
  capturedAtMs: timestamp.nullable(), receivedAtMs: timestamp.nullable(),
}).readonly();
export const dashboardDeviceSchema = z.strictObject({
  deviceId: deviceIdSchema, createdAt: timestamp, revokedAt: timestamp.nullable(),
  consentVersion: z.number().int().nonnegative(), consent: consentSchema,
  // core-minimum C: 기기 이름·최근 사용. 활동 서비스가 아직 보내지 않을 수 있어 optional(미제공 시 UI가 명시).
  label: z.string().nullable().optional(), lastUsedAt: timestamp.nullable().optional(),
}).readonly();
export const dashboardProfileSchema = dashboardSourceHeadSchema.unwrap().extend({
  availability: z.enum(["local-only", "metadata-only", "partial", "awaiting-runtime", "ready", "revoked"]),
}).readonly();
export const dashboardProfilesSchema = z.strictObject({
  schemaVersion: z.literal(1), ingestEnabled: z.boolean(),
  devices: z.array(dashboardDeviceSchema).readonly(), profiles: z.array(dashboardProfileSchema).readonly(),
}).readonly();
export type DashboardProfiles = z.infer<typeof dashboardProfilesSchema>;
export type DashboardProfile = z.infer<typeof dashboardProfileSchema>;
export const dashboardQuerySchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(),
  query: activityQuerySchema, tz: z.string().min(1).max(100).default("UTC"),
}).readonly();
/** 스킬 탭 활동 필터용 평문 일별 집계 조회/백필 요청. 조회 창(최근 30개 KST 일자)은 서버가
 *  KST 일자 경계로 계산한다. 백필은 관리용 1회 경로이며 최신 스냅샷 전체를 재계산한다. */
/** 조회 창(KST 일자 수). 생략하면 30일. 집계 보존은 출처 동의의 보존 일수까지라 그보다 긴 창은 보존 밖 일자를 포함하지 못한다. */
export const SKILL_USAGE_WINDOWS = [7, 30, 90] as const;
export const dashboardSkillUsageSchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
}).readonly();
export const dashboardSkillUsageBackfillSchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(),
  // 큰 출처를 여러 호출로 나눠 재생하는 실행 옵션(없으면 한 번에 끝까지).
  maxBatches: z.number().int().min(1).max(1000).optional(),
}).readonly();
export const dashboardSkillUsageRowSchema = z.strictObject({
  skillUri: z.string(), agent: z.string().nullable(),
  reads: z.number().int().nonnegative(), exposures: z.number().int().nonnegative(),
}).readonly();
export const dashboardSkillUsageResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  coverage: z.enum(["current", "pending_backfill", "empty"]),
  rows: z.array(dashboardSkillUsageRowSchema).readonly(),
}).readonly();
export type DashboardSkillUsageResult = z.infer<typeof dashboardSkillUsageResultSchema>;
export const dashboardSkillUsageBackfillResultSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal(1), deviceId: z.string(), sourceDomain: z.string(),
    snapshotCut: z.number().int(), rows: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(), unreadable: z.number().int().positive().optional(),
  }),
  // 아직 재생할 단위가 남은 중간 응답: 완료 표식은 바뀌지 않았다.
  z.strictObject({
    schemaVersion: z.literal(1), deviceId: z.string(), sourceDomain: z.string(),
    snapshotCut: z.number().int(), partial: z.literal(true),
    replayed: z.number().int().nonnegative(), remaining: z.number().int().positive(),
    skipped: z.number().int().nonnegative(), unreadable: z.number().int().positive().optional(),
  }),
]).readonly();
/** 세션 화면 요청(평문 요약/인덱스만 읽는다; 브라우저는 POST만 쓴다). 기간 필터는 최근 활동 시각 범위다. */
const sessionFilterFields = {
  activeFromMs: timestamp.optional(), activeToMs: timestamp.optional(),
  runtimes: z.array(z.string().min(1).max(64)).max(20).optional(),
  searchWithoutRead: z.boolean().optional(),
  skillId: z.string().uuid().optional(),
};
export const dashboardSessionListRequestSchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(), ...sessionFilterFields,
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.strictObject({ lastEventMs: timestamp, sessionId: z.string().min(1).max(256) }).optional(),
}).readonly();
export const dashboardSessionCountRequestSchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(), ...sessionFilterFields,
}).readonly();
export const dashboardSessionFilterOptionsRequestSchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(),
}).readonly();
export const dashboardSessionMetricsRequestSchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(),
  sessionIds: z.array(z.string().min(1).max(256)).min(1).max(50),
}).readonly();
export const dashboardSessionEventsRequestSchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(),
  sessionId: z.string().min(1).max(256), limit: z.number().int().min(1).max(500).optional(),
  cursor: z.strictObject({ timestampMs: timestamp, entityKey: z.string() }).optional(),
}).readonly();
/** rowsRead: 요청이 D1에서 읽은 행 수(D1 meta.rows_read 합). 값이 없으면 null(지어내지 않는다). */
const rowsReadField = z.number().int().nonnegative().nullable();
export const dashboardSessionListResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessions: z.array(z.strictObject({
    sessionId: z.string(),
    /** 실제 시작 시각(session_facts에 있을 때만). 없으면 null = 알 수 없음. 처음 관측한 이벤트 시각이 아니다. */
    startedMs: timestamp.nullable(),
    firstEventMs: timestamp, lastEventMs: timestamp,
    events: z.number().int().nonnegative(), reads: z.number().int().nonnegative(),
    searches: z.number().int().nonnegative(), runtime: z.string().nullable(),
    skills: z.array(z.strictObject({
      skillId: z.string(), digest: z.string().nullable(), firstReadMs: timestamp,
      reads: z.number().int().nonnegative(),
    }).readonly()).readonly(),
  }).readonly()).readonly(),
  nextCursor: z.strictObject({ lastEventMs: timestamp, sessionId: z.string() }).nullable(),
  rowsRead: rowsReadField,
}).readonly();
export const dashboardSessionCountResultSchema = z.strictObject({
  schemaVersion: z.literal(1), total: z.number().int().nonnegative(), rowsRead: rowsReadField,
}).readonly();
export const dashboardSessionFilterOptionsResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runtimes: z.array(z.strictObject({
    runtime: z.string().nullable(), sessions: z.number().int().nonnegative(),
  }).readonly()).readonly(),
  rowsRead: rowsReadField,
}).readonly();
export const dashboardSessionMetricsResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  rows: z.array(z.strictObject({
    sessionId: z.string(), events: z.number().int().nonnegative(), reads: z.number().int().nonnegative(),
    searches: z.number().int().nonnegative(), firstEventMs: timestamp, lastEventMs: timestamp,
  }).readonly()).readonly(),
  rowsRead: rowsReadField,
}).readonly();
export const dashboardSessionEventsResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  events: z.array(z.strictObject({
    entityKey: z.string(), kind: z.string().nullable(), timestampMs: timestamp,
  }).readonly()).readonly(),
  nextCursor: z.strictObject({ timestampMs: timestamp, entityKey: z.string() }).nullable(),
  rowsRead: rowsReadField,
}).readonly();
/** 스킬 digest별 읽은 세션 수(session_skill_reads 평문만 읽는다).
 *  firstReadFromMs: "이 시각 이후 처음 읽은" 세션만 센다(저장된 값은 처음 읽은 시각과 누적 읽기 수뿐이라
 *  "기간 내 읽기 수"는 알 수 없다). skillId는 스킬 UUID이고 두 저장 URI 형태(skill://, skillar://)를 모두 센다. */
export const dashboardSkillReadsRequestSchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(),
  skillId: z.string().uuid(), firstReadFromMs: timestamp.optional(),
}).readonly();
export const dashboardSkillReadsResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** digest null = 저장된 근거가 없어 모름. 다른 digest에 합치지 않는다. */
  rows: z.array(z.strictObject({
    digest: z.string().nullable(), sessions: z.number().int().nonnegative(),
    reads: z.number().int().nonnegative(), firstReadMs: timestamp, lastFirstReadMs: timestamp,
  }).readonly()).readonly(),
  /** 서로 다른 세션 수(한 세션이 여러 digest를 읽어도 한 번). digest별 sessions의 합과 다를 수 있다. */
  totalSessions: z.number().int().nonnegative(),
  rowsRead: rowsReadField,
}).readonly();
export const dashboardReferenceSchema = z.strictObject({
  profile: dashboardSourceSchema, jobId: z.string().uuid(),
}).readonly();
export const dashboardResultPartRequestSchema = dashboardReferenceSchema.unwrap().extend({
  part: z.number().int().nonnegative().max(4095),
}).readonly();
export const dashboardReportStatusSchema = z.object({
  schemaVersion: z.literal(1), jobId: z.string().uuid(),
  state: z.enum(["preparing", "queued", "running", "complete", "failed"]),
  generatedAt: timestamp, sourceCapturedAt: timestamp, sourceReceivedAt: timestamp.nullable(),
  inputRevision: z.object({
    sequence: z.number().int().nonnegative(), journalThrough: z.number().int().nonnegative(),
    runtimeSequence: z.number().int().positive(),
  }).readonly(),
  analysisVersion: z.number().int().positive(), stale: z.boolean(), pending: z.boolean(),
  error: z.string().nullable(),
  result: z.object({
    parts: z.number().int().positive().max(4096), bytes: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  }).nullable(),
}).readonly();
export type DashboardReportStatus = z.infer<typeof dashboardReportStatusSchema>;
export const dashboardResultPartSchema = z.strictObject({
  index: z.number().int().nonnegative(), bytes: z.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/), body: z.string().max(200_000),
}).readonly();
export const dashboardEvalInputSchema = z.strictObject({
  query: z.string().min(1).max(64_000), expectedUri: z.string().max(2048).optional(),
  fromTraceId: z.string().max(512).optional(),
}).readonly();
export const dashboardEvalRequestSchema = z.strictObject({
  profile: dashboardSourceSchema, requestId: z.string().uuid(), input: dashboardEvalInputSchema,
}).readonly();
export const dashboardEvalReceiptSchema = z.strictObject({
  caseId: z.string().min(1), state: z.literal("stored"), retainedUntilMs: timestamp,
}).readonly();
