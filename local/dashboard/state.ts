import { REQUEST_STATUSES, hasStatus, type RequestStatus, type SearchResult } from "../src/request-status.js";
import type { AdoptionState, Attribution, FindingLabel, Filter, RuntimeId, SessionRow, TurnBasis } from "../src/types.js";
import type { StepStatus } from "../src/workflow/compare.js";
import type { LiveState, SessionListRow } from "./api";

// URL state for the dashboard. Routes live in location.hash so the daemon only serves "/":
//   #/sessions?runtime=codex,gemini&state=loaded&q=review
//   #/sessions/<id>?from=...      (trace view keeps the list filter so "back" restores it)
//   #/workspaces?from=...          (herdr flows and workspaces)
//   #/workspaces/<flow id>         (one flow; an unregistered workspace is addressed as "ws:<id>")
//   #/flow?skill=skill://local/agents/pr-review-ko/SKILL.md
//   #/heatmap?dow=1&hour=9&hourSpan=2
//   #/evaluation                         (saved-query labels and persisted rank comparisons)
// The query part uses exactly the server's Filter params (from,to epoch ms; runtime,skill,state
// comma lists; dow,hour,hourSpan ints; q), so the same string feeds /api/* calls.

export const RUNTIME_IDS: readonly RuntimeId[] = ["claude-code", "codex", "gemini", "cursor", "omo", "gajae", "openclaw", "unknown"];
export const ADOPTION_STATES: readonly AdoptionState[] = ["loaded", "exposed_only", "no_match", "aborted", "not_used"];
export const FILTER_KEYS = ["from", "to", "runtime", "skill", "state", "dow", "hour", "hourSpan", "q", "automated", "searchStatus", "loadStatus", "searchResult"] as const satisfies readonly (keyof Filter)[];
export type FilterKey = (typeof FILTER_KEYS)[number];

export type View = "dashboard" | "sessions" | "trace" | "workspaces" | "workspace" | "flow" | "heatmap" | "evaluation" | "not-found";
export const SESSION_SORTS = ["-started", "started", "runtime", "-runtime", "state", "-state", "reads", "-reads", "duration", "-duration"] as const;
export type SessionSort = (typeof SESSION_SORTS)[number];
export const SESSION_COLUMNS = ["started", "runtime", "state", "reads", "candidates", "duration", "prompt", "search", "load", "attribution", "id"] as const;
export type SessionColumn = (typeof SESSION_COLUMNS)[number];
export type SessionDensity = "compact" | "normal" | "comfortable";
export type Route = {
  view: View; sessionId?: string; flowId?: string; filter: Filter;
  readonly sort?: SessionSort; readonly peek?: string;
  readonly columns?: readonly SessionColumn[]; readonly density?: SessionDensity;
  readonly event?: string; readonly traceTab?: "tree" | "timeline";
  readonly format?: "formatted" | "raw"; readonly attributes?: boolean;
  readonly analysisSort?: string; readonly analysisQuery?: string; readonly facet?: string;
  readonly flowUnit?: "search_requests" | "load_requests"; readonly flowMode?: "chart" | "table";
};
/** Shared invalidations: `seq` advances per update; `last` is present only for a session-row update. */
export type LiveInfo = { state: LiveState; seq: number; last?: SessionListRow };
/** Props every mounted view receives from main.tsx (trace/flow/heatmap stubs are replaced by todos 15-17). */
export type ViewProps = { route: Route; navigate: (next: Route) => void; live: LiveInfo; readonly embedded?: boolean };

