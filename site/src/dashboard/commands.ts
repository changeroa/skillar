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
  "workflow.put": { label: "워크플로 저장", detail: "기기의 로컬 저장소에서 이 이름의 워크플로를 만들거나 교체합니다." },
  "flow.create": { label: "흐름 시작", detail: "기기에 이미 있는 워크플로로 작업 공간에 흐름을 엽니다." },
  "flow.map-step": { label: "pane을 단계에 연결", detail: "열려 있는 흐름의 pane 하나를 그 워크플로의 단계 하나에 연결합니다." },
  "flow.end": { label: "흐름 종료", detail: "기기에서 열려 있는 흐름을 닫습니다." },
  "eval.add": {
    label: "로컬 평가 사례 추가",
    detail: "기기의 로컬 저장소에 평가 사례를 추가합니다. 위 화면에서 저장한 평가 사례는 skillar에 저장되며, 두 저장소는 별개입니다.",
  },
};

export const FIELD_LABELS = {
  workflowName: "워크플로 이름", workflowSteps: "단계(JSON 배열)",
  workspaceId: "작업 공간 ID", tabId: "탭 ID(선택)", flowName: "워크플로 이름", flowVersion: "워크플로 버전(선택)",
  label: "라벨(선택)", flowId: "흐름 ID", paneId: "pane ID", stepId: "단계 ID",
  query: "검색어", expectedUri: "기대 URI(선택)", fromTraceId: "원본 트레이스 ID(선택)",
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
    "spec.name": FIELD_LABELS.workflowName, "spec.steps": "단계", "spec.steps.*": "단계 {n}", "spec.steps.*.id": "단계 {n} id",
    "spec.steps.*.skills": "단계 {n} skills", "spec.steps.*.skills.*": "단계 {n} skills 항목", "spec.steps.*.together": "단계 {n} together",
    "spec.steps.*.expectTools": "단계 {n} expectTools", "spec.steps.*.expectTools.*": "단계 {n} expectTools 항목",
    "spec.steps.*.doneWhen": "단계 {n} doneWhen",
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
      return issue.origin === "string" && issue.minimum === 1 ? "필수입니다." :
        issue.origin === "array" ? `${issue.minimum}개 이상이어야 합니다.` : `${issue.minimum} 이상이어야 합니다.`;
    case "too_big":
      return issue.origin === "string" ? `${issue.maximum}자 이하여야 합니다.` :
        issue.origin === "array" ? `${issue.maximum}개 이하여야 합니다.` : `${issue.maximum} 이하여야 합니다.`;
    case "invalid_format":
      return issue.format === "regex" ? "영문자, 숫자, 점(.), 밑줄(_), 하이픈(-)만 쓸 수 있으며 영문자나 숫자로 시작해야 합니다." : issue.message;
    case "invalid_type": return `${issue.expected} 형식이어야 합니다.`;
    case "unrecognized_keys": return `알 수 없는 키: ${issue.keys.join(", ")}.`;
    default: return issue.message;
  }
}

function describeIssue(kind: CommandKind, issue: z.ZodIssue): string {
  const index = issue.path.find((part): part is number => typeof part === "number");
  const key = issue.path.map(part => typeof part === "number" ? "*" : String(part)).join(".");
  const label = (ISSUE_LABELS[kind][key] ?? (key === "" ? "명령" : key)).replace("{n}", String((index ?? 0) + 1));
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
    problems.push(`${FIELD_LABELS.workflowSteps}: 필수입니다. 각 단계에 id와 skills 목록이 있는 JSON 배열을 입력하세요.`);
    return [];
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    problems.push(`${FIELD_LABELS.workflowSteps}: 올바른 JSON이 아닙니다 (${error.message}).`);
    return [];
  }
}

