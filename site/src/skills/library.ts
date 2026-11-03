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
      h("div", null, h("dt", null, "Revision"), h("dd", null, String(skill.head.revision))),
      h("div", null, h("dt", null, "Updated"), h("dd", null, when(skill.updatedAt)))),
    h("button", { class: "button secondary", type: "button", "aria-pressed": current, onClick: () => onOpen(skill.skillId) },
      current ? "Showing this skill" : "Open"));
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
    setMessage("Searching\u2026");
    try {
      const outcome = await searchSkills(query, "discovery", 10, signal);
      setResult(outcome);
      setMessage(outcome.abstained !== undefined ? outcome.abstained.hint :
        outcome.candidates.length === 0 ? "No skill matched." : `${outcome.candidates.length} ${outcome.candidates.length === 1 ? "match" : "matches"}.`);
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setResult(null);
      setMessage(classifyFailure(error) === "gone" ? "Search isn't available on this deployment yet." : describeFailure(error, "Search"));
    } finally {
      setBusy(false);
    }
  };
  return h("form", { class: "search", onSubmit: submit, role: "search", "aria-labelledby": "search-title" },
    h("h3", { id: "search-title", class: "panel__subtitle" }, "Search your skills"),
    h("div", { class: "search__row" },
      h("label", { class: "field-label", for: "skill-search" }, "Words from a name, description or document",
        h("input", { id: "skill-search", class: "text-field", type: "search", autocomplete: "off", value: query, disabled: busy,
          onInput: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => setQuery(event.currentTarget.value) })),
      h("button", { class: "button secondary", type: "submit", disabled: busy }, "Search")),
    h("p", { class: "note", role: "status", "aria-live": "polite" }, message),
    result !== null && result.candidates.length > 0 && h("ul", { class: "search-results" },
      result.candidates.map(candidate => {
        const skillId = skillIdOf(candidate);
        return h("li", { key: candidate.uri, class: "search-result" },
          h("div", { class: "search-result__text" },
            h("strong", null, candidate.name),
            h("span", null, candidate.description),
            candidate.matched.length > 0 && h("span", { class: "note" }, "Matched: ", candidate.matched.join(", "))),
          skillId === null ? h("code", null, candidate.uri)
            : h("button", { class: "button secondary", type: "button", onClick: () => onOpen(skillId) }, "Open"));
      })));
}

export function LibraryPanel(props: LibraryProps) {
  const { skills, status, message, notice, selectedId, onReload, onOpen } = props;
  return h("section", { class: "panel", "aria-labelledby": "library-title" },
    h("div", { class: "panel__head" },
      h("h2", { id: "library-title" }, "Library"),
      h("button", { class: "button secondary", type: "button", disabled: status === "loading", onClick: onReload }, "Reload library")),
    h("p", { class: "account-lead" }, "Every skill keeps its versions. Open one to edit its SKILL.md, publish a new version, pin or restore an older one, export it, or delete it."),
    notice !== "" && h("p", { class: "note", role: "status", "aria-live": "polite" }, notice),
    h("p", { class: "note", role: "status", "aria-live": "polite" }, status === "loading" ? "Loading your skills\u2026" : message),
    status === "failed" && h("button", { class: "button secondary", type: "button", onClick: onReload }, "Try again"),
    status === "ready" && skills.length === 0 && h("p", { class: "library-empty" },
      "You haven't published a private skill yet. Use \u201cPublish a skill\u201d below: pick a folder with a SKILL.md and confirm the upload."),
    skills.length > 0 && h("ul", { class: "source-list skill-list" },
      skills.map(skill => h(SkillCard, { key: skill.skillId, skill, current: skill.skillId === selectedId, onOpen }))),
    skills.length > 0 && h(SearchBox, { signal: props.signal, onOpen, onUnauthorized: props.onUnauthorized }));
}
