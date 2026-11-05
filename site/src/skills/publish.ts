import { h } from "preact";
import { useRef, useState } from "preact/hooks";
import type { PrivateSkillId } from "../../../shared/dist/private-skills.js";
import { classifyFailure, describeFailure, isUnauthorized, technicalDetail } from "./api.ts";
import { DraftEditor, useDraftGuard } from "./editor.ts";
import { emptyDraft } from "./model.ts";
import type { Draft } from "./model.ts";
import { publishDraft } from "./skill-publish.ts";

export type PublishProps = {
  readonly signal: AbortSignal;
  readonly onPublished: () => void;
  readonly onOpen: (skillId: PrivateSkillId) => void;
  readonly onUnauthorized: () => void;
};

type Outcome =
  | { readonly kind: "none" }
  | { readonly kind: "published"; readonly skillId: PrivateSkillId; readonly name: string; readonly revision: number }
  | { readonly kind: "exists"; readonly skillId: PrivateSkillId };

export function PublishPanel({ signal, onPublished, onOpen, onUnauthorized }: PublishProps) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [notes, setNotes] = useState<readonly string[]>([]);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const submitting = useRef(false);
  useDraftGuard(draft.document !== "" || draft.files.length > 0);

  const change = (next: Draft | ((current: Draft) => Draft), newNotes: readonly string[]) => {
    setDraft(next);
    if (newNotes.length > 0) setNotes(newNotes);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setOutcome({ kind: "none" });
    setDetail(null);
    try {
      setMessage("게시 중\u2026");
      const built = await publishDraft(draft, signal);
      if (!built.ok) {
        setProblems(built.problems);
        setMessage("");
        return;
      }
      setProblems([]);
      const published = built.detail;
      setOutcome({ kind: "published", skillId: published.skill.skillId, name: published.skill.name, revision: published.skill.head.revision });
      setMessage(`${published.skill.name}을 리비전 ${published.skill.head.revision}으로 게시했습니다.`);
      setDraft(emptyDraft());
      setNotes([]);
      onPublished();
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      if (classifyFailure(error) === "conflict") setOutcome({ kind: "exists", skillId: draft.skillId });
      setMessage(describeFailure(error, "게시"));
      setDetail(technicalDetail(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return h("section", { class: "panel", "aria-labelledby": "publish-title" },
    h("h2", { id: "publish-title" }, "새 스킬 게시"),
    h("p", { class: "account-lead" }, "스킬은 SKILL.md와 선택적으로 추가하는 파일로 구성됩니다. 게시하면 내 계정의 새 스킬 ID에 리비전 1로 저장합니다. 이후 버전은 해당 스킬 화면에서 게시합니다."),
    h("form", { class: "publish", onSubmit: submit },
      h(DraftEditor, { draft, idPrefix: "new-skill", busy, notes, onChange: change, showErrors: problems.length > 0 }),
      problems.length > 0 && h("ul", { class: "problems", role: "alert" }, problems.map(problem => h("li", { key: problem }, problem))),
      h("div", { class: "cluster publish__actions" },
        h("button", { class: "button primary", type: "submit", disabled: busy }, "스킬 게시"),
        outcome.kind === "published" && h("button", { class: "button secondary", type: "button", onClick: () => onOpen(outcome.skillId) }, `${outcome.name} 열기`),
        outcome.kind === "exists" && h("button", { class: "button secondary", type: "button", onClick: () => onOpen(outcome.skillId) }, "기존 스킬 열기"),
        h("span", { class: "note", role: "status", "aria-live": "polite" }, message),
        detail !== null && h("details", { class: "technical" }, h("summary", null, "기술 정보"), h("code", null, detail)))));
}
