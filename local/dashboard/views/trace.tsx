import { RequestCounts, RequestDetails } from "../components/requests";
import { isSkillarMcpData } from "../../src/ingest/identity.js";
import { useEffect, useState } from "preact/hooks";
import type { AbstainReason, EventKind, FindingLabel, RuntimeId, SearchMode, SessionSkillReportDto, SkillSpan, SkillUri,
  TraceStep } from "../../src/types.js";
import { api, type SessionListRow } from "../api";
import { CallList, callRows, isCall } from "../components/calls";
import { Candidates, type CandidateLike } from "../components/candidates";
import { Facts, type Fact } from "../components/facts";
import { UnresolvedLoadNotice } from "../components/skill-evidence";
import { ATTRIBUTION_LABEL, RUNTIME_LABEL, RUNTIME_MARK,
  buildHash, skillName, type ViewProps } from "../state";

// Session trace view (todo 15): header + narrative timeline + candidates panel + "Save as eval case".
// The SSE stream only carries `session` rows (contract), so a live update for the open session
// refetches /api/sessions/:id/trace and the timeline grows by the steps that arrived.
// The stylesheet lives here (injected once) because styles.css belongs to todo 6 in this wave;
// every value traces to a token in DESIGN.md.

export type SearchDetail = {
  kind: "search"; traceId: string; chosen: SkillUri[]; query: string; mode: SearchMode; candidates: CandidateLike[];
  abstained?: { reason: AbstainReason; hint: string }; elapsedMs: number; total: number;
};
type PromptDetail = { kind: "prompt"; text?: string; textLength?: number };
type LoadDetail = { kind: "load"; uri: SkillUri; loadId: string; manifestDigest: string };
type ReadDetail = { kind: "read_file"; skillUri: SkillUri; uri: SkillUri; bytes: number };
type NativeDetail = { kind: "native_skill"; name: string; via: string };
type LlmDetail = { kind: "llm_call"; model?: string; costUsd?: number; durationMs?: number; ttftMs?: number };
type ToolDetail = { kind: "tool_call"; toolName?: string; success?: boolean; durationMs?: number; skillarMcp?: boolean; gisoolMcp?: boolean; args?: string; argsLength?: number; resultBytes?: number };
type ErrorDetail = { kind: "error"; code: string; message: string };

export const PROMPT_FOLD_CHARS = 600;
export const SHORT_DIGEST_CHARS = 8;
export const TOOL_ARGS_PREVIEW_CHARS = 160;
export type ToolArgs = { captured: true; text: string; truncated: boolean } | { captured: false; length: number };
const COST_UNKNOWN = "cost unknown";

export const KIND_LABEL: Record<EventKind, string> = {
  skill_request: "Request",
  session_start: "Session started",
  prompt: "Prompt",
  search: "Searched skillar",
  load: "Loaded skill",
  read_file: "Read resource",
  native_skill: "Native skill",
  llm_call: "Model call",
  tool_call: "Tool run",
  session_end: "Session ended",
  error: "Error",
};
export const MODE_LABEL: Record<SearchMode, string> = { discovery: "discovery", automatic: "automatic", explicit: "explicit" };
export const ABSTAIN_LABEL: Record<AbstainReason, string> = {
  empty_query: "empty query", no_overlap: "no overlap", below_threshold: "below threshold", explicit_only: "explicit only",
};
export const NEVER_CONSULTED = "This session never consulted skillar";
export const SPAN_KIND_LABEL = "Skill active";

/** One timeline row: a recorded step, or a skill span holding the model and tool calls made while it was active. */
export type TimelineItem =
  | { kind: "step"; step: TraceStep }
  | { kind: "span"; span: SkillSpan; turnId: string; finding?: FindingLabel };

/**
 * Folds the session's skill spans into the flat step list: each span is placed right after the step that activated
 * it, and the tool and model steps it owns move inside it, matched one for one by timestamp and kind. Without a
 * skill report (an older daemon, or a session the report cannot be read for) the timeline stays exactly as recorded.
 */
