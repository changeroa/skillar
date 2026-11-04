import type { z } from "zod";
import { sourceOperationSchema } from "../../../shared/dist/activity-commands.js";
import type {
  CommandStatus, CommandStatusRequest, SourceCommandRequest, SourceOperation,
} from "../../../shared/dist/activity-commands.js";
import type { DashboardSource } from "../../../shared/dist/activity-dashboard.js";
import { MAX_BATCH_BYTES } from "../../../shared/dist/activity-schema.js";
import { DashboardRequestError } from "./api.ts";

export type CommandKind = SourceOperation["kind"];
export type CommandState = CommandStatus["state"];

export const COMMAND_KINDS: readonly CommandKind[] = ["workflow.put", "flow.create", "flow.map-step", "flow.end", "eval.add"];
export const ENABLE_COMMANDS_CLI = "skillar sync commands --enable";
export const SYNC_CADENCE_SECONDS = 30;
/** Bytes left for the request envelope (profile, ids, revision) inside the shared 256 KiB request limit. */
const ENVELOPE_BYTES = 1024;

export type CommandKindCopy = { readonly label: string; readonly detail: string };
export const COMMAND_KIND_COPY: Record<CommandKind, CommandKindCopy> = {
  "workflow.put": { label: "Save a workflow", detail: "Creates or replaces the workflow with this name in the device's local store." },
  "flow.create": { label: "Start a flow", detail: "Opens a flow in a workspace from a workflow the device already has." },
  "flow.map-step": { label: "Map a pane to a step", detail: "Links one pane of an open flow to one step of its workflow." },
  "flow.end": { label: "End a flow", detail: "Closes an open flow on the device." },
  "eval.add": {
    label: "Add a local eval case",
    detail: "Adds an eval case to the device's local store. Eval cases saved from the views above are stored by skillar instead; the two stores are separate.",
  },
};

export const FIELD_LABELS = {
  workflowName: "Workflow name", workflowSteps: "Steps (JSON array)",
  workspaceId: "Workspace ID", tabId: "Tab ID (optional)", flowName: "Workflow name", flowVersion: "Workflow version (optional)",
  label: "Label (optional)", flowId: "Flow ID", paneId: "Pane ID", stepId: "Step ID",
  query: "Query", expectedUri: "Expected URI (optional)", fromTraceId: "From trace ID (optional)",
} as const;

export type CommandDraft = {
  readonly kind: CommandKind;
  readonly workflowName: string; readonly workflowSteps: string;
  readonly workspaceId: string; readonly tabId: string; readonly flowName: string; readonly flowVersion: string; readonly label: string;
  readonly flowId: string; readonly paneId: string; readonly stepId: string;
  readonly query: string; readonly expectedUri: string; readonly fromTraceId: string;
};

export function emptyCommandDraft(kind: CommandKind = "workflow.put"): CommandDraft {
  return {
    kind, workflowName: "", workflowSteps: "", workspaceId: "", tabId: "", flowName: "", flowVersion: "", label: "",
    flowId: "", paneId: "", stepId: "", query: "", expectedUri: "", fromTraceId: "",
  };
}

