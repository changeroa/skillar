import { REQUEST_STATUSES, type RequestStatus } from "../../src/request-status.js";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { AdoptionState, FlowState, Filter, FlowDto, SkillEntry } from "../../src/types.js";
import { api } from "../api";
import { STATE_VALUES, Sankey, genericLabel, installStyles, nodeValue, percent, share, type FlowLink, type FlowNode, type FlowTarget } from "../charts/sankey";
import { ADOPTION_STATES, STATE_LABEL, buildHash, isEmptyFilter, serializeFilter, skillName, type Route, type ViewProps } from "../state";

// Flow view: Sankey (>= TABLE_THRESHOLD sessions) or the "Top paths" table, each switchable.
// Clicks map to the shared Filter: skill node -> `skill`, outcome node -> `state`, band -> both.
// Task types have no Filter field, so their nodes only highlight; `q` is never used for them.

export const TABLE_THRESHOLD = 30;
export const DEFAULT_TOP = 7;
export const EXPANDED_TOP = 15;
export type FlowMode = "chart" | "table";
export type FlowUnit = FlowDto["unit"];
export type SkillResolver = (value: string) => string | undefined;
export type TopPath = { index: number; task: string; skill: string; skillNode: FlowNode; state: FlowState; count: number; share: number };

const UNIT_LABEL: Record<FlowUnit, string> = { first_load: "첫 읽기", all_loads: "모든 읽기", search_requests: "검색 요청", load_requests: "읽기 요청" };
const LIVE_REFRESH_DEBOUNCE_MS = 300;

export function defaultMode(sessionCount: number): FlowMode {
  return sessionCount < TABLE_THRESHOLD ? "table" : "chart";
}

export function legendText(unit: FlowUnit): string {
  if (unit === "search_requests" || unit === "load_requests") return `띠 굵기 = ${unit === "search_requests" ? "검색" : "읽기"} 요청 수. 재시도는 각각 따로 셉니다.`;
  return unit === "first_load" ? "띠 굵기 = 세션 수 (단위: 처음 읽은 스킬)" : "띠 굵기 = 스킬 읽기 수 (단위: 읽은 모든 스킬)";
}

/** Skill node values are URIs from the store; fixtures and older rows may carry a skill name, resolved through the catalog. */
export function skillResolver(skills: SkillEntry[]): SkillResolver {
  const byName = new Map<string, string>();
  for (const entry of skills) {
    byName.set(entry.name, entry.uri);
    byName.set(entry.dir, entry.uri);
    byName.set(skillName(entry.uri), entry.uri);
  }
  return (value) => (value.startsWith("skill://") ? value : byName.get(value));
}

function skillUri(node: FlowNode | undefined, resolve: SkillResolver): string | undefined {
  if (!node || node.column !== 1 || node.other) return undefined;
  return resolve(nodeValue(node));
}

