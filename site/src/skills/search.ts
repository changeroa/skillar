import { h } from "preact";
import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { parsePrivateSkillUri } from "../../../shared/dist/private-skills.js";
import type { PrivateSkillId, PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import { classifyFailure, describeFailure, isUnauthorized, searchSkills, technicalDetail } from "./api.ts";
import type { SearchCandidate, SearchResult } from "./api.ts";
import { Input } from "../../../local/dashboard/foundation/controls/fields";
import { Button } from "../../../local/dashboard/foundation/controls/buttons";
import { ComboboxInput } from "../../../local/dashboard/foundation/controls/combobox";
import { Glyph } from "../../../local/dashboard/foundation/controls/icons";

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
  readonly query?: string;
  readonly onQueryChange?: (query: string) => void;
  readonly compact?: boolean;
};

export function SearchBox({ skills, signal, onOpen, onUnauthorized, children, query: controlledQuery, onQueryChange, compact }: Props) {
  const [localQuery, setLocalQuery] = useState("");
  const query = controlledQuery ?? localQuery;
  const setQuery = (value: string) => { setLocalQuery(value); onQueryChange?.(value); };
  const [result, setResult] = useState<SearchResult | null>(null);
  const [message, setMessage] = useState("");
  const [technical, setTechnical] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const [expanded, setExpanded] = useState(false);
  const searchId = compact ? "skill-search-compact" : "skill-search";
  const listId = `${searchId}-results`;
  const optionPrefix = compact ? "compact-search-result" : "search-result";
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
    setExpanded(false);
    setTechnical(null);
    setMessage("검색 중…");
    try {
      const outcome = await searchSkills(query, "discovery", 10, signal);
      setResult(outcome);
      setExpanded(outcome.candidates.length > 0);
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
    if (event.isComposing) return;
    const candidates = result?.candidates ?? [];
    const enabled = candidates.flatMap((candidate, index) => skillIdOf(candidate) === null ? [] : [index]);
    if (event.key === "Escape") {
      if (expanded) { event.preventDefault(); event.stopPropagation(); }
      setActive(-1); setExpanded(false); return;
    }
    if (enabled.length === 0) return;
    const move = (direction: 1 | -1) => {
      setExpanded(true);
      setActive(current => {
        const position = enabled.indexOf(current);
        const next = position < 0 ? (direction === 1 ? 0 : enabled.length - 1) : (position + direction + enabled.length) % enabled.length;
        return enabled[next] ?? -1;
      });
    };
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); break;
      case "ArrowUp": event.preventDefault(); move(-1); break;
      case "Home": if (expanded) { event.preventDefault(); setActive(enabled[0] ?? -1); } break;
      case "End": if (expanded) { event.preventDefault(); setActive(enabled.at(-1) ?? -1); } break;
      case "Tab": setExpanded(false); setActive(-1); break;
      case "Enter": {
        if (!expanded) return;
        const candidate = candidates[active];
        if (candidate === undefined) return;
        event.preventDefault();
        const id = skillIdOf(candidate);
        if (id !== null) onOpen(id);
        break;
      }
    }
  };
  const searchProps = { id: searchId, type: "search", autocomplete: "off", value: query, disabled: busy,
    placeholder: "이름·설명·문서에서 검색",
    role: "combobox", "aria-label": "내 스킬 검색", "aria-autocomplete": "list",
    "aria-expanded": expanded, "aria-controls": listId,
    "aria-activedescendant": expanded && active >= 0 ? `${optionPrefix}-${active}` : undefined,
    onKeyDown: navigate, onInput: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
      setQuery(event.currentTarget.value); setActive(-1); setExpanded(false);
    },
  } satisfies JSX.InputHTMLAttributes<HTMLInputElement>;
  return h("form", { class: compact ? "search search--compact" : "search", onSubmit: submit, role: "search", "aria-label": "내 스킬 검색" },
    h("div", { class: "search__row" },
      compact ? h(Input, { ...searchProps, inputRef: input, label: "내 스킬 검색" })
        : h("label", { id: "search-title", class: "field-label", for: searchId }, "내 스킬 검색",
          h(ComboboxInput, { ...searchProps, inputRef: input })),
      compact ? h(Button, { text: failed ? "다시 시도" : "검색", variant: "outline", type: "submit", disabled: busy })
        : h("button", { class: "button secondary", type: "submit", disabled: busy }, failed ? "다시 시도" : "검색"),
      children),
    (!compact || result !== null) && h("p", { class: "note" }, "결과 선택은 ↑↓, 열기는 ", h("code", null, "Enter"), ". 정렬은 보관함에만 적용됩니다."),
    h("p", { class: "note", role: "status", "aria-live": "polite" }, message),
    result !== null && result.candidates.length === 0 && result.abstained === undefined &&
      h("button", { class: "button secondary", type: "button", onClick: () => {
        setQuery(""); setResult(null); setMessage(""); setActive(-1); input.current?.focus();
      } }, "검색어 지우기"),
    result?.abstained !== undefined && h("button", { class: "button secondary", type: "button",
      onClick: () => input.current?.focus() }, "검색어 다시 쓰기"),
    technical !== null && h("details", { class: "technical" }, h("summary", null, "기술 정보"), h("code", null, technical)),
    result !== null && h("p", { class: "search__query" }, "검색한 문장: ", h("q", null, result.query)),
    h("ul", { id: listId, class: "search-results", role: "listbox", "aria-label": "검색 후보", hidden: !expanded },
      result?.candidates.map((candidate, index) => {
        const skillId = skillIdOf(candidate);
        const relation = candidateHead(candidate, skills);
        return h("li", { key: candidate.uri, id: `${optionPrefix}-${index}`, class: "search-result", role: "option",
          "aria-selected": active === index, "aria-disabled": skillId === null || undefined, "data-active": active === index,
          "aria-label": `${candidate.rank}위 ${candidate.name} 현재 버전 열기`, "aria-describedby": `${optionPrefix}-${index}-detail`,
          onPointerMove: () => { if (skillId !== null) setActive(index); } },
          h("div", { id: `${optionPrefix}-${index}-detail`, class: "search-result__text" },
            h("span", { class: "note" }, `순위 ${candidate.rank} · ${{ automatic: "자동 추천 가능", explicit: "직접 지정 전용" }[candidate.invocation]}`),
            h("strong", { class: "search-result__name" }, active === index && h(Glyph, { name: "check" }), candidate.name),
            h("span", null, candidate.description),
            candidate.matched.length > 0 && h("span", { class: "note" }, "일치 항목: ", candidate.matched.join(", ")),
            h("p", { class: "note" }, "URI: ", h("code", null, candidate.uri.replace(/[a-f0-9]{64}/g, digest => digest.slice(0, 8)))),
            h("p", { class: "note" }, "검색 당시 digest: ", h("code", null, candidate.digest.slice(0, 8))),
            h("p", { class: "note" }, { current: "현재 버전과 같습니다.", different: "현재 버전과 다릅니다.", unknown: "현재 버전과의 일치 여부를 확인하지 못했습니다." }[relation])),
          skillId === null ? h("code", null, candidate.uri.replace(/[a-f0-9]{64}/g, digest => digest.slice(0, 8)))
            : h("button", { class: "button secondary", type: "button", tabIndex: -1, "aria-hidden": "true",
              onMouseDown: (event: MouseEvent) => event.preventDefault(),
              onClick: () => onOpen(skillId) }, "현재 버전 열기"));
      })),
    result !== null && h("p", { class: "note" }, "검색 후보는 작업 성공의 근거가 아닙니다. ‘현재 버전 열기’는 검색 당시 버전이 아닌 보관함의 현재 버전을 엽니다."));
}
