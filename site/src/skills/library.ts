import { h } from "preact";
import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import type { PrivateSkillId, PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import { formatWhen } from "../dashboard/status.ts";
import { SearchBox } from "./search.ts";

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
  readonly detail?: ComponentChildren;
};

export function when(ms: number) {
  return h("time", { dateTime: new Date(ms).toISOString() }, formatWhen(ms));
}

export function sortSkills(skills: readonly PrivateSkillSummary[], sort: "updated" | "name") {
  return [...skills].sort((a, b) => sort === "updated"
    ? b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, "ko") : a.name.localeCompare(b.name, "ko"));
}

function SkillCard({ skill, current, onOpen }: {
  readonly skill: PrivateSkillSummary; readonly current: boolean; readonly onOpen: (skillId: PrivateSkillId) => void;
}) {
  const titleId = `skill-card-${skill.skillId}`;
  return h("li", { class: "skill-card", "aria-current": current ? "true" : undefined, "aria-labelledby": titleId },
    h("h3", { id: titleId }, skill.name),
    h("p", { class: "skill-card__description" }, skill.description),
    h("dl", { class: "account-status skill-card__facts" },
      h("div", null, h("dt", null, "리비전"), h("dd", null, String(skill.head.revision))),
      h("div", null, h("dt", null, "마지막 변경"), h("dd", null, when(skill.updatedAt)))),
    h("button", { class: "button secondary", type: "button", "aria-pressed": current, onClick: () => onOpen(skill.skillId) },
      current ? "보고 있는 스킬" : "열기"));
}

export function LibraryPanel(props: LibraryProps) {
  const { skills, status, message, notice, selectedId, onReload, onOpen } = props;
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const ordered = sortSkills(skills, sort);
  return h("section", { class: "panel library", "aria-labelledby": "library-title" },
    h("div", { class: "panel__head" },
      h("h2", { id: "library-title", tabIndex: -1 }, "스킬 보관함"),
      h("button", { class: "button secondary", type: "button", disabled: status === "loading", onClick: onReload }, "보관함 새로고침")),
    h(SearchBox, { skills, signal: props.signal, onOpen, onUnauthorized: props.onUnauthorized }),
    h("label", { class: "field-label library-sort", for: "skill-sort" }, "정렬",
      h("select", { id: "skill-sort", class: "text-field", value: sort,
        onChange: (event: JSX.TargetedEvent<HTMLSelectElement, Event>) => {
          const value = event.currentTarget.value;
          if (value === "name" || value === "updated") setSort(value);
        } }, h("option", { value: "updated" }, "최근 업데이트순"), h("option", { value: "name" }, "이름순"))),
    notice !== "" && h("p", { class: "note", role: "status", "aria-live": "polite" }, notice),
    h("p", { class: "note", role: "status", "aria-live": "polite" }, status === "loading" ? "스킬 불러오는 중…" : message),
    status === "failed" && h("button", { class: "button secondary", type: "button", onClick: onReload }, "다시 시도"),
    status === "ready" && skills.length === 0 && h("p", { class: "library-empty" },
      "아직 게시한 비공개 스킬이 없습니다. 아래의 ‘새 스킬 게시’에서 SKILL.md가 있는 폴더를 선택하고 업로드에 동의하세요."),
    h("ul", { class: "source-list skill-list", "data-detail": props.detail ? "true" : undefined },
      [...ordered.flatMap(skill => [
        h(SkillCard, { key: skill.skillId, skill, current: skill.skillId === selectedId, onOpen }),
        skill.skillId === selectedId && props.detail && h("li", { key: "detail", class: "skill-detail-slot",
          style: { gridRow: `1 / span ${Math.max(1, skills.length)}` } }, props.detail)]),
      selectedId !== null && !skills.some(skill => skill.skillId === selectedId) &&
        h("li", { key: "detail", class: "skill-detail-slot" }, props.detail)]));
}
