import { isSkillarMcpData } from "../../src/ingest/identity.js";
import { useState } from "preact/hooks";
import type { UsageTokenKey, UsageTokens } from "../../src/analysis/usage.js";
import type { AssignedTreeEvent } from "../../src/types.js";
import { installStyles } from "../charts/sankey";

// The tool and model calls of one skill span, as the Workspaces view and the session trace both render them.
// Every figure here is a reported measurement: what the runtime did not report reads as "unknown", never as 0.

export const UNKNOWN = "알 수 없음";
export const MAX_CALL_ROWS = 12;

export const TOKEN_LABEL: Record<UsageTokenKey, string> = {
  inputTokens: "입력", outputTokens: "출력", cacheReadTokens: "캐시 읽기", cacheCreationTokens: "캐시 생성",
  cacheWriteTokens: "캐시 쓰기", reasoningTokens: "추론", totalTokens: "합계",
};
const TOKEN_FIELDS = Object.entries(TOKEN_LABEL) as [UsageTokenKey, string][];

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** An unmeasured lapse is unknown, never 0 ms. */
export function formatLapse(ms: number | null | undefined): string {
  const value = numberOf(ms);
  if (value === undefined || value < 0) return UNKNOWN;
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}초`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`;
}

/** A runtime that reports no cost (Codex) says unknown, never $0.0000. */
export function formatCostUsd(cost: number | null | undefined): string {
  const value = numberOf(cost);
  return value === undefined ? UNKNOWN : `$${value.toFixed(4)}`;
}

export type TokenPart = { key: UsageTokenKey; label: string; value: number };

/** Token buckets summed per measurement; a bucket no call reported is left out instead of summed as 0. */
export function tokenParts(tokens: readonly UsageTokens[]): TokenPart[] {
  const totals = new Map<UsageTokenKey, number>();
  for (const bucket of tokens) {
    for (const [key] of TOKEN_FIELDS) {
      const value = numberOf(bucket[key]);
      if (value !== undefined) totals.set(key, (totals.get(key) ?? 0) + value);
    }
  }
  return TOKEN_FIELDS.flatMap(([key, label]) => {
    const value = totals.get(key);
    return value === undefined ? [] : [{ key, label, value }];
  });
}

export function callTokenParts(data: Readonly<Record<string, unknown>>): TokenPart[] {
  return TOKEN_FIELDS.flatMap(([key, label]) => {
    const value = numberOf(data[key]);
    return value === undefined ? [] : [{ key, label, value }];
  });
}

export type CallRow = {
  id: string; kind: "tool_call" | "llm_call"; name: string; duration: string;
  /** Reported outcome of a tool call; null when the runtime reported none, and on model calls, which report none. */
  success: boolean | null;
  tokens: TokenPart[];
  /** Cost of a model call, "unknown" when it reported none; null on a tool call, which never carries one. */
  cost: string | null;
  skillarMcp: boolean;
};

export function isCall(event: Pick<AssignedTreeEvent, "kind">): boolean {
  return event.kind === "tool_call" || event.kind === "llm_call";
}

export function callRow(event: Pick<AssignedTreeEvent, "id" | "kind" | "data">): CallRow {
  const data = event.data;
  const tool = event.kind === "tool_call";
  return {
    id: event.id,
    kind: tool ? "tool_call" : "llm_call",
    name: (tool ? stringOf(data.toolName) ?? stringOf(data.name) : stringOf(data.model)) ?? (tool ? "이름 없는 도구" : "이름 없는 모델"),
    duration: formatLapse(numberOf(data.durationMs)),
    success: tool && typeof data.success === "boolean" ? data.success : null,
    tokens: tool ? [] : callTokenParts(data),
    cost: tool ? null : formatCostUsd(numberOf(data.costUsd)),
    skillarMcp: isSkillarMcpData(data),
  };
}

export function callRows(events: readonly Pick<AssignedTreeEvent, "id" | "kind" | "data">[]): CallRow[] {
  return events.filter(isCall).map(callRow);
}

export function Tokens({ parts }: { parts: TokenPart[] }) {
  if (parts.length === 0) return <span class="tok tok--none">토큰 {UNKNOWN}</span>;
  return (
    <>
      {parts.map((part) => (
        <span key={part.key} class="tok">
          <span class="tok__k">{part.label}</span>
          <span class="tok__v">{part.value.toLocaleString()}</span>
        </span>
      ))}
    </>
  );
}

export function CallList({ rows }: { rows: CallRow[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return <p class="calls__none">기록된 도구 호출이나 모델 호출이 없습니다</p>;
  const shown = open ? rows : rows.slice(0, MAX_CALL_ROWS);
  return (
    <>
      <ul class="calls">
        {shown.map((row) => (
          <li key={row.id} class="call" data-kind={row.kind}>
            <span class="call__name">{row.name}</span>
            {row.skillarMcp && <span class="tag" title="skillar 자체 MCP 서버 호출">skillar</span>}
            {row.kind === "tool_call" && (
              row.success === null
                ? <span class="tag tag--dim">결과 {UNKNOWN}</span>
                : <span class={row.success ? "tag tag--ok" : "tag tag--bad"}>{row.success ? "성공" : "실패"}</span>
            )}
            <span class="call__meta">{row.duration}</span>
            {row.kind === "llm_call" && <span class="call__meta">비용 {row.cost}</span>}
            {row.kind === "llm_call" && <Tokens parts={row.tokens} />}
          </li>
        ))}
      </ul>
      {rows.length > MAX_CALL_ROWS && (
        <button type="button" class="foldbtn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "호출 접기" : `호출 ${rows.length}건 모두 보기`}
        </button>
      )}
    </>
  );
}

const CALLS_CSS = `
.calls { list-style: none; display: grid; gap: var(--s-1); margin: var(--s-1) 0 0; padding: 0; }
.calls__none { margin: 0; color: var(--ink-3); font-size: var(--fs-cap); }
.call { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-1) var(--s-2); color: var(--ink-2); font-size: var(--fs-cap); }
.call__name { color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-cap); font-weight: 500; overflow-wrap: anywhere; }
.call__meta { color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tok { display: inline-flex; align-items: baseline; gap: var(--s-1); color: var(--ink-2); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tok--none { color: var(--ink-3); }
.tok__k { color: var(--ink-3); }
`;

installStyles("calls", CALLS_CSS);