export function planTimeline(steps: readonly TraceStep[], report?: Pick<SessionSkillReportDto, "tree" | "finding">): TimelineItem[] {
  steps = steps.filter((step) => step.kind !== "skill_request");
  if (!report) return steps.map((step) => ({ kind: "step", step }));
  const labels = new Map(report.finding.turns.map((turn) => [turn.turnId, turn.label]));
  const spans = report.tree.turns
    .flatMap((turn) => turn.skillSpans.map((span) => ({ span, turnId: turn.id, finding: labels.get(turn.id) })))
    .sort((a, b) => a.span.startedAt - b.span.startedAt);
  const owned = new Map<string, number>();
  for (const { span } of spans) {
    for (const event of span.events) {
      if (!isCall(event)) continue;
      const key = `${event.ts}:${event.kind}`;
      owned.set(key, (owned.get(key) ?? 0) + 1);
    }
  }
  const items: TimelineItem[] = [];
  let pending = 0;
  const placeUpTo = (ts: number) => {
    while (pending < spans.length) {
      const entry = spans[pending];
      if (entry.span.startedAt > ts) return;
      pending += 1;
      items.push({ kind: "span", span: entry.span, turnId: entry.turnId, ...(entry.finding ? { finding: entry.finding } : {}) });
    }
  };
  for (const step of steps) {
    const key = `${step.ts}:${step.kind}`;
    const remaining = owned.get(key) ?? 0;
    if (remaining > 0) {
      owned.set(key, remaining - 1);
      continue;
    }
    items.push({ kind: "step", step });
    placeUpTo(step.ts);
  }
  placeUpTo(Number.POSITIVE_INFINITY);
  return items;
}

export function spanFacts(span: Pick<SkillSpan, "startedAt" | "endedAt">, calls: number, finding?: FindingLabel): Fact[] {
  const facts: Fact[] = [{ key: "active", value: span.endedAt - span.startedAt }, { key: "calls", value: calls }];
  if (finding) facts.push({ key: "finding", value: finding });
  return facts;
}

export type TraceCounts = { steps: number; searches: number; abstained: number; loads: number; reads: number; natives: number; errors: number };

export function traceCounts(steps: readonly TraceStep[]): TraceCounts {
  const counts: TraceCounts = { steps: steps.length, searches: 0, abstained: 0, loads: 0, reads: 0, natives: 0, errors: 0 };
  for (const step of steps) {
    switch (step.kind) {
      case "search": counts.searches += 1; if (step.detail.abstained) counts.abstained += 1; break;
      case "load": counts.loads += 1; break;
      case "read_file": counts.reads += 1; break;
      case "native_skill": counts.natives += 1; break;
      case "error": counts.errors += 1; break;
      default: break;
    }
  }
  return counts;
}

