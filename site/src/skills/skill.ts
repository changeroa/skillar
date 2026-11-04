import { h } from "preact";
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type {
  PrivateSkillDetail, PrivateSkillDigest, PrivateSkillHead, PrivateSkillId, PrivateSkillManifest, PrivateSkillPackage,
  PrivateSkillSummary,
} from "../../../shared/dist/private-skills.js";
import { downloadTextFile } from "../dashboard/grant.ts";
import {
  classifyFailure, deleteSkill, deleteVersion, describeFailure, isUnauthorized, publishVersion, readExport, readSkill, setHead,
  setPinned, technicalDetail,
} from "./api.ts";
import { DraftEditor } from "./editor.ts";
import { buildPackage, draftFromExport, exportFileName, formatBytes, SkillDraftError } from "./model.ts";
import type { Draft } from "./model.ts";
import { when } from "./library.ts";

export type SkillProps = {
  readonly skillId: PrivateSkillId;
  readonly summary: PrivateSkillSummary | null;
  readonly signal: AbortSignal;
  readonly focusHeading: number;
  readonly onChanged: () => void;
  readonly onDeleted: (name: string) => void;
  readonly onBack: () => void;
  readonly onUnauthorized: () => void;
};

type Version = PrivateSkillDetail["versions"][number];
type Resources = PrivateSkillManifest["resources"];
type DetailState =
  | { readonly status: "loading"; readonly detail: PrivateSkillDetail | null }
  | { readonly status: "ready"; readonly detail: PrivateSkillDetail }
  | { readonly status: "failed"; readonly detail: PrivateSkillDetail | null; readonly message: string }
  | { readonly status: "gone"; readonly message: string };
type DraftState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly draft: Draft; readonly baseline: Draft; readonly resources: Resources }
  | { readonly status: "failed"; readonly message: string };
type Note = { readonly text: string; readonly technical: string | null };
type Pending = { readonly kind: "skill" } | { readonly kind: "version"; readonly digest: PrivateSkillDigest };
export type DeleteTarget = { readonly kind: "skill"; readonly name: string } | { readonly kind: "version"; readonly digest: PrivateSkillDigest };

const silent: Note = { text: "", technical: null };

/** The text a person must type before "Confirm delete" is enabled. A pointer alone can never produce it, so repeated clicks cannot delete. */
export function confirmationText(target: DeleteTarget): string {
  return target.kind === "skill" ? target.name : target.digest.slice(0, 8);
}

/** Skill names match exactly after trimming and Unicode normalisation; a digest prefix is hex, so its case does not matter. */
export function confirmsDeletion(target: DeleteTarget, typed: string): boolean {
  const expected = confirmationText(target);
  const input = typed.trim().normalize();
  if (input === "") return false;
  return target.kind === "skill" ? input === expected.trim().normalize() : input.toLowerCase() === expected.toLowerCase();
}

