import { h } from "preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { parsePrivateSkillUri } from "../../../shared/dist/private-skills.js";
import type { PrivateSkillId, PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import { formatWhen } from "../dashboard/status.ts";
import { classifyFailure, describeFailure, isUnauthorized, searchSkills } from "./api.ts";
import type { SearchCandidate, SearchResult } from "./api.ts";

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
};

export function when(ms: number) {
  return h("time", { dateTime: new Date(ms).toISOString() }, formatWhen(ms));
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

function skillIdOf(candidate: SearchCandidate): PrivateSkillId | null {
  try {
    return parsePrivateSkillUri(candidate.uri).skillId;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function SearchBox({ signal, onOpen, onUnauthorized }: Pick<LibraryProps, "signal" | "onOpen" | "onUnauthorized">) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("검색 중\u2026");
    try {
      const outcome = await searchSkills(query, "discovery", 10, signal);
      setResult(outcome);
      setMessage(outcome.abstained !== undefined ? {
        empty_query: "할 일을 짧은 문장으로 입력하세요.",
        no_overlap: "검색어와 겹치는 스킬을 찾지 못했습니다. 스킬에서 쓰는 말로 바꾸거나 스킬 없이 계속하세요.",
        below_threshold: "충분히 관련 있는 스킬을 찾지 못했습니다. 할 일을 짧게 다시 쓰거나 스킬 없이 계속하세요.",
        explicit_only: "직접 지정해야 하는 스킬만 일치합니다. 사용할 스킬을 직접 선택하세요.",
      }[outcome.abstained.reason] :
        outcome.candidates.length === 0 ? "일치하는 스킬이 없습니다." : `${outcome.candidates.length}개 스킬을 찾았습니다.`);
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setResult(null);
      setMessage(classifyFailure(error) === "gone" ? "이 배포에서는 아직 검색을 이용할 수 없습니다." : describeFailure(error, "검색"));
    } finally {
      setBusy(false);
    }
  };
  return h("form", { class: "search", onSubmit: submit, role: "search", "aria-labelledby": "search-title" },
    h("h3", { id: "search-title", class: "panel__subtitle" }, "내 스킬 검색"),
    h("div", { class: "search__row" },
      h("label", { class: "field-label", for: "skill-search" }, "이름·설명·문서에서 찾을 말",
        h("input", { id: "skill-search", class: "text-field", type: "search", autocomplete: "off", value: query, disabled: busy,
          onInput: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => setQuery(event.currentTarget.value) })),
      h("button", { class: "button secondary", type: "submit", disabled: busy }, "검색")),
    h("p", { class: "note", role: "status", "aria-live": "polite" }, message),
    result !== null && result.candidates.length > 0 && h("ul", { class: "search-results" },
      result.candidates.map(candidate => {
        const skillId = skillIdOf(candidate);
        return h("li", { key: candidate.uri, class: "search-result" },
          h("div", { class: "search-result__text" },
            h("strong", null, candidate.name),
            h("span", null, candidate.description),
            candidate.matched.length > 0 && h("span", { class: "note" }, "일치 항목: ", candidate.matched.join(", "))),
          skillId === null ? h("code", null, candidate.uri)
            : h("button", { class: "button secondary", type: "button", onClick: () => onOpen(skillId) }, "열기"));
      })));
}

export function LibraryPanel(props: LibraryProps) {
  const { skills, status, message, notice, selectedId, onReload, onOpen } = props;
  return h("section", { class: "panel", "aria-labelledby": "library-title" },
    h("div", { class: "panel__head" },
      h("h2", { id: "library-title" }, "스킬 보관함"),
      h("button", { class: "button secondary", type: "button", disabled: status === "loading", onClick: onReload }, "보관함 새로고침")),
    h("p", { class: "account-lead" }, "스킬은 버전별로 보관합니다. 스킬을 열어 SKILL.md를 편집하고 새 버전을 게시하거나, 이전 버전을 고정·복원하고 내보내거나 삭제할 수 있습니다."),
    notice !== "" && h("p", { class: "note", role: "status", "aria-live": "polite" }, notice),
    h("p", { class: "note", role: "status", "aria-live": "polite" }, status === "loading" ? "스킬 불러오는 중\u2026" : message),
    status === "failed" && h("button", { class: "button secondary", type: "button", onClick: onReload }, "다시 시도"),
    status === "ready" && skills.length === 0 && h("p", { class: "library-empty" },
      "아직 게시한 비공개 스킬이 없습니다. 아래의 ‘새 스킬 게시’에서 SKILL.md가 있는 폴더를 선택하고 업로드에 동의하세요."),
    skills.length > 0 && h("ul", { class: "source-list skill-list" },
      skills.map(skill => h(SkillCard, { key: skill.skillId, skill, current: skill.skillId === selectedId, onOpen }))),
    skills.length > 0 && h(SearchBox, { signal: props.signal, onOpen, onUnauthorized: props.onUnauthorized }));
}