export function sessionBounds(steps: readonly TraceStep[], row?: Pick<SessionListRow, "startedAt" | "endedAt">): { startedAt?: number; endedAt?: number; lastTs?: number } {
  const first = steps[0];
  const last = steps[steps.length - 1];
  const end = steps.find((step) => step.kind === "session_end");
  return {
    startedAt: row?.startedAt ?? first?.ts,
    endedAt: row?.endedAt ?? end?.ts,
    lastTs: last?.ts,
  };
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60e3);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatOffset(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 10e3) return `+${(ms / 1e3).toFixed(1)}s`;
  if (ms < 60e3) return `+${Math.round(ms / 1e3)}s`;
  const totalSeconds = Math.round(ms / 1e3);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `+${minutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `+${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** First SHORT_DIGEST_CHARS hex chars; catalog digests carry a `sha256:` prefix that is not part of the hash. */
export function shortDigest(digest: string): string {
  return digest ? digest.replace(/^sha256[:-]/, "").slice(0, SHORT_DIGEST_CHARS) : "";
}

/** Search latency as the timeline shows it: sub-millisecond keeps two decimals, under 100 ms one, above that whole ms. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

export function resourcePath(skillUri: string, uri: string): string {
  const dir = skillUri.replace(/\/SKILL\.md$/i, "");
  if (dir && uri.startsWith(`${dir}/`)) return uri.slice(dir.length + 1);
  return uri;
}

export function foldText(text: string, limit = PROMPT_FOLD_CHARS): { head: string; folded: boolean } {
  const chars = Array.from(text);
  if (chars.length <= limit) return { head: text, folded: false };
  return { head: chars.slice(0, limit).join(""), folded: true };
}

export function isSearchStep(step: TraceStep): step is TraceStep & { detail: SearchDetail } {
  return step.kind === "search";
}

export function searchDetail(step: TraceStep): SearchDetail {
  const detail = step.detail as Partial<SearchDetail>;
  return {
    kind: "search",
    traceId: typeof detail.traceId === "string" ? detail.traceId : "",
    chosen: Array.isArray(detail.chosen) ? detail.chosen : [],
    query: typeof detail.query === "string" ? detail.query : "",
    mode: detail.mode ?? "automatic",
    candidates: Array.isArray(detail.candidates) ? detail.candidates : [],
    abstained: detail.abstained,
    elapsedMs: Number(detail.elapsedMs ?? 0),
    total: Number(detail.total ?? (Array.isArray(detail.candidates) ? detail.candidates.length : 0)),
  };
}

export function evalCasePayload(detail: Pick<SearchDetail, "query" | "traceId">): { query: string; fromTraceId?: string } {
  return detail.traceId ? { query: detail.query, fromTraceId: detail.traceId } : { query: detail.query };
}

export function firstPromptOf(steps: readonly TraceStep[], row?: Pick<SessionListRow, "firstPrompt">): string | undefined {
  if (row?.firstPrompt) return row.firstPrompt;
  const prompt = steps.find((step) => step.kind === "prompt");
  const text = (prompt?.detail as PromptDetail | undefined)?.text;
  return text || undefined;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function Runtime({ runtime }: { runtime: RuntimeId }) {
  return (
    <span class="rt">
      <span class="rt__mark" aria-hidden="true">{RUNTIME_MARK[runtime] ?? RUNTIME_MARK.unknown}</span>
      <span>{RUNTIME_LABEL[runtime] ?? RUNTIME_LABEL.unknown}</span>
    </span>
  );
}

function Header({ row, steps, backHref, embedded }: { row?: SessionListRow; steps: TraceStep[]; backHref: string; readonly embedded: boolean }) {
  const Title = embedded ? "h2" : "h1";
  const counts = traceCounts(steps);
  const title = firstPromptOf(steps, row);
  const parts = [
    `${counts.steps} ${counts.steps === 1 ? "step" : "steps"}`,
    `${counts.searches} ${counts.searches === 1 ? "search" : "searches"}`,
    `${counts.loads} ${counts.loads === 1 ? "load" : "loads"}`,
  ];
  if (counts.reads) parts.push(`${counts.reads} ${counts.reads === 1 ? "file read" : "file reads"}`);
  if (counts.natives) parts.push(`${counts.natives} native`);
  if (counts.errors) parts.push(`${counts.errors} ${counts.errors === 1 ? "error" : "errors"}`);
  return (
    <header class="trace__head page-title">
      <a class="trace__back" href={backHref}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        Sessions
      </a>
      <Title class={title ? "trace__title" : "trace__title trace__title--dim"}>{title ?? "(no prompt captured)"}</Title>
      <p class="trace__counts">{parts.join(" \u00b7 ")}</p>
    </header>
  );
}

/** The source and session facts beside the event sequence: the same measured values the header used to carry, no new claim. */
function Inspector({ sessionId, row, steps, liveState, unresolvedLoads, embedded }: { sessionId: string; row?: SessionListRow; steps: TraceStep[]; liveState: ViewProps["live"]["state"]; unresolvedLoads: boolean; readonly embedded: boolean }) {
  const Heading = embedded ? "h3" : "h2";
  const Sub = embedded ? "h4" : "h3";
  const bounds = sessionBounds(steps, row);
  const runtime = row?.runtime;
  let duration: string;
  if (bounds.startedAt === undefined) duration = "-";
  else if (bounds.endedAt !== undefined) duration = formatDuration(bounds.endedAt - bounds.startedAt);
  else if (api.mode !== "cloud" && liveState === "live") duration = `in progress \u00b7 ${formatDuration((bounds.lastTs ?? bounds.startedAt) - bounds.startedAt)} so far`;
  else duration = `${formatDuration((bounds.lastTs ?? bounds.startedAt) - bounds.startedAt)} (no end recorded)`;
  const attribution = row
    ? row.attribution === "none"
      ? `unattributed \u00b7 ${row.attributionReason ?? "reason not reported"}`
      : ATTRIBUTION_LABEL[row.attribution] ?? row.attribution
    : "-";
  return (
    <aside class="trace__inspector" aria-labelledby="trace-inspector-title">
      <Heading id="trace-inspector-title" class="trace__subtitle">세션 정보</Heading>
      <dl class="trace__meta">
        <div>
          <dt>Runtime</dt>
          <dd>{runtime ? <Runtime runtime={runtime} /> : <span class="trace__dim">unknown</span>}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{bounds.startedAt !== undefined ? <time dateTime={new Date(bounds.startedAt).toISOString()}>{dateTimeFmt.format(bounds.startedAt)}</time> : "-"}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{duration}</dd>
        </div>
        <div>
          <dt>Attribution</dt>
          <dd class={row?.attribution === "none" ? "trace__dim" : undefined}>{attribution}</dd>
        </div>
        {row && (
          <div>
            <dt>Requests</dt>
            <dd>{unresolvedLoads ? <span class="tag" data-adoption-status="uncertain">attribution unresolved</span>
              : <RequestCounts summary={row.requests} />}</dd>
          </div>
        )}
        <div>
          <dt>Session</dt>
          <dd class="trace__id">{sessionId}</dd>
        </div>
      </dl>
      <div class="trace__scope">
        <Sub class="trace__scope-title">확인 범위</Sub>
        <p class="trace__note">검색과 읽기 기록은 요청 단위로 확인됩니다. 실제 적용과 작업 성공은 이 기록으로 확인되지 않습니다.</p>
      </div>
    </aside>
  );
}

function StepTime({ ts, startedAt }: { ts: number; startedAt?: number }) {
  const offset = startedAt !== undefined ? formatOffset(ts - startedAt) : "";
  return (
    <time class="tl__time" dateTime={new Date(ts).toISOString()} title={new Date(ts).toLocaleString()}>
      <b>{timeFmt.format(ts)}</b>
      {offset && <span class="tl__offset">{offset}</span>}
    </time>
  );
}

function PromptBody({ detail }: { detail: PromptDetail }) {
  const [open, setOpen] = useState(false);
  if (!detail.text) {
    return <p class="tl__dim">(prompt not captured{detail.textLength !== undefined ? `, ${detail.textLength} chars` : ""})</p>;
  }
  const { head, folded } = foldText(detail.text);
  return (
    <div>
      <p class="tl__text">{open || !folded ? detail.text : `${head}\u2026`}</p>
      {folded && (
        <button type="button" class="foldbtn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : `Show more (${Array.from(detail.text).length} chars)`}
        </button>
      )}
    </div>
  );
}

type SaveState = { status: "idle" | "saving" | "saved" } | { status: "error"; message: string };

function SaveEvalButton({ detail }: { detail: SearchDetail }) {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const save = () => {
    setState({ status: "saving" });
    api.addEvalCase(evalCasePayload(detail))
      .then(() => setState({ status: "saved" }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof Error ? err.message : String(err) }));
  };
  const saved = state.status === "saved";
  return (
    <div class="tl__save">
      <button type="button" class="btn" data-save-eval={state.status} disabled={state.status === "saving" || saved} onClick={save}>
        {saved && <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>}
        {saved ? "Saved as eval case" : state.status === "saving" ? "Saving\u2026" : "Save as eval case"}
      </button>
      {state.status === "error" && <span class="tl__err" role="alert">Could not save: {state.message}</span>}
    </div>
  );
}

