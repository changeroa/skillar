import { h } from "preact";
import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import type { PrivateSkillId, PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import { formatWhen } from "../dashboard/status.ts";
import { SearchBox } from "./search.ts";
import type { SkillSort } from "./view-state.ts";

export type LibraryProps = {
  readonly skills: readonly PrivateSkillSummary[];
  readonly status: "loading" | "ready" | "failed";
  readonly message: string;
  readonly notice: string;
  readonly selectedId: PrivateSkillId | null;
  readonly signal: AbortSignal;
  readonly onReload: () => void;
  readonly onOpen: (skillId: PrivateSkillId) => void;
  readonly onUnauthorized: () => void;
  readonly q?: string;
  readonly sort?: SkillSort;
  readonly descending?: boolean;
  readonly onViewChange?: (q: string, sort: SkillSort, descending: boolean) => void;
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

export function LibraryPanel(props: LibraryProps) {
  const { skills, status, message, notice, selectedId, onReload, onOpen } = props;
  const [localSort, setLocalSort] = useState<SkillSort>("updated");
  const [localDescending, setLocalDescending] = useState(true);
  const [localQuery, setLocalQuery] = useState("");
  const sort = props.sort ?? localSort;
  const descending = props.descending ?? localDescending;
  const q = props.q ?? localQuery;
  const update = (query: string, next: SkillSort, desc: boolean) => {
    setLocalQuery(query); setLocalSort(next); setLocalDescending(desc);
    props.onViewChange?.(query, next, desc);
  };
  const ordered = sortSkills(skills.filter(skill =>
    `${skill.name} ${skill.description}`.toLocaleLowerCase("ko").includes(q.toLocaleLowerCase("ko"))), sort, descending);
  const column = (key: SkillSort, label: string) => h("th", { scope: "col",
    "aria-sort": sort === key ? descending ? "descending" : "ascending" : "none" },
  h("button", { type: "button", onClick: () => update(q, key, sort === key ? !descending : key === "updated") },
    label, sort === key && h("span", { "aria-hidden": "true" }, descending ? " ↓" : " ↑")));
  return h("section", { class: "panel library", "aria-labelledby": "library-title" },
    h("div", { class: "panel__head" },
      h("h2", { id: "library-title", tabIndex: -1 }, "스킬 보관함"),
      h("button", { class: "button secondary", type: "button", disabled: status === "loading", onClick: onReload }, "새로고침")),
    h(SearchBox, { skills, signal: props.signal, onOpen, onUnauthorized: props.onUnauthorized,
      query: q, onQueryChange: (query: string) => update(query, sort, descending) },
      h("label", { class: "field-label library-sort", for: "skill-sort" }, "정렬",
        h("select", { id: "skill-sort", class: "text-field", value: sort,
          onChange: (event: JSX.TargetedEvent<HTMLSelectElement, Event>) => {
            const value = event.currentTarget.value;
            if (value === "name" || value === "updated" || value === "revision" || value === "digest")
              update(q, value, value === "updated");
          } }, h("option", { value: "updated" }, "최근 변경"), h("option", { value: "name" }, "이름"),
        h("option", { value: "revision" }, "리비전"), h("option", { value: "digest" }, "digest")))),
    notice !== "" && h("p", { class: "note", role: "status", "aria-live": "polite" }, notice),
    h("p", { class: "note", role: "status", "aria-live": "polite" }, status === "loading" ? "스킬 불러오는 중…" : message),
    status === "failed" && h("button", { class: "button secondary", type: "button", onClick: onReload }, "다시 시도"),
    status === "ready" && skills.length === 0 && h("p", { class: "library-empty" },
      "아직 게시한 비공개 스킬이 없습니다. 아래의 ‘새 스킬 게시’에서 SKILL.md가 있는 폴더를 선택하고 업로드에 동의하세요."),
    status === "ready" && skills.length > 0 && ordered.length === 0 &&
      h("p", { class: "note", role: "status" }, "일치하는 이름이나 설명이 없습니다. 문서까지 찾으려면 검색을 누르세요."),
    h("table", { class: "skill-table", "aria-label": "스킬 보관함" },
      h("thead", null, h("tr", null, column("name", "이름"), column("revision", "현재 리비전"),
        column("updated", "최근 변경"), column("digest", "digest"), h("th", { scope: "col" }, "읽기 기록"))),
      h("tbody", null, ordered.map(skill => h("tr", { key: skill.skillId, id: `skill-row-${skill.skillId}`,
        tabIndex: 0, "aria-selected": skill.skillId === selectedId, "aria-label": `${skill.name} 열기`,
        onClick: () => onOpen(skill.skillId),
        onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLTableRowElement>) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(skill.skillId); }
        } },
      h("td", { class: "skill-table__name", title: skill.name }, skill.name),
      h("td", { class: "skill-table__revision" }, h("span", { class: "skill-table__mobile-label" }, "리비전 "), skill.head.revision),
      h("td", { class: "skill-table__updated" }, when(skill.updatedAt)),
      h("td", { class: "skill-table__digest" }, h("code", { title: skill.head.digest }, skill.head.digest.slice(0, 8))),
      h("td", { class: "skill-table__reads" }, "연결 안 됨"))))),
    props.detail);
}