export function draftFromOperation(operation: SourceOperation): CommandDraft {
  const base = emptyCommandDraft(operation.kind);
  switch (operation.kind) {
    case "workflow.put":
      return { ...base, workflowName: operation.spec.name, workflowSteps: JSON.stringify(operation.spec.steps, null, 2) };
    case "flow.create":
      return {
        ...base, workspaceId: operation.workspaceId, tabId: operation.tabId ?? "", flowName: operation.spec.name,
        flowVersion: operation.spec.version === undefined ? "" : String(operation.spec.version), label: operation.label ?? "",
      };
    case "flow.map-step":
      return { ...base, flowId: operation.flowId, paneId: operation.paneId, stepId: operation.stepId };
    case "flow.end":
      return { ...base, flowId: operation.flowId };
    case "eval.add":
      return { ...base, query: operation.query, expectedUri: operation.expectedUri ?? "", fromTraceId: operation.fromTraceId ?? "" };
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

export type OperationBuild =
  | { readonly ok: true; readonly operation: SourceOperation }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Schema paths to field labels; `{n}` is the 1-based step number. */
const ISSUE_LABELS: Record<CommandKind, Readonly<Record<string, string>>> = {
  "workflow.put": {
    "spec.name": FIELD_LABELS.workflowName, "spec.steps": "Steps", "spec.steps.*": "Step {n}", "spec.steps.*.id": "Step {n} id",
    "spec.steps.*.skills": "Step {n} skills", "spec.steps.*.skills.*": "Step {n} skill", "spec.steps.*.together": "Step {n} together",
    "spec.steps.*.expectTools": "Step {n} expectTools", "spec.steps.*.expectTools.*": "Step {n} expected tool",
    "spec.steps.*.doneWhen": "Step {n} doneWhen",
  },
  "flow.create": {
    workspaceId: FIELD_LABELS.workspaceId, tabId: FIELD_LABELS.tabId, "spec.name": FIELD_LABELS.flowName,
    "spec.version": FIELD_LABELS.flowVersion, label: FIELD_LABELS.label,
  },
  "flow.map-step": { flowId: FIELD_LABELS.flowId, paneId: FIELD_LABELS.paneId, stepId: FIELD_LABELS.stepId },
  "flow.end": { flowId: FIELD_LABELS.flowId },
  "eval.add": { query: FIELD_LABELS.query, expectedUri: FIELD_LABELS.expectedUri, fromTraceId: FIELD_LABELS.fromTraceId },
};

function friendlyMessage(issue: z.ZodIssue): string {
  switch (issue.code) {
    case "too_small":
      return issue.origin === "string" && issue.minimum === 1 ? "Required." :
        issue.origin === "array" ? `At least ${issue.minimum} item${issue.minimum === 1 ? "" : "s"}.` : `At least ${issue.minimum}.`;
    case "too_big":
      return issue.origin === "string" ? `At most ${issue.maximum} characters.` :
        issue.origin === "array" ? `At most ${issue.maximum} items.` : `At most ${issue.maximum}.`;
    case "invalid_format":
      return issue.format === "regex" ? "Use letters, digits, dots, underscores or hyphens, starting with a letter or digit." : issue.message;
    case "invalid_type": return `Expected ${issue.expected}.`;
    case "unrecognized_keys": return `Unknown ${issue.keys.length === 1 ? "key" : "keys"}: ${issue.keys.join(", ")}.`;
    default: return issue.message;
  }
}

function describeIssue(kind: CommandKind, issue: z.ZodIssue): string {
  const index = issue.path.find((part): part is number => typeof part === "number");
  const key = issue.path.map(part => typeof part === "number" ? "*" : String(part)).join(".");
  const label = (ISSUE_LABELS[kind][key] ?? (key === "" ? "Command" : key)).replace("{n}", String((index ?? 0) + 1));
  return `${label}: ${friendlyMessage(issue)}`;
}

const trimmed = (value: string): string => value.trim();

function optionalText(key: string, value: string): Record<string, string> {
  const text = trimmed(value);
  return text === "" ? {} : { [key]: text };
}

function parseSteps(text: string, problems: string[]): unknown {
  const source = trimmed(text);
  if (source === "") {
    problems.push(`${FIELD_LABELS.workflowSteps}: required. Enter a JSON array of steps, each with an id and a skills list.`);
    return [];
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    problems.push(`${FIELD_LABELS.workflowSteps}: not valid JSON (${error.message}).`);
    return [];
  }
}

export function buildOperation(draft: CommandDraft): OperationBuild {
  const problems: string[] = [];
  const required = (value: string, label: string): string => {
    const text = trimmed(value);
    if (text === "") problems.push(`${label}: required.`);
    return text;
  };
  let candidate: Record<string, unknown>;
  switch (draft.kind) {
    case "workflow.put":
      candidate = { kind: draft.kind, spec: { name: required(draft.workflowName, FIELD_LABELS.workflowName), steps: parseSteps(draft.workflowSteps, problems) } };
      break;
    case "flow.create": {
      const version = trimmed(draft.flowVersion);
      if (version !== "" && !/^\d+$/.test(version)) problems.push(`${FIELD_LABELS.flowVersion}: a whole number, at least 1.`);
      candidate = {
        kind: draft.kind, workspaceId: required(draft.workspaceId, FIELD_LABELS.workspaceId), ...optionalText("tabId", draft.tabId),
        spec: { name: required(draft.flowName, FIELD_LABELS.flowName), ...(version === "" ? {} : { version: Number(version) }) },
        ...optionalText("label", draft.label),
      };
      break;
    }
    case "flow.map-step":
      candidate = {
        kind: draft.kind, flowId: required(draft.flowId, FIELD_LABELS.flowId), paneId: required(draft.paneId, FIELD_LABELS.paneId),
        stepId: required(draft.stepId, FIELD_LABELS.stepId),
      };
      break;
    case "flow.end":
      candidate = { kind: draft.kind, flowId: required(draft.flowId, FIELD_LABELS.flowId) };
      break;
    case "eval.add":
      candidate = {
        kind: draft.kind, query: required(draft.query, FIELD_LABELS.query),
        ...optionalText("expectedUri", draft.expectedUri), ...optionalText("fromTraceId", draft.fromTraceId),
      };
      break;
    default: {
      const exhaustive: never = draft.kind;
      return exhaustive;
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  const parsed = sourceOperationSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map(issue => describeIssue(draft.kind, issue)))] };
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).length > MAX_BATCH_BYTES - ENVELOPE_BYTES) {
    return { ok: false, problems: [`The command is larger than skillar accepts (${MAX_BATCH_BYTES / 1024} KiB).`] };
  }
  return { ok: true, operation: parsed.data };
}

