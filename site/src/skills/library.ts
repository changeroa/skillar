import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { PrivateSkillId, PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import { BarChart, DataTable, FacetPanel, Pill, Skeleton } from "../ui/index.ts";
import type { TableColumn } from "../ui/table.ts";
import { formatWhen } from "../dashboard/status.ts";
import { SearchBox } from "./search.ts";
import { readSkillsView } from "./view-state.ts";
import type { SkillsView, SkillSort } from "./view-state.ts";

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

export const skillDay = (skill: PrivateSkillSummary): string => new Date(skill.updatedAt).toISOString().slice(0, 10);
export function visibleSkills(skills: readonly PrivateSkillSummary[], view: SkillsView) {
  return sortSkills(skills.filter(skill =>
    `${skill.name} ${skill.description}`.toLocaleLowerCase("ko").includes(view.q.toLocaleLowerCase("ko")) &&
    (view.revisions.length === 0 || view.revisions.includes(String(skill.head.revision))) &&
    (view.days.length === 0 || view.days.includes(skillDay(skill)))), view.sort, view.descending);
}

export function updatedHistogram(skills: readonly PrivateSkillSummary[], catalog: readonly PrivateSkillSummary[] = skills) {
  if (catalog.length === 0) return { labels: [], series: [] };
  const end = Math.max(...catalog.map(skill => Date.parse(skillDay(skill))));
  const start = end - 6 * 86400000;
  const days = Array.from({ length: Math.round((end - start) / 86400000) + 1 },
    (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
  return { labels: days.map(day => day.slice(5).replace("-", "/")),
    series: [{ label: "스킬 수 · 최근 7개 UTC 날짜", values: days.map(day => skills.filter(skill => skillDay(skill) === day).length) }] };
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
  const revisions = [...new Set(skills.map(skill => String(skill.head.revision)))].sort((a, b) => Number(a) - Number(b));
  const days = [...new Set(skills.map(skillDay))].sort().reverse();
  const groups = [
    { id: "revision", label: "리비전 수", values: revisions.map(id => ({ id, label: `현재 r${id}`, count: skills.filter(skill => String(skill.head.revision) === id).length })) },
    { id: "day", label: "최근 변경 기간 · UTC", values: days.map(id => ({ id, label: id.slice(5).replace("-", ". "), count: skills.filter(skill => skillDay(skill) === id).length })) },
  ];
  const columns: readonly TableColumn<PrivateSkillSummary>[] = [
    { id: "name", label: "이름", hideable: false, value: skill => skill.name, render: skill => h("div", { class: "skill-table-name", title: `${skill.name}\n${skill.description}` },
      h("strong", null, skill.name), h("span", { class: "skill-table-description" }, skill.description),
      h("span", { class: "skill-table-mobile" },
        !view.hidden.includes("updated") && h("time", { dateTime: new Date(skill.updatedAt).toISOString(), title: formatWhen(skill.updatedAt) },
          new Date(skill.updatedAt).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })),
        !view.hidden.includes("updated") && !view.hidden.includes("digest") && " · ",
        !view.hidden.includes("digest") && h(Pill, null, h("code", { title: skill.head.digest }, skill.head.digest.slice(0, 8))))) },
    { id: "revision", label: "현재 리비전", value: skill => skill.head.revision, render: skill => h(Pill, null, `r${skill.head.revision}`) },
    { id: "updated", label: "최근 변경", value: skill => skill.updatedAt, render: skill => when(skill.updatedAt) },
    { id: "digest", label: "digest", value: skill => skill.head.digest, render: skill => h(Pill, null, h("code", { title: skill.head.digest }, skill.head.digest.slice(0, 8))) },
  ];
  return h("section", { class: "library", "aria-labelledby": "library-title" },
    h("div", { class: "library-heading" }, h("h2", { id: "library-title", tabIndex: -1 }, "스킬 보관함"),
      h("button", { class: "button secondary", type: "button", disabled: status === "loading", onClick: onReload }, "새로고침")),
    notice !== "" && h("p", { class: "note", role: "status" }, notice),
    h("p", { class: "note library-status", role: "status", "aria-live": "polite" }, status === "loading" ? "스킬 불러오는 중…" : message),
    status === "loading" && skills.length === 0 && h(Skeleton, { label: "스킬 불러오는 중", rows: 3 }),
    status === "failed" && h("button", { class: "button secondary", type: "button", onClick: onReload }, "다시 시도"),
    status === "ready" && skills.length === 0 && h("p", { class: "library-empty" },
      "아직 게시한 비공개 스킬이 없습니다. 아래의 ‘새 스킬 게시’에서 SKILL.md가 있는 폴더를 선택하고 업로드에 동의하세요."),
    h("div", { class: "skills-table-layout", "data-peeking": selectedId !== null },
      h("details", { class: "skills-facets", open: facetsOpen }, h("summary", null, "필터"),
        h(FacetPanel, { title: "스킬 필터", scope: "받은 보관함 기준 · 현재 리비전 번호", groups,
          selected: { revision: view.revisions, day: view.days },
          onChange: (group, values) => update({ ...view, ...(group === "revision" ? { revisions: values } : { days: values }) }) })),
      h("div", { class: "skills-table-main" },
        skills.length > 0 && selectedId === null && h(BarChart, { title: "최근 변경일 분포 · 스킬 수 · UTC", data: updatedHistogram(visibleSkills(skills, view), skills), height: 112 }),
        h(DataTable<PrivateSkillSummary>, { caption: `스킬 ${visibleSkills(skills, view).length}개 · 받은 보관함 범위`,
          rows: visibleSkills(skills, view), columns, rowId: skill => `skill-row-${skill.skillId}`,
          sort: { column: view.sort, direction: view.descending ? "descending" : "ascending" },
          onSort: next => {
            const sort = next.column;
            if (sort === "name" || sort === "revision" || sort === "updated" || sort === "digest")
              update({ ...view, sort, descending: next.direction === "descending" });
          },
          hidden: view.hidden, onHiddenChange: hidden => update({ ...view, hidden }), density: view.density,
          onDensityChange: density => {
            if (density === "compact" || density === "normal" || density === "spacious") update({ ...view, density });
          },
          selectedId: selectedId === null ? null : `skill-row-${selectedId}`,
          onRowOpen: (skill, target) => onOpen(skill.skillId, target),
          toolbar: h(SearchBox, { skills, signal: props.signal, onOpen, onUnauthorized: props.onUnauthorized,
            compact: true, query: view.q, onQueryChange: q => update({ ...view, q }) }) }),
        skills.length > 0 && visibleSkills(skills, view).length === 0 && h("button", { class: "button secondary",
          type: "button", onClick: () => update({ ...view, q: "", revisions: [], days: [] }) }, "검색·필터 해제"))),
    props.detail);
}
