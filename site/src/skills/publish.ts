import { h } from "preact";
import { useState } from "preact/hooks";
import type { PrivateSkillId } from "../../../shared/dist/private-skills.js";
import { classifyFailure, describeFailure, isUnauthorized, publishVersion, technicalDetail } from "./api.ts";
import { DraftEditor } from "./editor.ts";
import { buildPackage, emptyDraft } from "./model.ts";
import type { Draft } from "./model.ts";

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

  const change = (next: Draft, newNotes: readonly string[]) => {
    setDraft(next);
    if (newNotes.length > 0) setNotes(newNotes);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    setOutcome({ kind: "none" });
    setDetail(null);
    const built = await buildPackage(draft);
    if (!built.ok) {
      setProblems(built.problems);
      setMessage("");
      return;
    }
    setProblems([]);
    setBusy(true);
    setMessage("Publishing\u2026");
    try {
      const published = await publishVersion(draft.skillId, null, built.package, signal);
      setOutcome({ kind: "published", skillId: published.skill.skillId, name: published.skill.name, revision: published.skill.head.revision });
      setMessage(`Published ${published.skill.name} as revision ${published.skill.head.revision}.`);
      setDraft(emptyDraft());
      setNotes([]);
      onPublished();
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      if (classifyFailure(error) === "conflict") setOutcome({ kind: "exists", skillId: draft.skillId });
      setMessage(describeFailure(error, "Publishing"));
      setDetail(technicalDetail(error));
    } finally {
      setBusy(false);
    }
  };

  return h("section", { class: "panel", "aria-labelledby": "publish-title" },
    h("h2", { id: "publish-title" }, "Publish a skill"),
    h("p", { class: "account-lead" }, "A skill is a SKILL.md with optional supporting files. Publishing stores revision 1 under a new skill ID in your account; later versions are published from the skill itself."),
    h("form", { class: "publish", onSubmit: submit },
      h(DraftEditor, { draft, idPrefix: "new-skill", busy, notes, onChange: change }),
      problems.length > 0 && h("ul", { class: "problems", role: "alert" }, problems.map(problem => h("li", { key: problem }, problem))),
      h("div", { class: "cluster publish__actions" },
        h("button", { class: "button primary", type: "submit", disabled: busy }, "Publish skill"),
        outcome.kind === "published" && h("button", { class: "button secondary", type: "button", onClick: () => onOpen(outcome.skillId) }, `Open ${outcome.name}`),
        outcome.kind === "exists" && h("button", { class: "button secondary", type: "button", onClick: () => onOpen(outcome.skillId) }, "Open the existing skill"),
        h("span", { class: "note", role: "status", "aria-live": "polite" }, message),
        detail !== null && h("details", { class: "technical" }, h("summary", null, "Technical details"), h("code", null, detail)))));
}
