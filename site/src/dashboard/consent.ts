import { contentKinds } from "../../../shared/dist/activity-schema.js";
import type { ContentKind } from "../../../shared/dist/activity-schema.js";
import { consentSchema } from "../../../shared/dist/activity-consent.js";
import type { Consent } from "../../../shared/dist/activity-consent.js";

export const CONTENT_KIND_COPY: Record<ContentKind, { readonly label: string; readonly detail: string }> = {
  prompt: { label: "Prompts", detail: "The text you typed to your agent." },
  query: { label: "Skill search queries", detail: "What was searched for when looking up skills." },
  args: { label: "Tool arguments", detail: "Inputs passed to tools during a session." },
  error: { label: "Error messages", detail: "Failures reported by tools and runtimes." },
  path: { label: "File paths", detail: "Paths of files that were read or loaded." },
  "span-attributes": { label: "Span attributes", detail: "Attributes recorded on OpenTelemetry spans." },
  "private-skills": { label: "Private skill contents", detail: "Text of skills that are not public." },
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
  if (contentDays === undefined) problems.push("Content retention must be a whole number of days, at least 1.");
  if (projectionDays === undefined) problems.push("Report retention must be a whole number of days, at least 1.");
  if (backupDays === undefined) problems.push(`Backup retention must be between 0 and ${MAX_BACKUP_DAYS} days.`);
  if (draft.mode === "managed-content") {
    if (draft.kinds.length === 0) problems.push("Choose at least one content category, or switch to metadata only.");
    if (!draft.serverProcessing) problems.push("Confirm that the server may process uploaded content.");
  }
  let backfill: Record<string, unknown> | undefined;
  if (draft.backfill.enabled) {
    const version = integer(draft.backfill.version, 1, Number.MAX_SAFE_INTEGER);
    const journalCut = integer(draft.backfill.journalCut, 0, Number.MAX_SAFE_INTEGER);
    const snapshotId = draft.backfill.snapshotId.trim();
    const fromMs = draft.backfill.allHistory ? -MAX_HISTORY_MS : instant(draft.backfill.from);
    const toMs = draft.backfill.allHistory ? MAX_HISTORY_MS : instant(draft.backfill.to);
    if (version === undefined) problems.push("Snapshot manifest version must be a whole number, at least 1.");
    if (snapshotId === "" || snapshotId.length > 512) problems.push("Enter the snapshot ID printed by `skillar sync prepare`.");
    if (journalCut === undefined) problems.push("Journal cut must be a whole number, at least 0.");
    if (fromMs === undefined || toMs === undefined) problems.push("Enter both ends of the historical range.");
    else if (toMs <= fromMs) problems.push("The historical range must end after it starts.");
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
    return { ok: false, problems: parsed.error.issues.map(issue => `${issue.path.join(".") || "consent"}: ${issue.message}`) };
  }
  return { ok: true, consent: parsed.data };
}

export function describeConsent(consent: Consent): string {
  switch (consent.mode) {
    case "local-only": return "Local only. Nothing is uploaded.";
    case "metadata": return `Metadata only, kept ${consent.retention.contentDays} days.`;
    case "managed-content": {
      const count = consent.contentKinds.length;
      const coverage = count === CONTENT_KINDS.length ? "all seven content categories" : `${count} of ${CONTENT_KINDS.length} content categories`;
      const history = consent.backfill === undefined ? "" : ", plus one prepared historical snapshot";
      return `Metadata and ${coverage}, kept ${consent.retention.contentDays} days${history}.`;
    }
    default: {
      const exhaustive: never = consent;
      return exhaustive;
    }
  }
}