export type UncertainCause = "network" | "server";
export type RefusalReason = "conflict" | "disabled" | "forbidden" | "invalid" | "too-large" | "rate-limited" | "other";
export type CheckResult = "ok" | "unreachable" | "missing" | "failed";
export type Outcome =
  | { readonly kind: "sending" }
  | { readonly kind: "uncertain"; readonly cause: UncertainCause; readonly check: "unchecked" | "missing" | "unreachable" }
  | { readonly kind: "refused"; readonly reason: RefusalReason; readonly technical: string }
  | { readonly kind: "tracked"; readonly status: CommandStatus; readonly check: CheckResult; readonly technical: string | null };

export type Submission = {
  readonly commandId: string;
  readonly profile: DashboardSource;
  readonly baseRevision: number;
  readonly operation: SourceOperation | null;
  readonly sourcesLoad: number;
  readonly outcome: Outcome;
};

export type Failure =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "uncertain"; readonly cause: UncertainCause; readonly technical: string }
  | { readonly kind: "refused"; readonly reason: RefusalReason; readonly technical: string };

/** 5xx, network and unparseable answers are uncertain: the command may be held, so only an exact retry is offered. */
export function classifyFailure(error: unknown): Failure {
  if (error instanceof DashboardRequestError) {
    const technical = `${error.status} (${error.code})`;
    if (error.status === 401) return { kind: "unauthorized" };
    if (error.status >= 500) return { kind: "uncertain", cause: "server", technical };
    const reason: RefusalReason =
      error.status === 409 && error.code === "command_conflict" ? "conflict" :
      error.status === 403 ? "forbidden" : error.status === 404 ? "disabled" :
      error.status === 400 || error.status === 422 ? "invalid" : error.status === 413 ? "too-large" :
      error.status === 429 ? "rate-limited" : "other";
    return { kind: "refused", reason, technical };
  }
  if (error instanceof TypeError) return { kind: "uncertain", cause: "network", technical: "network" };
  return { kind: "uncertain", cause: "server", technical: error instanceof Error ? error.name : "unknown" };
}

const trackedOutcome = (status: CommandStatus): Outcome => ({ kind: "tracked", status, check: "ok", technical: null });

export function newSubmission(
  profile: DashboardSource, baseRevision: number, operation: SourceOperation, sourcesLoad: number, commandId: string = crypto.randomUUID(),
): Submission {
  return { commandId, profile, baseRevision, operation, sourcesLoad, outcome: { kind: "sending" } };
}

export function fromStatus(profile: DashboardSource, status: CommandStatus, sourcesLoad: number): Submission {
  return { commandId: status.commandId, profile, baseRevision: status.baseRevision, operation: null, sourcesLoad, outcome: trackedOutcome(status) };
}

