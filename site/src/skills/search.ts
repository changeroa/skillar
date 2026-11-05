import { h } from "preact";
import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { parsePrivateSkillUri } from "../../../shared/dist/private-skills.js";
import type { PrivateSkillId, PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import { classifyFailure, describeFailure, isUnauthorized, searchSkills, technicalDetail } from "./api.ts";
import type { SearchCandidate, SearchResult } from "./api.ts";

export function skillIdOf(candidate: SearchCandidate): PrivateSkillId | null {
  try {
    return parsePrivateSkillUri(candidate.uri).skillId;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

export function candidateHead(candidate: SearchCandidate, skills: readonly PrivateSkillSummary[]): "current" | "different" | "unknown" {
  const skill = skills.find(entry => entry.skillId === skillIdOf(candidate));
  return skill === undefined ? "unknown" : skill.head.digest === candidate.digest ? "current" : "different";
}

type Props = {
  readonly skills: readonly PrivateSkillSummary[];
  readonly signal: AbortSignal;
  readonly onOpen: (skillId: PrivateSkillId) => void;
  readonly onUnauthorized: () => void;
  readonly children?: ComponentChildren;
};

export function SearchBox({ skills, signal, onOpen, onUnauthorized, children }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [message, setMessage] = useState("");
  const [technical, setTechnical] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement | null>(null);
  const submit = async (event: Event) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setFailed(false);
    setResult(null);
    setActive(-1);
    setTechnical(null);
    setMessage("검색 중…");
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
      if (isUnauthorized(error)) { onUnauthorized(); return; }
      setFailed(true);
      setTechnical(technicalDetail(error));
      setMessage(classifyFailure(error) === "gone" ? "이 배포에서는 아직 검색을 이용할 수 없습니다." : describeFailure(error, "검색"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const navigate = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    const candidates = result?.candidates ?? [];
    if (candidates.length === 0) return;
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); setActive(current => (current + 1) % candidates.length); break;
      case "ArrowUp": event.preventDefault(); setActive(current => (current <= 0 ? candidates.length : current) - 1); break;
      case "Escape": setActive(-1); break;
      case "Enter": {
        const candidate = candidates[active];
        if (candidate === undefined) return;
        event.preventDefault();
        const id = skillIdOf(candidate);
        if (id !== null) onOpen(id);
        break;
      }
    }
  };
  return h("form", { class: "search", onSubmit: submit, role: "search", "aria-labelledby": "search-title" },
    h("div", { class: "search__row" },
      h("label", { id: "search-title", class: "field-label", for: "skill-search" }, "내 스킬 검색",
        h("input", { id: "skill-search", ref: input, class: "text-field", type: "search", autocomplete: "off", value: query, disabled: busy,
          placeholder: "이름·설명·문서에서 검색",
          role: "combobox", "aria-autocomplete": "list", "aria-expanded": (result?.candidates.length ?? 0) > 0,
          "aria-controls": "skill-search-results", "aria-activedescendant": active >= 0 ? `search-result-${active}` : undefined,
          onKeyDown: navigate, onInput: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
            setQuery(event.currentTarget.value); setActive(-1);
          } })),
      h("button", { class: "button secondary", type: "submit", disabled: busy }, failed ? "다시 시도" : "검색"),
      children),
    h("p", { class: "note" }, "결과 선택은 ↑↓, 열기는 ", h("code", null, "Enter"), ". 정렬은 보관함에만 적용됩니다."),
    h("p", { class: "note", role: "status", "aria-live": "polite" }, message),
    result !== null && result.candidates.length === 0 && result.abstained === undefined &&
      h("button", { class: "button secondary", type: "button", onClick: () => {
        setQuery(""); setResult(null); setMessage(""); setActive(-1); input.current?.focus();
      } }, "검색어 지우기"),
    result?.abstained !== undefined && h("button", { class: "button secondary", type: "button",
      onClick: () => input.current?.focus() }, "검색어 다시 쓰기"),
    technical !== null && h("details", { class: "technical" }, h("summary", null, "기술 정보"), h("code", null, technical)),
    result !== null && h("p", { class: "search__query" }, "검색한 문장: ", h("q", null, result.query)),
    h("ul", { id: "skill-search-results", class: "search-results", role: "listbox", "aria-label": "검색 후보" },
      result?.candidates.map((candidate, index) => {
        const skillId = skillIdOf(candidate);
        const relation = candidateHead(candidate, skills);
        return h("li", { key: candidate.uri, class: "search-result", role: "presentation", "data-active": active === index },
          h("div", { class: "search-result__text" },
            h("span", { class: "note" }, `순위 ${candidate.rank} · ${{ automatic: "자동 추천 가능", explicit: "직접 지정 전용" }[candidate.invocation]}`),
            h("strong", null, candidate.name), h("span", null, candidate.description),
            candidate.matched.length > 0 && h("span", { class: "note" }, "일치 항목: ", candidate.matched.join(", ")),
            h("p", { class: "note" }, "URI: ", h("code", null, candidate.uri)),
            h("p", { class: "note" }, "검색 당시 digest: ", h("code", null, candidate.digest)),
            h("p", { class: "note" }, { current: "현재 버전과 같습니다.", different: "현재 버전과 다릅니다.", unknown: "현재 버전과의 일치 여부를 확인하지 못했습니다." }[relation])),
          skillId === null ? h("code", null, candidate.uri)
            : h("button", { id: `search-result-${index}`, class: "button secondary", type: "button", role: "option",
              "aria-selected": active === index, "aria-label": `${candidate.rank}위 ${candidate.name} 현재 버전 열기`,
              onClick: () => onOpen(skillId) }, "현재 버전 열기"));
      })),
    result !== null && h("p", { class: "note" }, "검색 후보는 작업 성공의 근거가 아닙니다. ‘현재 버전 열기’는 검색 당시 버전이 아닌 보관함의 현재 버전을 엽니다."));
}