function SearchBody({ detail }: { detail: SearchDetail }) {
  const shown = detail.candidates.length;
  const countText = detail.abstained
    ? "abstained"
    : detail.total > shown ? `top ${shown} of ${detail.total}` : `${shown} ${shown === 1 ? "candidate" : "candidates"}`;
  return (
    <div>
      <p class="tl__meta tl__meta--row">
        <span class="tl__mode" title={`mode: ${detail.mode}`}>{MODE_LABEL[detail.mode] ?? detail.mode}</span>
        <span>{formatMs(detail.elapsedMs)}</span>
        <span>{countText}</span>
        {detail.traceId && <span class="tl__id" title="trace id">{detail.traceId}</span>}
      </p>
      <blockquote class="tl__query">{detail.query || <span class="tl__dim">(empty query)</span>}</blockquote>
      {detail.abstained ? (
        <div class="tl__abstain" data-abstained={detail.abstained.reason}>
          <div class="tl__abstain-head">
            <span class="badge badge--succeeded">no_candidates {"\u00b7"} {ABSTAIN_LABEL[detail.abstained.reason] ?? detail.abstained.reason}</span>
          </div>
          <p class="tl__hint">{detail.abstained.hint}</p>
          <SaveEvalButton detail={detail} />
        </div>
      ) : (
        <Candidates candidates={detail.candidates} chosen={detail.chosen} query={detail.query} />
      )}
    </div>
  );
}

function LoadBody({ detail }: { detail: LoadDetail }) {
  return (
    <p class="tl__line">
      <span class="tl__name">{skillName(detail.uri)}</span>
      <span class="tl__uri">{detail.uri}</span>
      {detail.manifestDigest && <span class="tl__digest" title={`manifest ${detail.manifestDigest}`}>@{shortDigest(detail.manifestDigest)}</span>}
    </p>
  );
}

function ReadBody({ detail }: { detail: ReadDetail }) {
  return (
    <p class="tl__line">
      <span class="tl__name tl__name--mono">{resourcePath(detail.skillUri, detail.uri)}</span>
      <span class="tl__meta">{formatBytes(detail.bytes)}</span>
      {detail.skillUri && <span class="tl__meta">from {skillName(detail.skillUri)}</span>}
    </p>
  );
}

function NativeBody({ detail }: { detail: NativeDetail }) {
  return (
    <p class="tl__line">
      <span class="tl__name">{detail.name}</span>
      <span class="tl__meta">via {detail.via}</span>
    </p>
  );
}

/** A runtime that reports no cost (Codex) says "unknown", never $0.00. */
export function formatCost(costUsd: number | undefined): string {
  return typeof costUsd === "number" && Number.isFinite(costUsd) ? `$${costUsd.toFixed(4)}` : COST_UNKNOWN;
}

/** The captured arguments, or how much text the capture level dropped; undefined when the runtime sent none. */
export function toolArgsPreview(detail: ToolDetail): ToolArgs | undefined {
  if (typeof detail.args === "string") {
    const chars = Array.from(detail.args);
    const truncated = chars.length > TOOL_ARGS_PREVIEW_CHARS;
    return { captured: true, text: truncated ? `${chars.slice(0, TOOL_ARGS_PREVIEW_CHARS).join("")}…` : detail.args, truncated };
  }
  return typeof detail.argsLength === "number" ? { captured: false, length: detail.argsLength } : undefined;
}