export const RUNTIME_LABEL: Record<RuntimeId, string> = {
  "claude-code": "Claude Code", codex: "Codex", gemini: "Gemini CLI", cursor: "Cursor", omo: "OmO", gajae: "Gajae Code", openclaw: "OpenClaw", unknown: "알 수 없음",
};
export const RUNTIME_MARK: Record<RuntimeId, string> = {
  "claude-code": "CC", codex: "CX", gemini: "GM", cursor: "CU", omo: "OM", gajae: "GJ", openclaw: "OC", unknown: "??",
};
export const STATE_LABEL: Record<import("../src/types.js").FlowState, string> = {
  not_attempted: "요청 없음", in_progress: "진행 중", succeeded: "성공", failed: "실패", cancelled: "취소됨", unknown: "알 수 없음",
  loaded: "읽음", exposed_only: "후보만 표시", no_match: "후보 없음", aborted: "중단됨", not_used: "사용 기록 없음",
};
export const STATE_TITLE: Record<AdoptionState, string> = {
  loaded: "loaded: 이 세션에서 스킬을 읽었습니다.",
  exposed_only: "exposed_only: 후보를 표시했지만 읽은 스킬은 없습니다.",
  no_match: "no_match: 검색에서 후보가 나오지 않았습니다.",
  aborted: "aborted: 이전 세션 분류입니다. 읽기 요청의 실패나 취소를 뜻하지 않습니다.",
  not_used: "not_used: 이 세션에는 스킬 검색 기록이 없습니다.",
};
export const ATTRIBUTION_LABEL: Record<Attribution["method"], string> = {
  runtime_id: "실행 환경 ID", vendor_meta: "제공자 메타데이터", trace_handle: "검색 추적 ID", window: "시간 구간", none: "미연결",
};
export const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** How a turn got its events: herdr/runtime said so, an OTel span joined them, or the time window placed them. */
export const BASIS_LABEL: Record<TurnBasis, string> = { reported: "직접 기록", span_join: "연결된 기록", inferred_time: "시간으로 추정" };
export const BASIS_TITLE: Record<TurnBasis, string> = {
  reported: "reported: 실행 환경이 이 이벤트가 속한 대화 차례를 기록했습니다.",
  span_join: "joined: OTel 구간으로 이 이벤트와 대화 차례를 연결했습니다.",
  inferred_time: "inferred: 이벤트가 이 대화 차례의 시간 구간에 들어갑니다.",
};
/** Which skill a call is credited to: the runtime said so, one skill was active, or several were. */
export const SPAN_ATTRIBUTION_LABEL: Record<"reported" | "single" | "co_active" | "no_skill", string> = {
  reported: "직접 기록", single: "단일 스킬", co_active: "동시 사용", no_skill: "스킬 없음",
};
/** Descriptive labels over recorded events: where a used skill came from, never whether it was the right one. */
export const FINDING_LABEL: Record<FindingLabel, string> = {
  found_top1: "첫 검색 결과 사용",
  found_lower: "하위 검색 결과 사용",
  loaded_outside_results: "검색 결과 밖의 스킬 사용",
  native_without_search: "검색 없이 내장 스킬 사용",
  searched_none_used: "검색 결과 사용 기록 없음",
  no_search: "검색 기록 없음",
};
export const FINDING_TITLE: Record<FindingLabel, string> = {
  found_top1: "found_top1: 이 대화 차례에서 사용한 스킬이 첫 검색 결과였습니다.",
  found_lower: "found_lower: 이 대화 차례에서 사용한 스킬이 하위 검색 결과였습니다.",
  loaded_outside_results: "loaded_outside_results: 이 대화 차례에서 사용한 스킬이 검색 결과에 없었습니다.",
  native_without_search: "native_without_search: 실행 환경이 skillar 검색 없이 내장 스킬을 활성화했습니다.",
  searched_none_used: "searched_none_used: 이 대화 차례에서 검색했지만 결과를 사용한 기록은 없습니다.",
  no_search: "no_search: 이 대화 차례에는 검색이나 스킬 사용 기록이 없습니다.",
};
/** Spec comparison per step; deviations are reported, never penalised. */
export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  matched: "일치", partial: "일부 일치", different: "다른 스킬", no_skill_used: "스킬 사용 없음", not_run: "실행 없음",
};
export const STEP_STATUS_TITLE: Record<StepStatus, string> = {
  matched: "matched: 이 단계의 패널에서 계획한 스킬을 사용했습니다.",
  partial: "partial: 함께 사용하도록 계획한 스킬 중 일부를 사용했습니다.",
  different: "different: 스킬을 사용했지만 이 단계에서 계획한 스킬은 없었습니다.",
  no_skill_used: "no_skill_used: 이 단계의 패널에는 스킬 사용 기록이 없습니다.",
  not_run: "not_run: 이 단계에 연결된 패널이 없습니다.",
};

const RUNTIME_SET = new Set<string>(RUNTIME_IDS);
const STATE_SET = new Set<string>(ADOPTION_STATES);

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

/** encodeURIComponent, but keeps ":" and "/" readable so skill URIs stay legible in shared links. */
function encodeItem(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ":").replace(/%2F/gi, "/");
}

function rawPairs(query: string): [string, string][] {
  const q = query.startsWith("?") ? query.slice(1) : query;
  if (!q) return [];
  return q.split("&").filter(Boolean).map((pair) => {
    const i = pair.indexOf("=");
    return i < 0 ? [decode(pair), ""] : [decode(pair.slice(0, i)), pair.slice(i + 1)];
  });
}

function intIn(raw: string, min: number, max: number): number | undefined {
  const text = decode(raw).trim();
  if (!/^-?\d+$/.test(text)) return undefined;
  const n = Number(text);
  return n >= min && n <= max ? n : undefined;
}

