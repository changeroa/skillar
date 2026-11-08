import { contentKinds } from "../../../shared/dist/activity-schema.js";
import type { ContentKind } from "../../../shared/dist/activity-schema.js";
import { consentSchema } from "../../../shared/dist/activity-consent.js";
import type { Consent } from "../../../shared/dist/activity-consent.js";

export const CONTENT_KIND_COPY: Record<ContentKind, { readonly label: string; readonly detail: string }> = {
  prompt: { label: "프롬프트", detail: "에이전트에 입력한 텍스트입니다." },
  query: { label: "스킬 검색어", detail: "스킬을 찾을 때 검색한 내용입니다." },
  args: { label: "도구 인자", detail: "세션 중 도구에 전달된 입력입니다." },
  error: { label: "오류 메시지", detail: "도구와 실행 환경이 보고한 실패입니다." },
  path: { label: "파일 경로", detail: "읽었거나 불러온 파일의 경로입니다." },
  "span-attributes": { label: "스팬 속성", detail: "OpenTelemetry 스팬에 기록된 속성입니다." },
  "private-skills": { label: "비공개 스킬 내용", detail: "공개되지 않은 스킬의 본문입니다." },
};
export const CONTENT_KINDS: readonly ContentKind[] = contentKinds;
export const DEFAULT_RETENTION_DAYS = 30;
export const MAX_BACKUP_DAYS = 30;
const MAX_HISTORY_MS = 8_640_000_000_000_000;

export type ConsentMode = Consent["mode"];
export type BackfillDraft = {
  readonly enabled: boolean; readonly version: string; readonly snapshotId: string;
  readonly journalCut: string; readonly from: string; readonly to: string;
  readonly allHistory: boolean;
};
export type ConsentDraft = {
  readonly mode: ConsentMode;
  readonly kinds: readonly ContentKind[];
  readonly serverProcessing: boolean;
  readonly contentDays: string;
  readonly projectionDays: string;
  readonly backupDays: string;
  readonly backfill: BackfillDraft;
};
export type ConsentBuild =
  | { readonly ok: true; readonly consent: Consent }
  | { readonly ok: false; readonly problems: readonly string[] };

export const projectIdFor = (deviceId: string): string => `device:${deviceId}`;

const emptyBackfill: BackfillDraft = { enabled: false, version: "1", snapshotId: "", journalCut: "", from: "", to: "", allHistory: false };

export function emptyDraft(): ConsentDraft {
  return {
    mode: "local-only", kinds: [], serverProcessing: false,
    contentDays: String(DEFAULT_RETENTION_DAYS), projectionDays: String(DEFAULT_RETENTION_DAYS),
    backupDays: String(MAX_BACKUP_DAYS), backfill: emptyBackfill,
  };
}

export const isExactMilliseconds = (text: string): boolean => /^-?\d+$/.test(text.trim());

function toLocalInput(ms: number): string {
  const date = new Date(ms);
  if (date.getFullYear() < 1000 || date.getFullYear() > 9999) return String(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return new Date(local).getTime() === ms ? local : String(ms);
}

export function draftFromConsent(consent: Consent): ConsentDraft {
  if (consent.mode === "local-only") return emptyDraft();
  const allHistory = consent.backfill?.range.fromMs === -MAX_HISTORY_MS &&
    consent.backfill.range.toMs === MAX_HISTORY_MS;
  const backfill: BackfillDraft = consent.backfill === undefined ? emptyBackfill : {
    enabled: true, version: String(consent.backfill.version), snapshotId: consent.backfill.snapshotId,
    journalCut: String(consent.backfill.journalCut), allHistory,
    from: toLocalInput(consent.backfill.range.fromMs),
    to: toLocalInput(consent.backfill.range.toMs),
  };
  return {
    mode: consent.mode,
    kinds: consent.mode === "managed-content" ? consent.contentKinds : [],
    serverProcessing: consent.mode === "managed-content",
    contentDays: String(consent.retention.contentDays), projectionDays: String(consent.retention.projectionDays),
    backupDays: String(consent.retention.backupDays), backfill,
  };
}

function integer(text: string, min: number, max: number): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : undefined;
}

function instant(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const value = isExactMilliseconds(trimmed) ? Number(trimmed) : new Date(trimmed).getTime();
  return Number.isSafeInteger(value) ? value : undefined;
}