function LlmBody({ step, detail }: { step: TraceStep; detail: LlmDetail }) {
  return (
    <p class="tl__line">
      <span class="tl__name">{step.summary}</span>
      <span class="tl__meta">{formatCost(detail.costUsd)}</span>
      {detail.durationMs !== undefined && <span class="tl__meta">{formatMs(detail.durationMs)}</span>}
      {detail.ttftMs !== undefined && <span class="tl__meta">first token {formatMs(detail.ttftMs)}</span>}
    </p>
  );
}

function ToolBody({ step, detail }: { step: TraceStep; detail: ToolDetail }) {
  const args = toolArgsPreview(detail);
  return (
    <p class="tl__line">
      <span class="tl__name">{step.summary}</span>
      {args !== undefined && <span class="tl__name tl__name--mono">{args.captured ? args.text : `${args.length} chars not captured`}</span>}
      {detail.resultBytes !== undefined && <span class="tl__meta">result {formatBytes(detail.resultBytes)}</span>}
    </p>
  );
}

function ErrorBody({ detail }: { detail: ErrorDetail }) {
  return (
    <p class="tl__line">
      <span class="tl__code">{detail.code}</span>
      <span class="tl__errmsg">{detail.message}</span>
    </p>
  );
}

function StepBody({ step, bounds }: { step: TraceStep; bounds: ReturnType<typeof sessionBounds> }) {
  switch (step.kind) {
    case "prompt": return <PromptBody detail={step.detail as PromptDetail} />;
    case "search": return <SearchBody detail={searchDetail(step)} />;
    case "load": return <LoadBody detail={step.detail as LoadDetail} />;
    case "read_file": return <ReadBody detail={step.detail as ReadDetail} />;
    case "native_skill": return <NativeBody detail={step.detail as NativeDetail} />;
    case "llm_call": return <LlmBody step={step} detail={step.detail as LlmDetail} />;
    case "tool_call": return <ToolBody step={step} detail={step.detail as ToolDetail} />;
    case "error": return <ErrorBody detail={step.detail as ErrorDetail} />;
    case "session_end":
      return bounds.startedAt !== undefined ? <p class="tl__meta">after {formatDuration(step.ts - bounds.startedAt)}</p> : null;
    case "session_start":
      return null;
    default:
      return <p class="tl__meta">{step.summary}</p>;
  }
}

function Step({ step, bounds }: { step: TraceStep; bounds: ReturnType<typeof sessionBounds> }) {
  const search = step.kind === "search" ? searchDetail(step) : undefined;
  const failedTool = step.kind === "tool_call" && (step.detail as ToolDetail).success === false;
  const skillarTool = step.kind === "tool_call" && isSkillarMcpData(step.detail as ToolDetail);
  const hollow = step.kind === "read_file" || step.kind === "native_skill" || step.kind === "llm_call" || step.kind === "tool_call";
  return (
    <li class={`tl__step tl__step--${step.kind}`} data-kind={step.kind}>
      <span class={hollow ? "tl__dot tl__dot--hollow" : "tl__dot"} aria-hidden="true" />
      <div class="tl__head">
        <span class="tl__kind">{KIND_LABEL[step.kind] ?? step.kind}</span>
        {step.kind === "native_skill" && <span class="tl__tag" title="handled by the runtime's own skill mechanism, not skillar">native</span>}
        {skillarTool && <span class="tl__tag" title="a call to skillar's own MCP server">skillar</span>}
        {failedTool && <span class="tl__tag tl__tag--bad">failed</span>}
        {search?.abstained && <span class="tl__tag tl__tag--bad">abstained</span>}
        <StepTime ts={step.ts} startedAt={bounds.startedAt} />
      </div>
      <div class="tl__body">
        <StepBody step={step} bounds={bounds} />
      </div>
    </li>
  );
}

function SpanGroup({ item, bounds }: { item: Extract<TimelineItem, { kind: "span" }>; bounds: ReturnType<typeof sessionBounds> }) {
  const rows = callRows(item.span.events);
  return (
    <li class="tl__step tl__step--span" data-kind="skill_span" data-skill={item.span.skill} data-turn={item.turnId}>
      <span class="tl__dot tl__dot--hollow" aria-hidden="true" />
      <div class="tl__head">
        <span class="tl__kind">{SPAN_KIND_LABEL}</span>
        <span class="tl__name" title={item.span.uri ?? "no skill uri reported"}>{item.span.name}</span>
        <StepTime ts={item.span.startedAt} startedAt={bounds.startedAt} />
      </div>
      <div class="tl__body">
        <Facts facts={spanFacts(item.span, rows.length, item.finding)} />
        <CallList rows={rows} />
      </div>
    </li>
  );
}

