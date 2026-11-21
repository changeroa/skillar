import {createElement as h} from "react";
import type {ReactNode as ComponentChildren} from "react";
import { useEffect, useState } from "react";
import type { PrivateSkillId, PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import { BarChart, DataTable, FacetPanel } from "../ui/index.ts";
import type { TableColumn } from "../ui/table.ts";
import { formatWhen } from "../dashboard/status.ts";
import { SearchBox } from "./search.ts";
import { readSkillsView } from "./view-state.ts";
import type { SkillsView, SkillSort } from "./view-state.ts";
import { kstDay } from "../time.ts";
import { Button } from "../../../local/dashboard/foundation/controls/buttons";
import {
  CHANGED_BUCKET_IDS, CHANGED_BUCKET_LABEL, changedBucket, READ_STATE_IDS, READ_STATE_LABEL, readStateOf,
} from "./activity-filters-core.ts";
import type { SkillActivity } from "./activity-filters-core.ts";
import type { LibraryActivity } from "./activity-filters.ts";

export type LibraryProps = {
  readonly skills: readonly PrivateSkillSummary[];
  readonly status: "loading" | "ready" | "failed";
  readonly message: string;
  readonly notice: string;
  readonly selectedId: PrivateSkillId | null;
  readonly signal: AbortSignal;
  readonly onReload: () => void;
  readonly onOpen: (skillId: PrivateSkillId, target?: HTMLElement) => void;
  readonly onUnauthorized: () => void;
  readonly view?: SkillsView;
  readonly onViewChange?: (view: SkillsView) => void;
  readonly detail?: ComponentChildren;
  /** 스킬별 읽힘/에이전트 활동. 없으면 활동 필터는 비활성 한 줄 안내로 둔다. */
  readonly activity?: LibraryActivity;
};

export function when(ms: number) {
  return h("time", { dateTime: new Date(ms).toISOString() }, formatWhen(ms));
}

export function sortSkills(skills: readonly PrivateSkillSummary[], sort: SkillSort, descending = sort === "updated") {
  return [...skills].sort((a, b) => {
    const order = sort === "updated" ? a.updatedAt - b.updatedAt : sort === "revision" ? a.head.revision - b.head.revision
      : sort === "digest" ? a.head.digest.localeCompare(b.head.digest) : a.name.localeCompare(b.name, "ko");
    return (descending ? -order : order) || a.name.localeCompare(b.name, "ko");
  });
}

export const skillDay = (skill: PrivateSkillSummary): string => kstDay(skill.updatedAt);
export function visibleSkills(
  skills: readonly PrivateSkillSummary[], view: SkillsView,
  activity?: ReadonlyMap<string, SkillActivity>, now = Date.now(),
) {
  return sortSkills(skills.filter(skill =>
    `${skill.name} ${skill.description}`.toLocaleLowerCase("ko").includes(view.q.toLocaleLowerCase("ko")) &&
    (view.readStates.length === 0 || view.readStates.includes(readStateOf(activity?.get(skill.skillId)))) &&
    (view.agents.length === 0 ||
      [...(activity?.get(skill.skillId)?.agents.keys() ?? [])].some(agent => view.agents.includes(agent))) &&
    (view.days.length === 0 || view.days.includes(changedBucket(skill.updatedAt, now)))), view.sort, view.descending);
}

export function updatedHistogram(skills: readonly PrivateSkillSummary[], catalog: readonly PrivateSkillSummary[] = skills) {
  if (catalog.length === 0) return { labels: [], series: [] };
  const end = Math.max(...catalog.map(skill => Date.parse(skillDay(skill))));
  const start = end - 6 * 86400000;
  const days = Array.from({ length: Math.round((end - start) / 86400000) + 1 },
    (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
  return { labels: days.map(day => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}\nKST`),
    series: [{ label: "스킬 수 · 최근 7개 KST 날짜", values: days.map(day => skills.filter(skill => skillDay(skill) === day).length) }] };
}

export function LibraryPanel(props: LibraryProps) {
  const { skills, status, message, notice, selectedId, onReload, onOpen } = props;
  const [localView, setView] = useState(() => readSkillsView("https://skillar.sh/skills/"));
  const [facetsOpen, setFacetsOpen] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => setFacetsOpen(!media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const view = props.view ?? localView;
  const update = (next: SkillsView) => { setView(next); props.onViewChange?.(next); };
  const activity = props.activity;
  const activityMap = activity?.kind === "ready" ? activity.bySkill : undefined;
  const now = Date.now();
  const agentCounts = new Map<string, number>();
  if (activityMap !== undefined) {
    for (const skill of skills) {
      for (const agent of activityMap.get(skill.skillId)?.agents.keys() ?? []) {
        agentCounts.set(agent, (agentCounts.get(agent) ?? 0) + 1);
      }
    }
  }
  // 비활성 안내는 상태/사유별로 다르다: 불러오는 중 ≠ 0건(기록이 쌓이면) ≠ 응답 형식 불일치 ≠ 조회 불가.
  const activityNote = activity?.kind === "loading"
    ? "읽기 기록을 불러오는 중이에요."
    : activity?.kind === "unavailable" && activity.reason === "incompatible"
    ? "활동 기록 응답 형식이 맞지 않아 지금은 사용할 수 없어요."
    : activity?.kind === "unavailable" && activity.reason === "unavailable"
      ? "지금은 읽기 기록을 확인할 수 없어요."
      : "읽기 기록이 쌓이면 사용할 수 있어요.";
  const groups = [
    ...(activityMap === undefined ? [{
      id: "read", label: `읽힘 상태 · 최근 ${view.period}일 · KST`, values: [],
      disabledNote: activityNote,
    }, {
      id: "agent", label: `읽은 에이전트 · 최근 ${view.period}일 · KST`, values: [],
      disabledNote: activityNote,
    }] : [{
      id: "read", label: `읽힘 상태 · 최근 ${view.period}일 · KST`,
      values: READ_STATE_IDS.map(id => ({
        id, label: READ_STATE_LABEL[id],
        count: skills.filter(skill => readStateOf(activityMap.get(skill.skillId)) === id).length,
      })),
    }, {
      id: "agent", label: `읽은 에이전트 · 최근 ${view.period}일 · KST`,
      values: [...agentCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
        .map(([id, count]) => ({ id, label: id, count })),
    }]),
    { id: "day", label: "최근 변경 기간 · KST", values: CHANGED_BUCKET_IDS.map(id => ({
      id, label: CHANGED_BUCKET_LABEL[id],
      count: skills.filter(skill => changedBucket(skill.updatedAt, now) === id).length })) },
  ];
  // 승인 제안서 3.3: 목록은 이름(+설명 한 줄)을 유지하고 "읽힘 · 노출", "읽은 에이전트", "최근 변경" 열을 더한다.
  // (이전 오너 피드백 ts 1795084225.603299 "이름만"은 승인된 제안 ts 1795260652.308149가 대체한다.)
  // 읽힘·노출·에이전트는 평문 일별 집계의 조회 창(period) 값이고, 집계 전이거나 읽을 수 없으면 0이 아니라 "—"다.
  const usage = (skill: PrivateSkillSummary) => activityMap?.get(skill.skillId);
  const columns: readonly TableColumn<PrivateSkillSummary>[] = [
    { id: "name", label: "이름", hideable: false, value: skill => skill.name, render: skill => h("div", { className: "skill-table-name", title: `${skill.name}\n${skill.description}` },
      h("strong", null, skill.name), skill.description !== "" && h("span", { className: "skill-table-description" }, skill.description)) },
    { id: "usage", label: `읽힘 · 노출 (${view.period}일)`, value: skill => usage(skill)?.reads ?? -1,
      render: skill => activityMap === undefined ? h("span", { className: "pe-muted", title: activityNote }, "—") :
        h("span", { className: "skill-table-usage" }, `${usage(skill)?.reads ?? 0}회 · 노출 ${usage(skill)?.exposures ?? 0}`) },
    { id: "agents", label: "읽은 에이전트", value: skill => [...(usage(skill)?.agents.keys() ?? [])].join(","),
      render: skill => activityMap === undefined ? h("span", { className: "pe-muted", title: activityNote }, "—") :
        (usage(skill)?.agents.size ?? 0) === 0 ? h("span", { className: "pe-muted" }, "—") :
          h("span", { className: "skill-table-agents" }, [...usage(skill)!.agents.keys()].map(agent => h("span", { key: agent, className: "badge" }, agent))) },
    { id: "updated", label: "최근 변경", value: skill => skill.updatedAt, render: skill => when(skill.updatedAt) },
  ];
  return h("section", { className: "library", "aria-labelledby": "library-title" },
    h("div", { className: "library-heading" }, h("h2", { id: "library-title", tabIndex: -1 }, "스킬 보관함"),
      h("div", { className: "cluster" },
        h("div", { className: "cluster", role: "group", "aria-label": "읽힘 조회 기간" }, ([7, 30, 90] as const).map(days =>
          h(Button, { key: days, text: `최근 ${days}일`, variant: view.period === days ? "primary" : "outline",
            "aria-pressed": view.period === days, onClick: () => update({ ...view, period: days }) } as never))),
        h(Button, { text: "새로고침", variant: "outline", disabled: status === "loading", onClick: onReload }),
        h(Button, { text: "새 스킬", onClick: () => {
          const title = document.getElementById("publish-title");
          if (title) { title.tabIndex = -1; title.scrollIntoView({ block: "start" }); title.focus({ preventScroll: true }); }
        } }))),
    notice !== "" && h("p", { className: "note", role: "status" }, notice),
    h("p", { className: "note library-status", role: "status", "aria-live": "polite" }, status === "loading" ? "스킬 불러오는 중…" : message),
    status === "failed" && h("button", { className: "button secondary", type: "button", onClick: onReload }, "다시 시도"),
    status === "ready" && skills.length === 0 && h("p", { className: "library-empty" },
      "아직 게시한 비공개 스킬이 없습니다. 아래의 ‘새 스킬 게시’에서 SKILL.md가 있는 폴더를 선택하고 업로드에 동의하세요."),
    h("div", { className: "skills-table-layout", "data-peeking": selectedId !== null },
      h("details", { className: "skills-facets", open: facetsOpen }, h("summary", null, "필터"),
        h(FacetPanel, { title: "스킬 필터", groups,
          selected: { read: view.readStates, agent: view.agents, day: view.days },
          onChange: (group, values) => update({ ...view,
            ...(group === "read" ? { readStates: values } : group === "agent" ? { agents: values } : { days: values }) }) })),
      h("div", { className: "skills-table-main" },
        skills.length > 0 && selectedId === null && h("details", { className: "skills-distribution" },
          h("summary", null, "최근 변경일 분포 · KST"),
          h(BarChart, { title: "최근 변경일 분포 · 스킬 수 · KST", data: updatedHistogram(visibleSkills(skills, view, activityMap), skills), height: 112 })),
        h("div", { hidden: status === "failed" && skills.length === 0 },
        h(DataTable<PrivateSkillSummary>, { caption: status === "ready" ? `스킬 ${visibleSkills(skills, view, activityMap).length}개 · 받은 보관함 범위`
          : status === "failed" ? "마지막으로 받은 보관함 범위" : "스킬 보관함 확인 중",
          busy: status === "loading",
          rows: visibleSkills(skills, view, activityMap), columns, rowId: skill => `skill-row-${skill.skillId}`,
          sort: { column: view.sort, direction: view.descending ? "descending" : "ascending" },
          onSort: next => {
            if (next.column === "name") update({ ...view, sort: "name", descending: next.direction === "descending" });
          },
          hidden: view.hidden, onHiddenChange: hidden => update({ ...view, hidden }), density: view.density,
          onDensityChange: density => {
            if (density === "compact" || density === "normal" || density === "spacious") update({ ...view, density });
          },
          selectedId: selectedId === null ? null : `skill-row-${selectedId}`,
          onRowOpen: (skill, target) => onOpen(skill.skillId, target),
          toolbar: h(SearchBox, { skills, signal: props.signal, onOpen, onUnauthorized: props.onUnauthorized,
            compact: true, query: view.q, onQueryChange: q => update({ ...view, q }) }) })),
        skills.length > 0 && visibleSkills(skills, view, activityMap).length === 0 && h("button", { className: "button secondary",
          type: "button", onClick: () => update({ ...view, q: "", readStates: [], agents: [], days: [] }) }, "검색·필터 해제"))),
    props.detail);
}