function list(raw: string): string[] {
  const seen = new Set<string>();
  for (const item of decode(raw).split(",")) {
    const value = item.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

/** Parses the query part of a hash route (or a full search string) into a Filter; invalid values are dropped. */
export function parseFilter(input: string | URLSearchParams): Filter {
  const query = typeof input === "string" ? input : input.toString();
  const filter: Filter = {};
  for (const [key, raw] of rawPairs(query)) {
    switch (key) {
      case "from": filter.from = intIn(raw, 0, Number.MAX_SAFE_INTEGER); break;
      case "to": filter.to = intIn(raw, 0, Number.MAX_SAFE_INTEGER); break;
      case "runtime": {
        const runtimes = list(raw).filter((r): r is RuntimeId => RUNTIME_SET.has(r));
        if (runtimes.length) filter.runtime = runtimes;
        break;
      }
      case "skill": {
        const skills = list(raw);
        if (skills.length) filter.skill = skills;
        break;
      }
      case "searchStatus":
      case "loadStatus": {
        const statuses = list(raw).filter((value): value is RequestStatus => REQUEST_STATUSES.includes(value as RequestStatus));
        if (statuses.length) filter[key] = statuses;
        break;
      }
      case "searchResult": {
        const results = list(raw).filter((value): value is SearchResult => value === "candidates_found" || value === "no_candidates");
        if (results.length) filter.searchResult = results;
        break;
      }
      case "state": {
        const states = list(raw).filter((s): s is AdoptionState => STATE_SET.has(s));
        if (states.length) filter.state = states;
        break;
      }
      case "dow": filter.dow = intIn(raw, 0, 6); break;
      case "hour": filter.hour = intIn(raw, 0, 23); break;
      case "hourSpan": filter.hourSpan = intIn(raw, 1, 24); break;
      case "q": {
        const q = decode(raw).trim();
        if (q) filter.q = q;
        break;
      }
      case "automated": {
        const value = decode(raw).trim();
        if (value === "include" || value === "only") filter.automated = value;
        break;
      }
      default: break;
    }
  }
  for (const key of FILTER_KEYS) if (filter[key] === undefined) delete filter[key];
  return filter;
}

/** Serializes a Filter to a query string without the leading "?"; keys follow FILTER_KEYS order. Empty filter -> "". */
export function serializeFilter(filter: Filter): string {
  const parts: string[] = [];
  for (const key of FILTER_KEYS) {
    const value = filter[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) parts.push(`${key}=${value.map(encodeItem).join(",")}`);
    } else if (typeof value === "number") {
      if (Number.isFinite(value)) parts.push(`${key}=${value}`);
    } else if (value.trim()) {
      parts.push(`${key}=${encodeItem(value.trim())}`);
    }
  }
  return parts.join("&");
}

export function isEmptyFilter(filter: Filter): boolean {
  return FILTER_KEYS.every((key) => filter[key] === undefined);
}

export function withoutFilterKey(filter: Filter, key: FilterKey): Filter {
  const next: Filter = { ...filter };
  delete next[key];
  // hourSpan only means something next to hour.
  if (key === "hour") delete next.hourSpan;
  return next;
}

export function parseHash(hash: string): Route {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const qi = h.indexOf("?");
  const path = (qi >= 0 ? h.slice(0, qi) : h).replace(/^\/+|\/+$/g, "");
  const query = qi >= 0 ? h.slice(qi + 1) : "";
  const filter = parseFilter(query);
  const params = new URLSearchParams(query);
  const sort = SESSION_SORTS.find(value => value === params.get("sort"));
  const columns = params.has("columns")
    ? SESSION_COLUMNS.filter(value => params.get("columns")?.split(",").includes(value))
    : undefined;
  const density = params.get("density");
  const traceTab = params.get("tab"), format = params.get("format");
  const ui = {
    ...(params.get("asort") ? { analysisSort: params.get("asort") ?? undefined } : {}),
    ...(params.get("aq") ? { analysisQuery: params.get("aq") ?? undefined } : {}),
    ...(params.get("facet") ? { facet: params.get("facet") ?? undefined } : {}),
    ...(params.get("unit") === "search_requests" || params.get("unit") === "load_requests" ? { flowUnit: params.get("unit") === "search_requests" ? "search_requests" : "load_requests" } : {}),
    ...(params.get("mode") === "chart" || params.get("mode") === "table" ? { flowMode: params.get("mode") === "chart" ? "chart" : "table" } : {}),
    ...(sort ? { sort } : {}),
    ...(params.get("peek") ? { peek: params.get("peek") ?? undefined } : {}),
    ...(columns ? { columns } : {}),
    ...(density === "compact" || density === "normal" || density === "comfortable" ? { density } : {}),
    ...(params.get("event") ? { event: params.get("event") ?? undefined } : {}),
    ...(traceTab === "tree" || traceTab === "timeline" ? { traceTab } : {}),
    ...(format === "formatted" || format === "raw" ? { format } : {}),
    ...(params.get("attributes") === "1" ? { attributes: true } : {}),
  } satisfies Partial<Route>;
  const segments = path ? path.split("/").map(decode) : [];
  if (segments.length > 2 || (segments.length > 1 && segments[0] !== "sessions" && segments[0] !== "workspaces")) {
    return { ...ui, view: "not-found", filter };
  }
  switch (segments[0]) {
    case "dashboard": return { ...ui, view: "dashboard", filter };
    case "flow": return { ...ui, view: "flow", filter };
    case "heatmap": return { ...ui, view: "heatmap", filter };
    case "evaluation": return { ...ui, view: "evaluation", filter };
    case "workspaces":
      return segments[1] ? { ...ui, view: "workspace", flowId: segments[1], filter } : { ...ui, view: "workspaces", filter };
    case "sessions":
      return segments[1] ? { ...ui, view: "trace", sessionId: segments[1], filter } : { ...ui, view: "sessions", filter };
    case undefined: return { ...ui, view: "sessions", filter };
    default: return { ...ui, view: "not-found", filter };
  }
}

export function buildHash(route: Route): string {
  const path = route.view === "trace"
    ? `/sessions/${encodeURIComponent(route.sessionId ?? "")}`
    : route.view === "workspace"
      ? `/workspaces/${encodeURIComponent(route.flowId ?? "")}`
      : `/${route.view}`;
  const parts = [serializeFilter(route.filter)];
  if (route.sort) parts.push(`sort=${route.sort}`);
  if (route.columns) parts.push(`columns=${route.columns.join(",")}`);
  if (route.density) parts.push(`density=${route.density}`);
  if ((route.view === "sessions" || route.view === "workspaces") && route.peek) parts.push(`peek=${encodeURIComponent(route.peek)}`);
  if (route.analysisSort) parts.push(`asort=${encodeURIComponent(route.analysisSort)}`);
  if (route.analysisQuery) parts.push(`aq=${encodeURIComponent(route.analysisQuery)}`);
  if (route.facet) parts.push(`facet=${encodeURIComponent(route.facet)}`);
  if (route.flowUnit) parts.push(`unit=${route.flowUnit}`);
  if (route.flowMode) parts.push(`mode=${route.flowMode}`);
  if ((route.view === "sessions" || route.view === "trace") && route.event) parts.push(`event=${encodeURIComponent(route.event)}`);
  if (route.traceTab) parts.push(`tab=${route.traceTab}`);
  if (route.format) parts.push(`format=${route.format}`);
  if (route.attributes) parts.push("attributes=1");
  const query = parts.filter(Boolean).join("&");
  return `#${path}${query ? `?${query}` : ""}`;
}

export function skillName(uri: string): string {
  // skill://local/<rootId>/<dir>/SKILL.md -> <dir> (the last directory segment)
  const segments = uri.replace(/\/SKILL\.md$/i, "").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? uri;
}

/** Client-side Filter predicate for one SessionRow (fixtures mode and live upserts); dow/hour use local time. */
export function matchesFilter(row: SessionRow, filter: Filter): boolean {
  if (row.automated !== undefined && filter.automated === undefined) return false;
  if (filter.automated === "only" && row.automated === undefined) return false;
  if (filter.from !== undefined && row.startedAt < filter.from) return false;
  if (filter.to !== undefined && row.startedAt > filter.to) return false;
  if (filter.runtime && !filter.runtime.includes(row.runtime)) return false;
  if (filter.state && !filter.state.includes(row.state)) return false;
  if (filter.searchStatus?.length && !filter.searchStatus.some((s) => row.requests ? hasStatus(row.requests.search, s) : s === "unknown")) return false;
  if (filter.loadStatus?.length && !filter.loadStatus.some((s) => row.requests ? hasStatus(row.requests.load, s) : s === "unknown")) return false;
  if (filter.searchResult?.length && !filter.searchResult.some((r) => (row.requests?.search.results[r] ?? 0) > 0)) return false;
  if (filter.skill && !filter.skill.some((uri) => row.skills.includes(uri))) return false;
  const started = new Date(row.startedAt);
  if (filter.dow !== undefined && started.getDay() !== filter.dow) return false;
  if (filter.hour !== undefined) {
    const span = filter.hourSpan ?? 1;
    const hour = started.getHours();
    if (hour < filter.hour || hour >= filter.hour + span) return false;
  }
  if (filter.q) {
    const needle = filter.q.toLowerCase();
    const haystack = [row.firstPrompt ?? "", row.id, ...row.skills.map(skillName)].join("\n").toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}