/** The Filter patch a click means, or undefined when the element maps to nothing filterable. */
export function targetFilter(target: FlowTarget, nodes: FlowNode[], resolve: SkillResolver, unit?: FlowUnit): Pick<Filter, "skill" | "state" | "searchStatus" | "loadStatus"> | undefined {
  const statusFilter = (state: FlowState): Pick<Filter, "state" | "searchStatus" | "loadStatus"> => REQUEST_STATUSES.includes(state as RequestStatus)
    ? { [unit === "search_requests" ? "searchStatus" : "loadStatus"]: [state] } : { state: [state as AdoptionState] };
  if (target.kind === "node") {
    const { node } = target;
    if (node.other || node.column === 0) return undefined;
    if (node.column === 1) {
      const uri = skillUri(node, resolve);
      return uri ? { skill: [uri] } : undefined;
    }
    const value = nodeValue(node);
    return STATE_VALUES.has(value) ? statusFilter(value as FlowState) : undefined;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const uri = skillUri(byId.get(target.link.source), resolve) ?? skillUri(byId.get(target.link.target), resolve);
  return { ...(uri ? { skill: [uri] } : {}), ...statusFilter(target.link.state) };
}

export function sessionsRoute(route: Route, patch: Pick<Filter, "skill" | "state" | "searchStatus" | "loadStatus">): Route {
  return { view: "sessions", filter: { ...route.filter, ...patch } };
}

/** One row per task -> skill -> outcome path: the task->skill links already count unique sessions per (task, skill, state). */
export function topPaths(dto: FlowDto): TopPath[] {
  const byId = new Map(dto.nodes.map((n) => [n.id, n]));
  const rows: TopPath[] = [];
  dto.links.forEach((link: FlowLink, index) => {
    const task = byId.get(link.source);
    const skill = byId.get(link.target);
    if (!task || !skill || task.column !== 0 || skill.column !== 1) return;
    rows.push({ index, task: task.label, skill: skill.label, skillNode: skill, state: link.state, count: link.count, share: share(link.count, dto.requestCount ?? dto.sessionCount) });
  });
  return rows.sort((a, b) => b.count - a.count || a.task.localeCompare(b.task) || a.skill.localeCompare(b.skill) || a.state.localeCompare(b.state));
}

const FLOW_CSS = `
.flow__legend { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-4); margin: 0 0 var(--s-3); color: var(--ink-2); font-size: var(--fs-cap); }
.flow__key { display: inline-flex; flex-wrap: wrap; gap: var(--s-2) var(--s-3); }
.flow__swatch { display: inline-flex; align-items: center; gap: var(--s-2); white-space: nowrap; }
.flow__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--neutral); flex: none; }
.flow__dot.is-succeeded, .flow__dot.is-loaded { background: var(--ok); }
.flow__dot.is-in_progress, .flow__dot.is-exposed_only { background: var(--warn); }
.flow__dot.is-failed, .flow__dot.is-no_match { background: var(--bad); }
.flow__chart { padding: var(--s-4); }
.flow__paths { overflow-x: auto; }
.seg { display: inline-flex; border: 1px solid var(--line-2); border-radius: var(--r-sm); overflow: hidden; }
.seg__btn { height: 30px; padding: 0 var(--s-3); border: 0; background: transparent; color: var(--ink-2); font-size: var(--fs-sm); font-weight: 500; cursor: pointer; transition: background-color var(--t-micro), color var(--t-micro); }
.seg__btn + .seg__btn { border-left: 1px solid var(--line-2); }
.seg__btn:hover { background: var(--wash); color: var(--ink); }
.seg__btn[aria-pressed="true"] { background: var(--wash-2); color: var(--ink); }
.seg__btn:focus-visible { outline-offset: -2px; }
.paths { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.paths th { text-align: left; padding: var(--s-2) var(--s-3); color: var(--ink-3); font-size: var(--fs-cap); font-weight: 500; border-bottom: 1px solid var(--line); white-space: nowrap; }
.paths td { padding: var(--s-3); border-bottom: 1px solid var(--line); vertical-align: middle; }
.paths tbody tr { cursor: pointer; transition: background-color var(--t-micro); }
.paths tbody tr:hover, .paths tbody tr:has(a:focus-visible) { background: var(--wash); }
.paths tbody tr:last-child td { border-bottom: 0; }
.paths__hint { margin-inline-start: var(--s-2); font-weight: 400; }
.paths__path { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-2); }
.paths__task { color: var(--ink-2); }
.paths__arrow { color: var(--ink-3); }
.paths__skill { color: var(--ink); font-weight: 500; text-decoration: none; }
.paths__skill:hover { color: var(--ink); text-decoration: underline; }
.paths__skill--dim { color: var(--ink-3); font-weight: 400; }
.paths .num { width: 1%; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.paths__share { display: inline-block; min-width: 4.5rem; padding: 2px var(--s-2); border-radius: var(--r-sm); background: linear-gradient(to right, var(--wash-2) var(--share, 0%), transparent 0); }
@media (max-width: 639.98px) {
  .paths__hint { display: none; }
  .paths th:first-child { white-space: normal; }
  .paths__share { display: block; min-width: 0; }
}
`;

installStyles("flow", FLOW_CSS);

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (next: T) => void }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" class="seg__btn" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Legend({ unit, withKey }: { unit: FlowUnit; withKey: boolean }) {
  return (
    <p class="flow__legend">
      <span>{unit.endsWith("_requests") ? `${legendText(unit)} 비율 = 경로의 요청 수 / 기간 내 요청 수.` : withKey ? legendText(unit) : `비율 = 경로의 세션 수 / 기간 내 세션 수 (단위: ${unit === "first_load" ? "처음 읽은 스킬" : "읽은 모든 스킬"})`}</span>
      {withKey && (
        <span class="flow__key" aria-label="띠 색상">
          {(unit.endsWith("_requests") ? REQUEST_STATUSES.filter((s) => s !== "not_attempted") : ADOPTION_STATES).map((state) => (
            <span class="flow__swatch" key={state}>
              <i class={`flow__dot is-${state}`} aria-hidden="true" />
              {STATE_LABEL[state]}
            </span>
          ))}
        </span>
      )}
    </p>
  );
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("a, button") !== null;
}

