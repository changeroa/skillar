import type { DashboardProfile, DashboardReportStatus } from "../../../shared/dist/activity-dashboard.js";
import { KST_TIME_ZONE } from "../time.ts";

export type Availability = DashboardProfile["availability"];
export type AvailabilityCopy = {
  readonly label: string; readonly explanation: string; readonly next: string | null; readonly selectable: boolean;
};

export const AVAILABILITY_COPY: Record<Availability, AvailabilityCopy> = {
  "local-only": {
    label: "로컬 전용", selectable: false,
    explanation: "이 기기는 업로드 동의가 꺼져 있습니다.",
    next: "업로드 동의를 저장하고 기기 업로드가 처리되면 여기에서 기록을 볼 수 있습니다.",
  },
  "metadata-only": {
    label: "메타데이터만", selectable: false,
    explanation: "세션 메타데이터에만 동의했습니다. 보고서에는 일곱 가지 내용 범주가 모두 필요합니다.",
    next: "기기의 동의를 메타데이터와 내용까지 넓히세요.",
  },
  partial: {
    label: "일부만 포함", selectable: false,
    explanation: "동의가 일부 내용 범주만 포함하거나 이전 동의 버전입니다. 보고서에는 현재 버전에서 일곱 가지가 모두 필요합니다.",
    next: "기기의 동의를 확인하고 모든 범주를 포함하세요.",
  },
  "awaiting-runtime": {
    label: "실행 환경 대기 중", selectable: false,
    explanation: "업로드는 도착했지만 분석 실행 환경이 이 출처를 아직 처리하지 않았습니다.",
    next: "다음 업로드가 끝난 뒤 다시 확인하세요.",
  },
  ready: {
    label: "기록 있음", selectable: true,
    explanation: "보고서는 업로드된 기록을 사용합니다. 실시간 연결은 새 업로드가 도착하면 화면을 새로 고칩니다.",
    next: null,
  },
  revoked: {
    label: "연결 해제됨", selectable: false,
    explanation: "이 기기는 연결이 해제되었습니다. 업로드가 멈추고 기록도 더 이상 표시되지 않습니다.",
    next: "계속하려면 새 기기를 연결하세요.",
  },
};

export function availabilityCopy(availability: Availability): AvailabilityCopy {
  return AVAILABILITY_COPY[availability];
}

const whenFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: KST_TIME_ZONE });

export function formatWhen(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "없음" : `${whenFormat.format(new Date(ms))} KST`;
}

export function formatSeconds(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? "없음" : formatWhen(seconds * 1000);
}

export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}\u2026${id.slice(-4)}`;
}

export function profileKey(profile: Pick<DashboardProfile, "deviceId" | "sourceDomain">): string {
  return `${profile.deviceId}\u0000${profile.sourceDomain}`;
}

export type SnapshotLine = { readonly term: string; readonly detail: string; readonly technical?: string; readonly tone?: "pending" | "stale" | "failed" };

export const REPORT_STATE_TEXT: Record<DashboardReportStatus["state"], string> = {
  preparing: "보고서 준비 중", queued: "서버에서 대기 중", running: "보고서 만드는 중",
  complete: "완료", failed: "실패",
};

export function mergeReports(reports: Iterable<DashboardReportStatus>): DashboardReportStatus | null {
  let latest: DashboardReportStatus | null = null;
  let active: DashboardReportStatus | null = null;
  let failed: DashboardReportStatus | null = null;
  let stale = false;
  let pending = false;
  for (const report of reports) {
    if (latest === null || report.generatedAt >= latest.generatedAt) latest = report;
    if (report.state === "failed") failed ??= report;
    else if (report.state !== "complete") active ??= report;
    stale ||= report.stale;
    pending ||= report.pending;
  }
  if (latest === null) return null;
  const base = active ?? failed ?? latest;
  return { ...base, stale, pending, error: failed === null ? null : failed.error };
}

export type RequestFailure = { readonly status: number; readonly code: string };

export function snapshotLines(
  profile: DashboardProfile, report: DashboardReportStatus | null, failure: RequestFailure | null = null,
): readonly SnapshotLine[] {
  const captured = report?.sourceCapturedAt ?? profile.capturedAtMs;
  const received = report?.sourceReceivedAt ?? profile.receivedAtMs;
  const revision = report === null
    ? `${profile.sourceSequence} / 저널 ${profile.journalThrough} / 실행 환경 ${profile.runtimeSequence ?? "없음"}`
    : `${report.inputRevision.sequence} / 저널 ${report.inputRevision.journalThrough} / 실행 환경 ${report.inputRevision.runtimeSequence}`;
  const lines: SnapshotLine[] = [
    { term: "출처 수집 시각", detail: formatWhen(captured) },
    { term: "skillar 수신 시각", detail: formatWhen(received) },
    { term: "리비전", detail: revision },
    { term: "보고서", detail: failure !== null ? "요청 실패" : report === null ? "아직 요청하지 않음" :
      report.state === "failed" && report.error === "flow_not_found" ? "일부 보고서 데이터 없음" : REPORT_STATE_TEXT[report.state],
      ...(failure === null ? {} : { tone: "failed" as const }) },
  ];
  if (report?.pending) lines.push({ term: "대기 중", tone: "pending", detail: "보고서가 아직 처리 중이어서 가장 최근에 접수된 업로드가 포함되지 않았을 수 있습니다." });
  if (report?.stale) lines.push({ term: "오래됨", tone: "stale", detail: "이 결과는 최신이 아닐 수 있습니다. 보고서를 다시 만들어 가장 최근에 처리된 업로드를 확인하세요." });
  if (report?.state === "failed") {
    lines.push({ term: "실패", tone: "failed",
      detail: report.error === "flow_not_found" ? "이 기록에는 작업 공간 사용 흐름 요약이 없습니다. 다른 보고서는 그대로 볼 수 있습니다." :
        "서버가 보고서 하나를 만들지 못했습니다. 보고서를 다시 만들어 재시도하세요.",
      ...(report.error === null ? {} : { technical: report.error }) });
  }
  if (failure !== null) {
    lines.push({ term: "요청 실패", tone: "failed",
      detail: failure.status >= 500 ? "클라우드 보고서 서비스를 일시적으로 사용할 수 없습니다. 나중에 보고서를 다시 만들어 보세요." :
        failure.status === 403 ? "기기 또는 기기의 동의가 더 이상 이 보고서를 허용하지 않습니다. 출처를 다시 읽고 동의를 확인하세요." :
        "클라우드 보고서 요청을 완료할 수 없었습니다. 출처를 다시 읽고 다시 시도하세요.",
      technical: `${failure.status} (${failure.code})` });
  }
  return lines;
}
