import type { DashboardProfile, DashboardReportStatus } from "../../../shared/dist/activity-dashboard.js";

export type Availability = DashboardProfile["availability"];
export type AvailabilityCopy = {
  readonly label: string; readonly explanation: string; readonly next: string | null; readonly selectable: boolean;
};

export const AVAILABILITY_COPY: Record<Availability, AvailabilityCopy> = {
  "local-only": {
    label: "Local only", selectable: false,
    explanation: "Upload consent is off for this device.",
    next: "Save upload consent and process a device upload to make its snapshots available here.",
  },
  "metadata-only": {
    label: "Metadata only", selectable: false,
    explanation: "Only session metadata is consented. Reports need all seven content categories.",
    next: "Extend the device's consent to metadata and content.",
  },
  partial: {
    label: "Partial coverage", selectable: false,
    explanation: "Consent covers some content categories or an older consent version. Reports need all seven on the current version.",
    next: "Review the device's consent and include every category.",
  },
  "awaiting-runtime": {
    label: "Awaiting runtime", selectable: false,
    explanation: "Uploads arrived, but the analysis runtime has not processed this source yet.",
    next: "Check back after the next upload completes.",
  },
  ready: {
    label: "Snapshot available", selectable: true,
    explanation: "The newest upload has been processed. Reports are built from that snapshot, not live data.",
    next: null,
  },
  revoked: {
    label: "Revoked", selectable: false,
    explanation: "This device was revoked. Its uploads stopped and its snapshots are no longer shown.",
    next: "Connect a new device to continue.",
  },
};

export function availabilityCopy(availability: Availability): AvailabilityCopy {
  return AVAILABILITY_COPY[availability];
}

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatWhen(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "Never" : whenFormat.format(new Date(ms));
}

export function formatSeconds(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? "Never" : formatWhen(seconds * 1000);
}

export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}\u2026${id.slice(-4)}`;
}

export function profileKey(profile: Pick<DashboardProfile, "deviceId" | "sourceDomain">): string {
  return `${profile.deviceId}\u0000${profile.sourceDomain}`;
}

export type SnapshotLine = { readonly term: string; readonly detail: string; readonly tone?: "pending" | "stale" | "failed" };

export const REPORT_STATE_TEXT: Record<DashboardReportStatus["state"], string> = {
  preparing: "Preparing the report", queued: "Queued on the server", running: "Building the report",
  complete: "Complete", failed: "Failed",
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
    ? `${profile.sourceSequence} / journal ${profile.journalThrough} / runtime ${profile.runtimeSequence ?? "none"}`
    : `${report.inputRevision.sequence} / journal ${report.inputRevision.journalThrough} / runtime ${report.inputRevision.runtimeSequence}`;
  const lines: SnapshotLine[] = [
    { term: "Source captured", detail: formatWhen(captured) },
    { term: "Received by skillar", detail: formatWhen(received) },
    { term: "Revision", detail: revision },
    { term: "Report", detail: failure !== null ? "Request failed" : report === null ? "Not requested yet" : REPORT_STATE_TEXT[report.state],
      ...(failure === null ? {} : { tone: "failed" as const }) },
  ];
  if (report?.pending) lines.push({ term: "Pending", tone: "pending", detail: "The report is still being processed and may not include the newest accepted upload." });
  if (report?.stale) lines.push({ term: "Stale", tone: "stale", detail: "This result may be out of date. Rebuild reports to check the latest processed upload." });
  if (report?.state === "failed") {
    lines.push({ term: "Failure", tone: "failed", detail: report.error === null ? "The server could not build one report. Rebuild reports to retry." :
      `The server reported ${report.error} for one report. Rebuild reports to retry.` });
  }
  if (failure !== null) {
    lines.push({ term: "Request failed", tone: "failed", detail: `The server answered ${failure.status} (${failure.code}) to a report request. Rebuild reports to retry.` });
  }
  return lines;
}