export function buildOperation(draft: CommandDraft): OperationBuild {
  const problems: string[] = [];
  const required = (value: string, label: string): string => {
    const text = trimmed(value);
    if (text === "") problems.push(`${label}: 필수입니다.`);
    return text;
  };
  let candidate: Record<string, unknown>;
  switch (draft.kind) {
    case "workflow.put":
      candidate = { kind: draft.kind, spec: { name: required(draft.workflowName, FIELD_LABELS.workflowName), steps: parseSteps(draft.workflowSteps, problems) } };
      break;
    case "flow.create": {
      const version = trimmed(draft.flowVersion);
      if (version !== "" && !/^\d+$/.test(version)) problems.push(`${FIELD_LABELS.flowVersion}: 1 이상의 정수여야 합니다.`);
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
    return { ok: false, problems: [`명령이 skillar가 받는 최대 크기(${MAX_BATCH_BYTES / 1024} KiB)보다 큽니다.`] };
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
    label: "대기 중", tone: "pending",
    explanation: "skillar가 명령을 보관하고 있습니다. 기기가 아직 결과를 보고하지 않았습니다.",
    next: `기기는 다음 동기화(약 ${SYNC_CADENCE_SECONDS}초마다) 때 명령을 적용하되, 그 기기에서 \`${ENABLE_COMMANDS_CLI}\`를 실행한 경우에만 적용합니다. 원격 명령은 기본적으로 꺼져 있습니다. 오프라인이거나 원격 명령을 켜지 않은 기기에서는 대기 상태로 남습니다. 적용 여부는 상태 확인으로 알 수 있습니다.`,
  },
  applied: { label: "적용됨", tone: "applied", explanation: "기기가 이 명령을 적용했습니다.", next: null },
  conflict: {
    label: "충돌", tone: "conflict",
    explanation: "기기의 데이터가 기준 리비전 이후로 바뀌어 명령을 적용하지 않았습니다.",
    next: "기기의 다음 업로드를 기다린 뒤 출처를 새로 고치고, 여기 표시된 리비전이 따라잡으면 다시 제출하세요.",
  },
  rejected: {
    label: "거부됨", tone: "rejected",
    explanation: "기기가 이 명령을 거부했습니다.",
    next: "기술 정보를 확인하고 입력 내용을 고쳐 새 명령을 제출하세요.",
  },
};

const REFUSAL_COPY: Record<RefusalReason, Pick<OutcomeCopy, "explanation" | "next">> = {
  conflict: {
    explanation: "이 출처에 다른 명령이 대기 중이거나 리비전이 바뀌었습니다. 아무것도 대기열에 넣지 않았습니다.",
    next: "출처를 새로 고친 뒤 현재 리비전으로 다시 제출하세요.",
  },
  disabled: {
    explanation: "지금은 서버에서 원격 명령이 꺼져 있거나 이 출처를 더 이상 사용할 수 없습니다. 아무것도 대기열에 넣지 않았습니다.",
    next: "나중에 다시 시도하거나 출처를 다시 읽어 출처 상태를 확인하세요.",
  },
  forbidden: {
    explanation: "이 기기의 동의는 원격 명령을 허용하지 않습니다. 원격 명령에는 일곱 가지 범주를 모두 포함한 현재 버전의 전체 내용 동의가 필요합니다. 아무것도 대기열에 넣지 않았습니다.",
    next: "아래에서 기기의 동의를 확인한 뒤 다시 제출하세요.",
  },
  invalid: { explanation: "skillar가 명령을 잘못된 요청으로 거부했습니다. 아무것도 대기열에 넣지 않았습니다.", next: "입력 내용을 고쳐 다시 제출하세요." },
  "too-large": {
    explanation: `명령이 skillar가 받는 최대 크기(${MAX_BATCH_BYTES / 1024} KiB)보다 큽니다. 아무것도 대기열에 넣지 않았습니다.`,
    next: "내용을 줄여 다시 제출하세요.",
  },
  "rate-limited": { explanation: "요청이 너무 많습니다. 아무것도 대기열에 넣지 않았습니다.", next: "잠시 기다린 뒤 다시 제출하세요." },
  other: { explanation: "skillar가 명령을 대기열에 넣지 못했습니다. 아무것도 대기열에 넣지 않았습니다.", next: "기술 정보를 확인하고 다시 시도하세요." },
};

const UNCERTAIN_NEXT = {
  unchecked: "다시 시도하면 같은 명령 ID와 내용을 보내며 skillar는 이를 한 번으로 셉니다. 먼저 상태를 확인해도 됩니다.",
  missing: "상태 확인에서 이 명령의 기록을 찾지 못했으므로 다시 시도해도 안전합니다. 다시 시도하면 같은 명령 ID와 내용을 보냅니다.",
  unreachable: "상태 확인이 skillar에 도달하지 못했습니다. 연결이 복구되면 다시 시도하세요. 같은 명령 ID와 내용을 보내며 skillar는 이를 한 번으로 셉니다.",
} as const;

export function describeOutcome(submission: Submission): OutcomeCopy {
  const outcome = submission.outcome;
  switch (outcome.kind) {
    case "sending":
      return { label: "보내는 중", tone: "sending", explanation: "skillar가 명령을 보관했다고 확인해 주기를 기다리고 있습니다.", next: null };
    case "uncertain":
      return {
        label: "확인되지 않음", tone: "uncertain",
        explanation: outcome.cause === "network" ? "요청이 완료되지 않아 skillar가 이 명령을 보관하고 있는지 알 수 없습니다." :
          "skillar가 예상과 다르게 응답해 이 명령을 보관하고 있는지 알 수 없습니다.",
        next: UNCERTAIN_NEXT[outcome.check],
      };
    case "refused": return { label: "대기열에 없음", tone: "refused", ...REFUSAL_COPY[outcome.reason] };
    case "tracked": return COMMAND_STATE_COPY[outcome.status.state];
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export const CHECK_COPY: Record<Exclude<CheckResult, "ok">, string> = {
  unreachable: "확인을 위해 skillar에 연결할 수 없었습니다. 표시된 상태는 마지막으로 알려진 것입니다.",
  missing: "skillar에 이 명령의 기록이 더 이상 없습니다. 표시된 상태는 마지막으로 알려진 것입니다.",
  failed: "상태 확인에 실패했습니다. 표시된 상태는 마지막으로 알려진 것입니다.",
};

/** Each variable is followed by a noun or an invariant particle (에서, 에), so no Korean particle has to agree with its final sound. */
export function summarizeOperation(operation: SourceOperation | null): string {
  if (operation === null) return "명령 ID로 조회함";
  switch (operation.kind) {
    case "workflow.put": return `워크플로 ${operation.spec.name} 저장 (단계 ${operation.spec.steps.length}개)`;
    case "flow.create": return `작업 공간 ${operation.workspaceId}에서 흐름 ${operation.spec.name} 시작`;
    case "flow.map-step": return `흐름 ${operation.flowId}에서 단계 ${operation.stepId}에 pane ${operation.paneId} 연결`;
    case "flow.end": return `흐름 ${operation.flowId} 종료`;
    case "eval.add": return `로컬 평가 사례 추가: ${operation.query.length > 60 ? `${operation.query.slice(0, 60)}\u2026` : operation.query}`;
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