/** The trigger that opened a confirmation gets focus back when it closes; it is looked up by id because closing re-renders it. */
function triggerId(pending: Pending): string {
  return pending.kind === "skill" ? "skill-delete" : `version-delete-${pending.digest.slice(0, 16)}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isDirty(state: DraftState): boolean {
  return state.status === "ready" && (state.draft.document !== state.baseline.document || state.draft.files !== state.baseline.files);
}

function failureNote(error: unknown, action: string): Note {
  return { text: describeFailure(error, action), technical: technicalDetail(error) };
}

function describeDraftFailure(error: unknown): string {
  if (error instanceof SkillDraftError) {
    return error.code === "document_not_text"
      ? "This version's SKILL.md isn't UTF-8 text, so it can't be edited here. Older versions may still be exported."
      : "This version has no SKILL.md, so it can't be edited here.";
  }
  return describeFailure(error, "Loading the current version");
}

function NoteLine({ note }: { readonly note: Note }) {
  return [
    h("span", { key: "text", class: "note", role: "status", "aria-live": "polite" }, note.text),
    note.technical !== null && h("details", { key: "technical", class: "technical" }, h("summary", null, "Technical details"), h("code", null, note.technical)),
  ];
}

export function SkillPanel({ skillId, summary, signal, focusHeading, onChanged, onDeleted, onBack, onUnauthorized }: SkillProps) {
  const [detailState, setDetailState] = useState<DetailState>({ status: "loading", detail: null });
  const [draftState, setDraftState] = useState<DraftState>({ status: "loading" });
  const [notes, setNotes] = useState<readonly string[]>([]);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [publishNote, setPublishNote] = useState<Note>(silent);
  const [versionsNote, setVersionsNote] = useState<Note>(silent);
  const [deleteNote, setDeleteNote] = useState<Note>(silent);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");
  const heading = useRef<HTMLHeadingElement | null>(null);
  const confirmField = useRef<HTMLInputElement | null>(null);
  const draftRef = useRef<DraftState>(draftState);
  draftRef.current = draftState;

  const detail = detailState.status === "gone" ? null : detailState.detail;
  const name = detail?.skill.name ?? summary?.name ?? "";
  const head = detail?.skill.head ?? null;

  const loadDraft = async (target: PrivateSkillHead) => {
    setDraftState({ status: "loading" });
    try {
      const exported = await readExport(skillId, target.digest, signal);
      const draft = await draftFromExport(exported, target);
      setDraftState({ status: "ready", draft, baseline: draft, resources: exported.package.manifest.resources });
    } catch (error) {
      if (isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setDraftState({ status: "failed", message: describeDraftFailure(error) });
    }
  };

  const adoptHead = (next: PrivateSkillDetail, reviewed: boolean) => {
    const current = draftRef.current;
    const target = next.skill.head;
    if (current.status !== "ready") {
      void loadDraft(target);
      return;
    }
    const moved = current.draft.base?.digest !== target.digest;
    if (moved && !isDirty(current)) {
      void loadDraft(target);
      return;
    }
    const draft = { ...current.draft, base: target };
    setDraftState({ ...current, draft, baseline: { ...current.baseline, base: target } });
    if (moved || reviewed) {
      setNotes([`The current version is now revision ${target.revision}. Your edits are kept and will be published on top of it.`]);
    }
  };

  const gone = (error: unknown, action: string) => {
    if (classifyFailure(error) === "gone") setDetailState({ status: "gone", message: describeFailure(error, action) });
  };

  useEffect(() => {
    let active = true;
    setDetailState(current => ({ status: "loading", detail: current.status === "gone" ? null : current.detail }));
    setDraftState({ status: "loading" });
    setNotes([]);
    setProblems([]);
    setPublishNote(silent);
    setVersionsNote(silent);
    setDeleteNote(silent);
    setConflict(false);
    setPending(null);
    readSkill(skillId, signal).then(next => {
      if (!active) return;
      setDetailState({ status: "ready", detail: next });
      void loadDraft(next.skill.head);
    }, (error: unknown) => {
      if (!active || isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      if (classifyFailure(error) === "gone") setDetailState({ status: "gone", message: describeFailure(error, "Opening the skill") });
      else setDetailState(current => ({ status: "failed", detail: current.status === "gone" ? null : current.detail, message: describeFailure(error, "Opening the skill") }));
    });
    return () => { active = false; };
  }, [skillId, signal]);

  useLayoutEffect(() => {
    if (focusHeading > 0) heading.current?.focus();
  }, [focusHeading]);

  useLayoutEffect(() => {
    if (pending === null) return;
    confirmField.current?.focus();
    const trigger = triggerId(pending);
    return () => (document.getElementById(trigger) ??
      (pending.kind === "version" ? document.getElementById("versions-title") : null))?.focus();
  }, [pending]);

  const openConfirmation = (next: Pending) => {
    setTyped("");
    setPending(next);
  };

  const run = async (action: string, task: () => Promise<PrivateSkillDetail>) => {
    setBusy(true);
    setVersionsNote({ text: `${action}\u2026`, technical: null });
    try {
      const next = await task();
      setDetailState({ status: "ready", detail: next });
      adoptHead(next, false);
      setVersionsNote({ text: `${action} done. The skill is at revision ${next.skill.head.revision}.`, technical: null });
      onChanged();
    } catch (error) {
      if (isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      gone(error, action);
      setVersionsNote(failureNote(error, action));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const review = async () => {
    setBusy(true);
    setPublishNote({ text: "Reading the current version\u2026", technical: null });
    try {
      const next = await readSkill(skillId, signal);
      setDetailState({ status: "ready", detail: next });
      setConflict(false);
      adoptHead(next, true);
      setPublishNote({ text: `Reviewed. The current version is revision ${next.skill.head.revision}; publish again to put your draft on top of it.`, technical: null });
    } catch (error) {
      if (isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      gone(error, "Reviewing the skill");
      setPublishNote(failureNote(error, "Reviewing the skill"));
    } finally {
      setBusy(false);
    }
  };

  const afterPublish = (next: PrivateSkillDetail, draft: Draft, pkg: PrivateSkillPackage) => {
    setDetailState({ status: "ready", detail: next });
    const settled: Draft = { ...draft, base: next.skill.head, acknowledged: false };
    setDraftState({ status: "ready", draft: settled, baseline: settled, resources: pkg.manifest.resources });
    setConflict(false);
    setNotes([]);
  };

  const publish = async (event: Event) => {
    event.preventDefault();
    if (draftState.status !== "ready" || head === null) return;
    const draft = draftState.draft;
    const built = await buildPackage(draft);
    if (!built.ok) {
      setProblems(built.problems);
      return;
    }
    setProblems([]);
    setBusy(true);
    setPublishNote({ text: "Publishing\u2026", technical: null });
    try {
      const next = await publishVersion(skillId, draft.base, built.package, signal);
      afterPublish(next, draft, built.package);
      setPublishNote({ text: `Published revision ${next.skill.head.revision}.`, technical: null });
      onChanged();
    } catch (error) {
      if (isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      if (classifyFailure(error) === "conflict") setConflict(true);
      gone(error, "Publishing");
      setPublishNote(failureNote(error, "Publishing"));
    } finally {
      setBusy(false);
    }
  };

  const exportVersion = async (digest: PrivateSkillDigest) => {
    setBusy(true);
    setVersionsNote({ text: "Preparing the export\u2026", technical: null });
    try {
      const exported = await readExport(skillId, digest, signal);
      const fileName = exportFileName(name, digest);
      downloadTextFile(fileName, JSON.stringify(exported, null, 2));
      setVersionsNote({ text: `Export ready: ${fileName}.`, technical: null });
    } catch (error) {
      if (isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setVersionsNote(failureNote(error, "Exporting"));
    } finally {
      setBusy(false);
    }
  };

  const removeSkill = async () => {
    if (head === null) return;
    setBusy(true);
    setDeleteNote({ text: "Deleting the skill\u2026", technical: null });
    try {
      await deleteSkill(skillId, head, signal);
      onDeleted(name);
    } catch (error) {
      if (isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      gone(error, "Deleting the skill");
      setDeleteNote(failureNote(error, "Deleting the skill"));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const confirmation = (target: DeleteTarget, consequence: string, keepLabel: string, onConfirm: () => unknown) => {
    const id = target.kind === "skill" ? "confirm-delete-skill" : `confirm-delete-${target.digest.slice(0, 16)}`;
    const armed = !busy && confirmsDeletion(target, typed);
    return h("div", { class: "editor", role: "group", "aria-labelledby": `${id}-consequence`,
      onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || busy) return;
        event.preventDefault();
        setPending(null);
      } },
      h("p", { id: `${id}-consequence`, class: "note" }, consequence),
      h("label", { class: "field-label", for: id },
        h("span", null, target.kind === "skill" ? "To confirm, type the skill name " : "To confirm, type the first 8 characters of this version's digest ",
          h("code", { class: "version__digest" }, confirmationText(target))),
        h("input", { id, ref: confirmField, class: "text-field", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: false,
          value: typed, disabled: busy, "aria-describedby": `${id}-consequence`,
          onInput: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => setTyped(event.currentTarget.value) })),
      h("div", { class: "cluster" },
        h("button", { class: "button secondary", type: "button", disabled: busy, onClick: () => setPending(null) }, keepLabel),
        h("button", { class: "button primary", type: "button", disabled: !armed, onClick: () => { if (armed) void onConfirm(); } }, "Confirm delete")));
  };

  const title = name === "" ? "Skill" : `Skill: ${name}`;
  const panelHead = h("div", { class: "panel__head" },
    h("h2", { id: "skill-title", ref: heading, tabIndex: -1 }, title),
    h("button", { class: "button secondary", type: "button", onClick: onBack }, "Back to library"));

  if (detailState.status === "gone") {
    return h("section", { class: "panel skill", "aria-labelledby": "skill-title" },
      panelHead,
      h("p", { class: "note", role: "status", "aria-live": "polite" }, detailState.message),
      draftState.status === "ready" && h("p", null, "Your unsaved draft is still shown below so you can copy it. It can't be published to this skill any more."),
      draftState.status === "ready" && h("textarea", { class: "document-field", rows: 12, readOnly: true, "aria-label": "Draft SKILL.md text", value: draftState.draft.document }));
  }

  const versionRow = (version: Version) => {
    const current = head !== null && version.digest === head.digest;
    const protectedReason = current ? "This is the current version; make another version current before deleting it."
      : version.pinned ? "This version is pinned; unpin it before deleting it." : null;
    const confirming = pending?.kind === "version" && pending.digest === version.digest;
    const rowId = `version-${version.digest.slice(0, 16)}`;
    return h("li", { key: version.digest, class: "version", "aria-labelledby": rowId },
      h("div", { class: "version__meta" },
        h("p", { id: rowId, class: "version__flags" },
          current && h("strong", null, "Current"),
          current && version.pinned && " \u00b7 ",
          version.pinned && h("strong", null, "Pinned"),
          !current && !version.pinned && h("span", { class: "note" }, "Older version")),
        h("p", { class: "note" }, "Created ", when(version.createdAt)),
        h("code", { class: "version__digest" }, version.digest)),
      h("div", { class: "cluster version__actions" },
        !current && head !== null && h("button", { class: "button secondary", type: "button", disabled: busy,
          onClick: () => run("Making this version current", () => setHead(skillId, head, version.digest, signal)) }, "Make current"),
        head !== null && h("button", { class: "button secondary", type: "button", disabled: busy, "aria-pressed": version.pinned,
          onClick: () => run(version.pinned ? "Unpinning" : "Pinning", () => setPinned(skillId, head, version.digest, !version.pinned, signal)) },
          version.pinned ? "Unpin" : "Pin"),
        h("button", { class: "button secondary", type: "button", disabled: busy, onClick: () => exportVersion(version.digest) }, "Export JSON"),
        protectedReason === null && head !== null && (confirming
          ? confirmation({ kind: "version", digest: version.digest }, "Deleting removes this version's files from your account. It cannot be undone.", "Keep version",
            () => run("Deleting the version", () => deleteVersion(skillId, head, version.digest, signal)))
          : h("button", { id: triggerId({ kind: "version", digest: version.digest }), class: "button secondary", type: "button", disabled: busy,
            onClick: () => openConfirmation({ kind: "version", digest: version.digest }) }, "Delete version\u2026")),
        protectedReason !== null && h("span", { class: "note version__protected" }, protectedReason)));
  };

  return h("section", { class: "panel skill", "aria-labelledby": "skill-title" },
    panelHead,
    (detail?.skill.description ?? summary?.description) !== undefined && h("p", { class: "account-lead" }, detail?.skill.description ?? summary?.description),
    h("p", { class: "note skill__status", role: "status", "aria-live": "polite" },
      detailState.status === "loading" ? "Loading the skill\u2026" : detailState.status === "failed" ? detailState.message : ""),
    detail !== null && h("dl", { class: "account-status skill__facts" },
      h("div", null, h("dt", null, "Skill ID"), h("dd", null, h("code", null, detail.skill.skillId))),
      h("div", null, h("dt", null, "Current revision"), h("dd", null, String(detail.skill.head.revision))),
      h("div", null, h("dt", null, "Current digest"), h("dd", null, h("code", null, detail.skill.head.digest))),
      h("div", null, h("dt", null, "Updated"), h("dd", null, when(detail.skill.updatedAt))),
      h("div", null, h("dt", null, "Versions kept"), h("dd", null, String(detail.versions.length)))),
    detail !== null && h("section", { class: "skill__section", "aria-labelledby": "resources-title" },
      h("h3", { id: "resources-title", class: "panel__subtitle" }, "Files in the current version"),
      draftState.status === "ready"
        ? h("dl", { class: "account-status resource-list" }, draftState.resources.map(resource =>
          h("div", { key: resource.path }, h("dt", null, h("code", null, resource.path)), h("dd", null, `${formatBytes(resource.bytes)} \u00b7 ${resource.mediaType}`))))
        : h("p", { class: "note", role: "status" }, draftState.status === "loading" ? "Loading the current version\u2026" : draftState.message)),
    detail !== null && draftState.status === "ready" && h("form", { class: "skill__section publish", onSubmit: publish, "aria-labelledby": "edit-title" },
      h("h3", { id: "edit-title", class: "panel__subtitle" }, "Edit and publish a new version"),
      h("p", { class: "note" }, `Edits stay in this page until you publish. Publishing creates revision ${detail.skill.head.revision + 1} on top of revision ${draftState.draft.base?.revision ?? detail.skill.head.revision}; earlier versions are kept.`),
      h(DraftEditor, { draft: draftState.draft, idPrefix: "edit-skill", busy, notes,
        onChange: (next, newNotes) => {
          setDraftState({ ...draftState, draft: next });
          if (newNotes.length > 0) setNotes(newNotes);
        } }),
      problems.length > 0 && h("ul", { class: "problems", role: "alert" }, problems.map(problem => h("li", { key: problem }, problem))),
      h("div", { class: "cluster publish__actions" },
        h("button", { class: "button primary", type: "submit", disabled: busy }, "Publish new version"),
        conflict && h("button", { class: "button secondary", type: "button", disabled: busy, onClick: review }, "Review current version"),
        isDirty(draftState) && head !== null && h("button", { class: "button secondary", type: "button", disabled: busy,
          onClick: () => loadDraft(head) }, "Discard edits and load the current version"),
        h(NoteLine, { note: publishNote }))),
    detail !== null && h("section", { class: "skill__section", "aria-labelledby": "versions-title" },
      h("h3", { id: "versions-title", class: "panel__subtitle", tabIndex: -1 }, "Versions"),
      h("p", { class: "note" }, "Make current restores an older version as the one agents will get; pinning keeps a version from being deleted. Each version can be exported as JSON."),
      h("div", { class: "cluster versions__note" }, h(NoteLine, { note: versionsNote })),
      h("ul", { class: "version-list" }, detail.versions.map(versionRow))),
    detail !== null && h("section", { class: "skill__section skill__danger", "aria-labelledby": "delete-title" },
      h("h3", { id: "delete-title", class: "panel__subtitle" }, "Delete this skill"),
      h("p", { class: "note" }, "Deleting removes every version of this skill from your account. Export anything you want to keep first."),
      h("div", { class: "cluster" }, pending?.kind === "skill"
        ? confirmation({ kind: "skill", name }, `This deletes ${detail.versions.length} ${detail.versions.length === 1 ? "version" : "versions"}. It cannot be undone.`,
          "Keep skill", removeSkill)
        : h("button", { id: triggerId({ kind: "skill" }), class: "button secondary", type: "button", disabled: busy, onClick: () => openConfirmation({ kind: "skill" }) },
          "Delete skill\u2026"),
        h(NoteLine, { note: deleteNote }))));
}