function NotFound({ sessionId, backHref }: { sessionId: string; backHref: string }) {
  return (
    <section class="empty empty--trace">
      <h2>Session not found</h2>
      <p>No events are recorded for <code class="cmd">{sessionId}</code>. It may have been removed by retention, or the link is stale.</p>
      <a class="btn" href={backHref}>Back to sessions</a>
    </section>
  );
}

function NeverConsulted({ counts }: { counts: TraceCounts }) {
  return (
    <div class="callout" role="status" data-empty="never-consulted">
      <strong>{NEVER_CONSULTED}</strong>
      <span>
        No skill search was recorded, so no candidates were ranked.
        {counts.natives ? ` The runtime handled ${counts.natives === 1 ? "one skill" : `${counts.natives} skills`} natively.` : ""}
      </span>
    </div>
  );
}

const STYLE_ID = "skillar-trace-style";

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = TRACE_CSS;
  document.head.append(el);
}

export function TraceView({ route, live, embedded = false }: ViewProps) {
  ensureStyles();
  const sessionId = route.sessionId ?? "";
  const backHref = buildHash({ view: "sessions", filter: route.filter });
  const [steps, setSteps] = useState<TraceStep[]>();
  const [row, setRow] = useState<SessionListRow>();
  const [report, setReport] = useState<SessionSkillReportDto>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setSteps(undefined);
    setRow(undefined);
    setReport(undefined);
    setError(undefined);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.trace(sessionId), api.sessions({}), skillReportOf(sessionId)])
      .then(([trace, rows, skillReport]) => {
        if (cancelled) return;
        setSteps(trace);
        setRow(rows.find((r) => r.id === sessionId));
        setReport(skillReport);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [sessionId, refresh]);

  useEffect(() => {
    if (live.seq === 0 || (live.last && live.last.id !== sessionId)) return;
    setRefresh((n) => n + 1);
  }, [live.seq, sessionId]);

  if (steps === undefined) {
    return (
      <section class="trace" aria-busy="true">
        {error && <p class="notice" role="alert">Could not load the trace: {error}</p>}
      </section>
    );
  }
  if (steps.length === 0 && !row) return <NotFound sessionId={sessionId} backHref={backHref} />;

  const bounds = sessionBounds(steps, row);
  const counts = traceCounts(steps);
  const items = planTimeline(steps, report);
  const Heading = embedded ? "h3" : "h2";
  return (
    <section class="trace" aria-busy="false">
      {error && <p class="notice" role="alert">Live update failed: {error}</p>}
      <Header row={row} steps={steps} backHref={backHref} embedded={embedded} />
      <div class="trace__console">
        <Inspector sessionId={sessionId} row={row} steps={steps} liveState={live.state} unresolvedLoads={(report?.unattributedLoads.count ?? 0) > 0} embedded={embedded} />
        <div class="trace__events">
          {report && <UnresolvedLoadNotice loads={report.unattributedLoads} />}
          {counts.searches === 0 && (report?.unattributedLoads.count ?? 0) === 0 && <NeverConsulted counts={counts} />}
          {items.length > 0 && (
            <>
              <Heading class="trace__subtitle">이벤트 순서</Heading>
              <ol class="tl" aria-label="Session timeline">
                {items.map((item, index) => (item.kind === "step"
                  ? <Step key={`${item.step.ts}-${index}-${item.step.kind}`} step={item.step} bounds={bounds} />
                  : <SpanGroup key={`${item.span.id}-${index}`} item={item} bounds={bounds} />))}
              </ol>
            </>
          )}
          <RequestDetails steps={steps} />
        </div>
      </div>
    </section>
  );
}

/** The skill report is an enhancement: a daemon that cannot answer leaves the timeline exactly as recorded. */
function skillReportOf(sessionId: string): Promise<SessionSkillReportDto | undefined> {
  return api.skillReport(sessionId, { automated: "include" }).catch(() => undefined);
}

