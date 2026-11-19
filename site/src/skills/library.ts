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

export const skillDay = (skill: PrivateSkillSummary): string => kstDay(skill.updatedAt);
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
  const revisions = [...new Set(skills.map(skill => String(skill.head.revision)))].sort((a, b) => Number(a) - Number(b));
  const days = [...new Set(skills.map(skillDay))].sort().reverse();
  const groups = [
    { id: "revision", label: "리비전 수", values: revisions.map(id => ({ id, label: `현재 r${id}`, count: skills.filter(skill => String(skill.head.revision) === id).length })) },
    { id: "day", label: "최근 변경 기간 · KST", values: days.map(id => ({ id, label: id.slice(5).replace("-", ". "), count: skills.filter(skill => skillDay(skill) === id).length })) },
  ];
  // 오너 피드백(ts 1795084225.603299): "스킬 목록도 스킬 이름만 둬. 리비전 이런건 상세에 있어도 됨".
  // 목록은 이름(아래 작은 글씨 설명 1줄)만, 리비전·최근 변경·digest·읽기 링크는 상세 패널에서 확인한다.
  const columns: readonly TableColumn<PrivateSkillSummary>[] = [
    { id: "name", label: "이름", hideable: false, value: skill => skill.name, render: skill => h("div", { className: "skill-table-name", title: `${skill.name}\n${skill.description}` },
      h("strong", null, skill.name), skill.description !== "" && h("span", { className: "skill-table-description" }, skill.description)) },
  ];
  return h("section", { className: "library", "aria-labelledby": "library-title" },
    h("div", { className: "library-heading" }, h("h2", { id: "library-title", tabIndex: -1 }, "스킬 보관함"),
      h("div", { className: "cluster" },
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
        h(FacetPanel, { title: "스킬 필터", scope: "받은 보관함 기준 · 현재 리비전 번호", groups,
          selected: { revision: view.revisions, day: view.days },
          onChange: (group, values) => update({ ...view, ...(group === "revision" ? { revisions: values } : { days: values }) }) })),
      h("div", { className: "skills-table-main" },
        skills.length > 0 && selectedId === null && h("details", { className: "skills-distribution" },
          h("summary", null, "최근 변경일 분포 · KST"),
          h(BarChart, { title: "최근 변경일 분포 · 스킬 수 · KST", data: updatedHistogram(visibleSkills(skills, view), skills), height: 112 })),
        h("div", { hidden: status === "failed" && skills.length === 0 },
        h(DataTable<PrivateSkillSummary>, { caption: status === "ready" ? `스킬 ${visibleSkills(skills, view).length}개 · 받은 보관함 범위`
          : status === "failed" ? "마지막으로 받은 보관함 범위" : "스킬 보관함 확인 중",
          busy: status === "loading",
          rows: visibleSkills(skills, view), columns, rowId: skill => `skill-row-${skill.skillId}`,
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
        skills.length > 0 && visibleSkills(skills, view).length === 0 && h("button", { className: "button secondary",
          type: "button", onClick: () => update({ ...view, q: "", revisions: [], days: [] }) }, "검색·필터 해제"))),
    props.detail);
}