export function TopPathsTable({ dto, route, navigate, resolve }: { dto: FlowDto; route: Route; navigate: ViewProps["navigate"]; resolve: SkillResolver }) {
  const rows = topPaths(dto);
  return (
    <div class="card flow__paths">
      <table class="paths">
        <thead>
          <tr>
            <th scope="col">경로<span class="paths__hint">작업 유형 {"\u2192"} 스킬 {"\u2192"} 결과</span></th>
            <th scope="col" class="num">{dto.requestCount !== undefined ? "요청" : "세션"}</th>
            <th scope="col" class="num">비율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const link = dto.links[row.index]!;
            const taskNode = dto.nodes.find(node => node.id === link.source)!;
            const target = sessionsRoute(route, targetFilter({ kind: "link", link, index: row.index }, dto.nodes, resolve, dto.unit) ?? {});
            const href = buildHash(target);
            const filterable = skillUri(row.skillNode, resolve) !== undefined;
            return (
              <tr key={row.index} onClick={(event) => { if (!isInteractive(event.target)) navigate(target); }}>
                <td>
                  <span class="paths__path">
                    <span class="paths__task">{genericLabel(taskNode)}</span>
                    <span class="paths__arrow" aria-hidden="true">{"\u2192"}</span>
                    <a class={filterable ? "paths__skill" : "paths__skill paths__skill--dim"} href={href} title={filterable ? nodeValue(row.skillNode) : undefined}>{genericLabel(row.skillNode)}</a>
                    <span class="paths__arrow" aria-hidden="true">{"\u2192"}</span>
                    <span class={`badge badge--${row.state}`}>{STATE_LABEL[row.state] ?? row.state}</span>
                  </span>
                </td>
                <td class="num">{row.count}</td>
                <td class="num"><span class="paths__share" style={{ "--share": percent(row.count, dto.requestCount ?? dto.sessionCount) }}>{percent(row.count, dto.requestCount ?? dto.sessionCount)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyFlow({ route, navigate }: { route: Route; navigate: ViewProps["navigate"] }) {
  const filtered = !isEmptyFilter(route.filter);
  return (
    <section class="empty">
      <h2>이 기간에는 세션이 없습니다</h2>
      <p>{filtered ? "이 필터에 맞는 세션이 없어 그릴 사용 흐름이 없습니다." : "연결된 실행 환경에서 세션을 시작하면 작업에서 스킬로 이어지는 사용 흐름이 여기에 나타납니다."}</p>
      {filtered && <button type="button" class="btn" onClick={() => navigate({ ...route, filter: {} })}>필터 지우기</button>}
    </section>
  );
}

export function FlowView({ route, navigate, live }: ViewProps) {
  const filterKey = serializeFilter(route.filter);
  const [unit, setUnit] = useState<FlowUnit>("load_requests");
  const [top, setTop] = useState(DEFAULT_TOP);
  const [mode, setMode] = useState<FlowMode | "auto">("auto");
  const [dto, setDto] = useState<FlowDto>();
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [orphanLoads, setOrphanLoads] = useState(0);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (live.seq === 0) return;
    const timer = setTimeout(() => setRefresh((n) => n + 1), LIVE_REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [live.seq]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.flow(route.filter, { unit, top }), api.skills(), api.stats(route.filter)]).then(([flowResult, skillsResult, statsResult]) => {
      if (cancelled) return;
      const failed = [flowResult, skillsResult, statsResult].find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
      if (failed !== undefined) {
        setError(failed instanceof Error ? failed.message : String(failed));
        return;
      }
      setDto((flowResult as PromiseFulfilledResult<FlowDto>).value);
      setSkills((skillsResult as PromiseFulfilledResult<SkillEntry[]>).value);
      setOrphanLoads((statsResult as PromiseFulfilledResult<Awaited<ReturnType<typeof api.stats>>>).value.unattributed?.loads ?? 0);
      setError(undefined);
    });
    return () => { cancelled = true; };
  }, [filterKey, unit, top, refresh]);

  const resolve = useMemo(() => skillResolver(skills), [skills]);
  const shown: FlowMode = mode === "auto" ? defaultMode(dto?.requestCount ?? dto?.sessionCount ?? 0) : mode;
  const hrefFor = (target: FlowTarget): string | undefined => {
    const patch = dto && targetFilter(target, dto.nodes, resolve, dto.unit);
    return patch ? buildHash(sessionsRoute(route, patch)) : undefined;
  };
  const onActivate = (target: FlowTarget) => {
    const patch = dto && targetFilter(target, dto.nodes, resolve, dto.unit);
    if (patch) navigate(sessionsRoute(route, patch));
  };

  let body;
  if (dto === undefined) {
    body = null;
  } else {
    body = (
      <>
        <div class="toolbar">
          <Segmented label="보기" value={shown} options={[{ value: "chart", label: "차트" }, { value: "table", label: "주요 경로" }]} onChange={setMode} />
          <Segmented label="단위" value={unit} options={(["search_requests", "load_requests"] as const).map((value) => ({ value, label: UNIT_LABEL[value] }))} onChange={setUnit} />
          {top !== DEFAULT_TOP && (
            <button type="button" class="btn" onClick={() => setTop(DEFAULT_TOP)}>열별 상위 {DEFAULT_TOP}개</button>
          )}
          <span class="toolbar__count">
            {dto.requestCount !== undefined ? `요청 ${dto.requestCount}건` : `세션 ${dto.sessionCount}개`}
            {orphanLoads > 0 && <span title="어느 세션에도 연결되지 않은 MCP 읽기입니다. 저장은 되지만 사용 흐름에는 그리지 않습니다.">{` \u00b7 세션에 연결되지 않은 읽기 ${orphanLoads}건은 표시하지 않음`}</span>}
          </span>
        </div>
        <Legend unit={unit} withKey={shown === "chart"} />
        {(dto.requestCount ?? dto.sessionCount) === 0 ? <p class="empty">이 필터에 기록된 {unit === "search_requests" ? "검색" : "읽기"} 요청이 없습니다.</p> : shown === "chart"
          ? (
            <div class="card flow__chart">
              <Sankey dto={dto} hrefFor={hrefFor} onActivate={onActivate} onExpandOther={top < EXPANDED_TOP ? () => setTop(EXPANDED_TOP) : undefined} />
            </div>
          )
          : <TopPathsTable dto={dto} route={route} navigate={navigate} resolve={resolve} />}
      </>
    );
  }

  return (
    <section aria-busy={dto === undefined && !error} data-mode={dto ? shown : undefined} data-top={top} data-unit={unit}>
      {error && <p class="notice" role="alert">사용 흐름을 불러올 수 없습니다: {error}</p>}
      {body}
    </section>
  );
}