const TRACE_CSS = `
.trace { display: grid; gap: var(--s-8); }
.trace__back { display: inline-flex; align-items: center; gap: var(--s-1); justify-self: start; min-height: 44px; color: var(--ink-2); font-size: var(--fs-sm); font-weight: 500; text-decoration: none; }
.trace__back:hover { color: var(--ink); text-decoration: underline; }
.trace__title--dim { color: var(--ink-3); font-weight: 400; }
.trace__counts { font-variant-numeric: tabular-nums; }
/* Console: the event sequence beside a 260px source/session inspector; one column with the inspector first under 960px. */
.trace__console { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: var(--s-8); }
.trace__events { grid-column: 1; display: grid; gap: var(--s-6); align-content: start; min-width: 0; }
.trace__inspector { grid-column: 2; grid-row: 1; display: grid; gap: var(--s-6); align-content: start; min-width: 0; padding-inline-start: var(--s-6); border-inline-start: 1px solid var(--line); }
.trace__subtitle { margin: 0; font-size: var(--fs-section); font-weight: 600; line-height: 1.4; letter-spacing: 0; }
.trace__inspector .trace__subtitle { font-size: var(--fs-subhead); }
.trace__meta { display: grid; gap: var(--s-4); margin: 0; }
.trace__meta > div { display: grid; gap: var(--s-1); align-content: start; min-width: 0; }
.trace__meta dt { color: var(--ink-2); font-size: var(--fs-cap); }
.trace__meta dd { margin: 0; color: var(--ink); font-size: var(--fs-body); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.trace__dim { color: var(--ink-3); }
.trace__id { font-family: var(--font-mono); font-size: var(--fs-cap); color: var(--ink-2); }
.trace__scope { display: grid; gap: var(--s-2); padding-top: var(--s-6); border-top: 1px solid var(--line); }
.trace__scope-title { margin: 0; font-size: var(--fs-body); font-weight: 600; line-height: 1.5; }
.trace__note { margin: 0; color: var(--ink-2); font-size: var(--fs-cap); line-height: 1.65; text-wrap: pretty; }
.empty--trace .btn { text-decoration: none; }
/* Search and load requests: the shared component keeps its card class, the trace shows it flat behind a rule. */
.trace .request-details { margin: 0; padding: var(--s-6) 0 0; border: 0; border-top: 1px solid var(--line); border-radius: 0; background: transparent; overflow-x: auto; }
.trace .request-details h2 { margin: 0 0 var(--s-2); font-size: var(--fs-section); font-weight: 600; line-height: 1.4; letter-spacing: 0; }
.trace .request-details > .dim { margin: 0 0 var(--s-4); }
.trace .request-details th { color: var(--ink-2); font-size: var(--fs-cap); font-weight: 500; }
.trace .request-details th, .trace .request-details td { padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--line); }
.trace .request-details :is(th, td):first-child { padding-inline-start: 0; }
.trace .request-details :is(th, td):last-child { padding-inline-end: 0; }
.trace .request-details .btn { margin-top: var(--s-4); }
/* Event rows: time | content | state, hairline rules, no rail. The head is display: contents so its children take grid cells. */
.tl { list-style: none; margin: 0; padding: 0; }
.tl__step { display: grid; grid-template-columns: 82px minmax(0, 1fr) 116px; grid-auto-flow: row dense; column-gap: var(--s-4); row-gap: var(--s-1); padding: var(--s-4) 0; border-bottom: 1px solid var(--line); }
.tl__head { display: contents; }
.tl__dot { display: none; }
.tl__time { grid-column: 1; grid-row: 1; display: grid; align-content: start; gap: var(--s-1); padding-top: var(--s-1); color: var(--ink-3); font-family: var(--font-mono); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; line-height: 1.5; white-space: nowrap; }
.tl__time b { color: var(--ink-2); font-weight: 500; }
.tl__kind { grid-column: 2; grid-row: 1; color: var(--ink); font-size: var(--fs-subhead); font-weight: 600; line-height: 1.5; }
.tl__head > .tl__name { grid-column: 2; }
.tl__tag { grid-column: 3; align-self: start; padding-top: var(--s-1); color: var(--ink-2); font-size: var(--fs-cap); font-weight: 500; line-height: 1.5; }
.tl__tag--bad { color: var(--bad); }
.tl__body { grid-column: 2; min-width: 0; color: var(--ink-2); font-size: var(--fs-cap); }
.tl__body:empty { display: none; }
.tl__body > :first-child { margin-top: 0; }
.tl__step--span .tl__body { display: grid; gap: var(--s-1); }
.tl__text { margin: 0; color: var(--ink); font-size: var(--fs-body); white-space: pre-wrap; }
.tl__dim { margin: 0; color: var(--ink-3); }
.tl__line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-1) var(--s-2); margin: 0; }
.tl__name { color: var(--ink); font-size: var(--fs-body); font-weight: 500; }
.tl__name--mono { font-family: var(--font-mono); font-size: var(--fs-cap); }
.tl__uri, .tl__digest, .tl__id, .tl__code { font-family: var(--font-mono); font-size: var(--fs-cap); color: var(--ink-3); overflow-wrap: anywhere; }
.tl__code { color: var(--bad); font-weight: 500; }
.tl__errmsg { color: var(--ink-2); }
.tl__meta { margin: 0; color: var(--ink-3); font-size: var(--fs-cap); }
.tl__meta--row { display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-3); }
.tl__mode { color: var(--ink-2); font-weight: 500; }
.tl__query { margin: var(--s-2) 0 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface); color: var(--ink); font-size: var(--fs-body); }
.tl__abstain { display: grid; gap: var(--s-2); margin-top: var(--s-2); padding: var(--s-3) var(--s-4); border-radius: var(--r-sm); background: var(--surface); }
.tl__abstain-head { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.tl__hint { margin: 0; color: var(--ink-2); font-size: var(--fs-body); }
.tl__save { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.tl__save .btn[disabled] { cursor: default; color: var(--ink-2); }
.tl__save .btn[data-save-eval="saved"] { color: var(--ok); }
.tl__err { color: var(--bad); font-size: var(--fs-cap); }
.cands { display: grid; gap: var(--s-1); list-style: none; margin: var(--s-2) 0 0; padding: 0; }
.cands__none { margin: var(--s-2) 0 0; color: var(--ink-3); font-size: var(--fs-cap); }
.cands__legend { margin: var(--s-2) 0 0; color: var(--ink-3); font-size: var(--fs-cap); }
.cands__legend + .cands { margin-top: var(--s-1); }
.cand { display: grid; grid-template-columns: var(--s-5) minmax(0, 11rem) auto minmax(4rem, 1fr) 2.6em 4.6em var(--s-5); grid-template-areas: "rank name inv bar score cov pick" "rank desc desc desc desc desc desc"; align-items: center; column-gap: var(--s-2); padding: var(--s-2); border-radius: var(--r-sm); font-size: var(--fs-sm); }
.cand--chosen { background: var(--wash); }
.cand__rank { grid-area: rank; align-self: start; color: var(--ink-3); font-size: var(--fs-cap); line-height: 1.6; font-variant-numeric: tabular-nums; text-align: right; }
.cand__name { grid-area: name; display: flex; align-items: baseline; gap: var(--s-1); min-width: 0; color: var(--ink); font-weight: 500; }
.cand__nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cand__root { flex: none; color: var(--ink-3); font: 500 var(--fs-micro) / 1 var(--font-mono); letter-spacing: 0; }
.cand__cov { grid-area: cov; color: var(--ink-3); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cand__inv { grid-area: inv; display: inline-flex; align-items: center; min-height: 26px; padding: 0 var(--s-2); border: 1px solid var(--line); border-radius: 0; background: var(--surface-2); color: var(--ink-2); font: 500 var(--fs-micro) / 1 var(--font-mono); letter-spacing: 0; }
.cand__bar { grid-area: bar; display: block; height: 6px; border-radius: var(--r-full); background: var(--wash-2); overflow: hidden; }
.cand__fill { display: block; height: 100%; border-radius: inherit; background: color-mix(in srgb, var(--ink) 35%, transparent); }
.cand--chosen .cand__fill { background: var(--ok); }
.cand__score { grid-area: score; color: var(--ink); font-size: var(--fs-cap); font-weight: 500; font-variant-numeric: tabular-nums; text-align: right; }
.cand__pick { grid-area: pick; display: grid; place-items: center; width: var(--s-5); height: var(--s-5); color: var(--ok); }
.cand__desc { grid-area: desc; color: var(--ink-3); font-size: var(--fs-cap); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cand__matched { color: var(--ink-2); }
@media (max-width: 959.98px) {
  .trace__console { grid-template-columns: minmax(0, 1fr); }
  .trace__inspector, .trace__events { grid-column: 1; }
  .trace__inspector { grid-row: auto; padding-inline-start: 0; border-inline-start: 0; padding-top: var(--s-6); border-top: 1px solid var(--line); }
  .trace__meta { display: flex; flex-wrap: wrap; gap: var(--s-3) var(--s-6); }
}
@media (max-width: 639.98px) {
  .trace .request-details table, .trace .request-details tbody { display: block; }
  .trace .request-details thead { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .trace .request-details tbody tr { display: grid; gap: var(--s-3); padding: var(--s-4) 0; border-bottom: 1px solid var(--line); }
  .trace .request-details td { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--s-3); padding: 0; border: 0; text-align: left; overflow-wrap: anywhere; }
  .trace .request-details td::before { content: attr(data-label); color: var(--ink-2); font-size: var(--fs-cap); font-weight: 500; overflow-wrap: normal; }
  .trace .request-details td > .badge { justify-self: start; }
  .tl__step { grid-template-columns: 72px minmax(0, 1fr); column-gap: var(--s-3); }
  .tl__tag { grid-column: 2; padding-top: 0; }
  .cand { grid-template-columns: var(--s-5) minmax(0, 1fr) auto 2.6em var(--s-5); grid-template-areas: "rank name inv score pick" "rank bar bar cov cov" "rank desc desc desc desc"; row-gap: var(--s-1); }
  .cand__cov { text-align: right; }
  .cand__desc { white-space: normal; }
}
`;