/** The exact request for a first send and for every retry: same ID, base and operation, so skillar counts it once. */
export function commandRequest(submission: Submission): SourceCommandRequest {
  if (submission.operation === null) throw new TypeError("command_operation_required");
  return { profile: submission.profile, commandId: submission.commandId, baseRevision: submission.baseRevision, operation: submission.operation };
}

export function statusRequest(submission: Submission): CommandStatusRequest {
  return { profile: submission.profile, commandId: submission.commandId };
}

export function sending(submission: Submission): Submission {
  return { ...submission, outcome: { kind: "sending" } };
}

export function submitted(submission: Submission, status: CommandStatus): Submission {
  return { ...submission, outcome: trackedOutcome(status) };
}

export function submitFailed(submission: Submission, failure: Failure): Submission {
  switch (failure.kind) {
    case "unauthorized": return submission;
    case "uncertain": return { ...submission, outcome: { kind: "uncertain", cause: failure.cause, check: "unchecked" } };
    case "refused": return { ...submission, outcome: { kind: "refused", reason: failure.reason, technical: failure.technical } };
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

export function checked(submission: Submission, status: CommandStatus): Submission {
  return { ...submission, baseRevision: status.baseRevision, outcome: trackedOutcome(status) };
}

export function checkFailed(submission: Submission, failure: Failure): Submission {
  const missing = failure.kind === "refused" && failure.reason === "disabled";
  const outcome = submission.outcome;
  if (outcome.kind === "uncertain") return { ...submission, outcome: { ...outcome, check: missing ? "missing" : "unreachable" } };
  if (outcome.kind !== "tracked") return submission;
  const check: CheckResult = missing ? "missing" : failure.kind === "uncertain" && failure.cause === "network" ? "unreachable" : "failed";
  return { ...submission, outcome: { ...outcome, check, technical: failure.kind === "unauthorized" ? null : failure.technical } };
}

export function isConflict(submission: Submission): boolean {
  const outcome = submission.outcome;
  return (outcome.kind === "refused" && outcome.reason === "conflict") || (outcome.kind === "tracked" && outcome.status.state === "conflict");
}

export type Actions = {
  readonly retry: boolean; readonly check: boolean; readonly refresh: boolean; readonly resubmit: boolean; readonly edit: boolean;
};

/** A fresh source load must cover the base cut or the device's known conflict cut. */
export function nextActions(submission: Submission, journalThrough: number, sourcesLoad: number): Actions {
  const outcome = submission.outcome;
  const conflict = isConflict(submission);
  const sourceRevision = outcome.kind === "tracked" ? outcome.status.sourceRevision : null;
  const caughtUp = sourceRevision === null ? journalThrough >= submission.baseRevision : journalThrough >= sourceRevision;
  return {
    retry: outcome.kind === "uncertain",
    check: outcome.kind === "uncertain" || (outcome.kind === "tracked" && outcome.status.state === "pending"),
    refresh: conflict,
    resubmit: conflict && submission.operation !== null && sourcesLoad > submission.sourcesLoad && caughtUp,
    edit: submission.operation !== null && (outcome.kind === "refused" || (outcome.kind === "tracked" && outcome.status.state !== "pending")),
  };
}

export type Tone = "sending" | "uncertain" | "refused" | CommandState;
export type OutcomeCopy = { readonly label: string; readonly tone: Tone; readonly explanation: string; readonly next: string | null };

export const COMMAND_STATE_COPY: Record<CommandState, OutcomeCopy> = {
  pending: {
    label: "Pending", tone: "pending",
    explanation: "skillar holds the command. The device has not reported a result.",
    next: `The device applies it on its next sync, about every ${SYNC_CADENCE_SECONDS} seconds, only if \`${ENABLE_COMMANDS_CLI}\` was run there; remote commands are off by default. An offline or opted-out device leaves it pending. Check status to see whether it was applied.`,
  },
  applied: { label: "Applied", tone: "applied", explanation: "The device applied this command.", next: null },
  conflict: {
    label: "Conflict", tone: "conflict",
    explanation: "The device's data had moved past the base revision, so it did not apply the command.",
    next: "Wait for the device's next upload, refresh sources, then submit again once the revision here has caught up.",
  },
  rejected: {
    label: "Rejected", tone: "rejected",
    explanation: "The device refused this command.",
    next: "Read the technical details, correct the form and submit a new command.",
  },
};

const REFUSAL_COPY: Record<RefusalReason, Pick<OutcomeCopy, "explanation" | "next">> = {
  conflict: {
    explanation: "Another command is pending for this source, or its revision changed. Nothing was queued.",
    next: "Refresh sources, then submit again with the current revision.",
  },
  disabled: {
    explanation: "Remote commands are switched off on the server right now, or this source is no longer available. Nothing was queued.",
    next: "Try again later, or reload sources to check the source.",
  },
  forbidden: {
    explanation: "This device's consent does not allow remote commands; they need its current full content consent with all seven categories. Nothing was queued.",
    next: "Review the device's consent below, then submit again.",
  },
  invalid: { explanation: "skillar rejected the command as invalid. Nothing was queued.", next: "Correct the form and submit again." },
  "too-large": {
    explanation: `The command is larger than skillar accepts (${MAX_BATCH_BYTES / 1024} KiB). Nothing was queued.`,
    next: "Shorten it and submit again.",
  },
  "rate-limited": { explanation: "Too many requests. Nothing was queued.", next: "Wait a minute and submit again." },
  other: { explanation: "skillar could not queue the command. Nothing was queued.", next: "Read the technical details and try again." },
};

const UNCERTAIN_NEXT = {
  unchecked: "Retry sends the same command ID and content, which skillar counts once; or check its status first.",
  missing: "A status check found no record of it, so retrying is safe. Retry sends the same command ID and content.",
  unreachable: "A status check could not reach skillar. Retry when your connection is back; it sends the same command ID and content, which skillar counts once.",
} as const;

export function describeOutcome(submission: Submission): OutcomeCopy {
  const outcome = submission.outcome;
  switch (outcome.kind) {
    case "sending":
      return { label: "Sending", tone: "sending", explanation: "Waiting for skillar to confirm it holds the command.", next: null };
    case "uncertain":
      return {
        label: "Not confirmed", tone: "uncertain",
        explanation: outcome.cause === "network" ? "The request did not complete, so skillar may or may not hold this command." :
          "skillar did not answer as expected, so it may or may not hold this command.",
        next: UNCERTAIN_NEXT[outcome.check],
      };
    case "refused": return { label: "Not queued", tone: "refused", ...REFUSAL_COPY[outcome.reason] };
    case "tracked": return COMMAND_STATE_COPY[outcome.status.state];
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export const CHECK_COPY: Record<Exclude<CheckResult, "ok">, string> = {
  unreachable: "Couldn't reach skillar to check; the state shown is the last one known.",
  missing: "skillar no longer has a record of this command; the state shown is the last one known.",
  failed: "The status check failed; the state shown is the last one known.",
};

export function summarizeOperation(operation: SourceOperation | null): string {
  if (operation === null) return "Looked up by command ID";
  switch (operation.kind) {
    case "workflow.put": return `Save workflow ${operation.spec.name} (${operation.spec.steps.length} step${operation.spec.steps.length === 1 ? "" : "s"})`;
    case "flow.create": return `Start flow ${operation.spec.name} in workspace ${operation.workspaceId}`;
    case "flow.map-step": return `Map pane ${operation.paneId} to step ${operation.stepId} in flow ${operation.flowId}`;
    case "flow.end": return `End flow ${operation.flowId}`;
    case "eval.add": return `Add local eval case: ${operation.query.length > 60 ? `${operation.query.slice(0, 60)}\u2026` : operation.query}`;
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

export type ResultEntry = { readonly key: string; readonly value: string };

export function resultEntries(status: CommandStatus | null): readonly ResultEntry[] {
  if (status === null || status.result === null) return [];
  return Object.entries(status.result).map(([key, value]) => ({
    key, value: typeof value === "string" ? value : JSON.stringify(value) ?? "undefined",
  }));
}

const COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isCommandId(text: string): boolean {
  return COMMAND_ID.test(text);
}