export function buildConsent(draft: ConsentDraft, deviceId: string, baseVersion: number, nowMs: number): ConsentBuild {
  if (draft.mode === "local-only") return { ok: true, consent: consentSchema.parse({ mode: "local-only" }) };
  const problems: string[] = [];
  const contentDays = integer(draft.contentDays, 1, Number.MAX_SAFE_INTEGER);
  const projectionDays = integer(draft.projectionDays, 1, Number.MAX_SAFE_INTEGER);
  const backupDays = integer(draft.backupDays, 0, MAX_BACKUP_DAYS);
  if (contentDays === undefined) problems.push("내용 보존 기간은 1 이상의 정수(일)여야 합니다.");
  if (projectionDays === undefined) problems.push("보고서 보존 기간은 1 이상의 정수(일)여야 합니다.");
  if (backupDays === undefined) problems.push(`백업 보존 기간은 0일부터 ${MAX_BACKUP_DAYS}일 사이여야 합니다.`);
  if (draft.mode === "managed-content") {
    if (draft.kinds.length === 0) problems.push("내용 범주를 하나 이상 선택하거나 메타데이터만으로 바꾸세요.");
    if (!draft.serverProcessing) problems.push("서버가 업로드된 내용을 처리해도 된다고 확인해 주세요.");
  }
  let backfill: Record<string, unknown> | undefined;
  if (draft.backfill.enabled) {
    const version = integer(draft.backfill.version, 1, Number.MAX_SAFE_INTEGER);
    const journalCut = integer(draft.backfill.journalCut, 0, Number.MAX_SAFE_INTEGER);
    const snapshotId = draft.backfill.snapshotId.trim();
    const fromMs = draft.backfill.allHistory ? -MAX_HISTORY_MS : instant(draft.backfill.from);
    const toMs = draft.backfill.allHistory ? MAX_HISTORY_MS : instant(draft.backfill.to);
    if (version === undefined) problems.push("스냅샷 매니페스트 버전은 1 이상의 정수여야 합니다.");
    if (snapshotId === "" || snapshotId.length > 512) problems.push("`skillar sync prepare`가 출력한 스냅샷 ID를 입력하세요.");
    if (journalCut === undefined) problems.push("저널 컷은 0 이상의 정수여야 합니다.");
    if (fromMs === undefined || toMs === undefined) problems.push("과거 범위의 시작과 끝을 모두 입력하세요.");
    else if (toMs <= fromMs) problems.push("과거 범위의 끝은 시작보다 뒤여야 합니다.");
    backfill = { version, snapshotId, journalCut, range: { fromMs, toMs } };
  }
  if (problems.length > 0) return { ok: false, problems };
  const common = {
    version: baseVersion + 1, grantedAtMs: nowMs,
    scope: { deviceId, projectIds: [projectIdFor(deviceId)], rootIds: [] },
    retention: { contentDays, projectionDays, backupDays },
    ...(backfill === undefined ? {} : { backfill }),
  };
  const candidate = draft.mode === "metadata" ? { ...common, mode: "metadata" } : {
    ...common, mode: "managed-content", serverProcessingAcknowledged: true,
    contentKinds: CONTENT_KINDS.filter(kind => draft.kinds.includes(kind)), externalModelTransfer: false,
  };
  const parsed = consentSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map(issue => `${issue.path.join(".") || "동의"}: ${issue.message}`) };
  }
  return { ok: true, consent: parsed.data };
}

export function describeConsent(consent: Consent): string {
  switch (consent.mode) {
    case "local-only": return "로컬 전용. 아무것도 업로드하지 않습니다.";
    case "metadata": return `메타데이터만, ${consent.retention.contentDays}일 보존.`;
    case "managed-content": {
      const count = consent.contentKinds.length;
      const coverage = count === CONTENT_KINDS.length ? "일곱 가지 내용 범주 전체" : `내용 범주 ${CONTENT_KINDS.length}개 중 ${count}개`;
      const history = consent.backfill === undefined ? "" : ", 준비된 과거 스냅샷 1개 포함";
      return `메타데이터와 ${coverage}, ${consent.retention.contentDays}일 보존${history}.`;
    }
    default: {
      const exhaustive: never = consent;
      return exhaustive;
    }
  }
}
