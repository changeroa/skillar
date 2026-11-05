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

/** The text a person must type before "삭제 확인" is enabled. A pointer alone can never produce it, so repeated clicks cannot delete. */
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
      ? "이 버전의 SKILL.md는 UTF-8 텍스트가 아니어서 여기서 편집할 수 없습니다. 이전 버전은 내보낼 수 있습니다."
      : "이 버전에는 SKILL.md가 없어 여기서 편집할 수 없습니다.";
  }
  return describeFailure(error, "현재 버전 불러오기");
}

function NoteLine({ note }: { readonly note: Note }) {
  return [
    h("span", { key: "text", class: "note", role: "status", "aria-live": "polite" }, note.text),
    note.technical !== null && h("details", { key: "technical", class: "technical" }, h("summary", null, "기술 정보"), h("code", null, note.technical)),
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
      setNotes([`현재 버전은 리비전 ${target.revision}입니다. 수정 내용은 유지했습니다. 게시하면 이 버전 뒤에 새 버전을 만듭니다.`]);
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
      if (classifyFailure(error) === "gone") setDetailState({ status: "gone", message: describeFailure(error, "스킬 열기") });
      else setDetailState(current => ({ status: "failed", detail: current.status === "gone" ? null : current.detail, message: describeFailure(error, "스킬 열기") }));
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
    setVersionsNote({ text: `${action} 중\u2026`, technical: null });
    try {
      const next = await task();
      setDetailState({ status: "ready", detail: next });
      adoptHead(next, false);
      setVersionsNote({ text: `${action} 작업을 마쳤습니다. 현재 리비전은 ${next.skill.head.revision}입니다.`, technical: null });
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
    setPublishNote({ text: "현재 버전 읽는 중\u2026", technical: null });
    try {
      const next = await readSkill(skillId, signal);
      setDetailState({ status: "ready", detail: next });
      setConflict(false);
      adoptHead(next, true);
      setPublishNote({ text: `확인했습니다. 현재 버전은 리비전 ${next.skill.head.revision}입니다. 다시 게시하면 수정 내용을 다음 버전으로 저장합니다.`, technical: null });
    } catch (error) {
      if (isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      gone(error, "스킬 확인");
      setPublishNote(failureNote(error, "스킬 확인"));
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
    setPublishNote({ text: "게시 중\u2026", technical: null });
    try {
      const next = await publishVersion(skillId, draft.base, built.package, signal);
      afterPublish(next, draft, built.package);
      setPublishNote({ text: `리비전 ${next.skill.head.revision}을 게시했습니다.`, technical: null });
      onChanged();
    } catch (error) {
      if (isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      if (classifyFailure(error) === "conflict") setConflict(true);
      gone(error, "게시");
      setPublishNote(failureNote(error, "게시"));
    } finally {
      setBusy(false);
    }
  };

  const exportVersion = async (digest: PrivateSkillDigest) => {
    setBusy(true);
    setVersionsNote({ text: "내보내기 준비 중\u2026", technical: null });
    try {
      const exported = await readExport(skillId, digest, signal);
      const fileName = exportFileName(name, digest);
      downloadTextFile(fileName, JSON.stringify(exported, null, 2));
      setVersionsNote({ text: `내보낼 파일을 준비했습니다: ${fileName}.`, technical: null });
    } catch (error) {
      if (isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setVersionsNote(failureNote(error, "내보내기"));
    } finally {
      setBusy(false);
    }
  };

  const removeSkill = async () => {
    if (head === null) return;
    setBusy(true);
    setDeleteNote({ text: "스킬 삭제 중\u2026", technical: null });
    try {
      await deleteSkill(skillId, head, signal);
      onDeleted(name);
    } catch (error) {
      if (isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      gone(error, "스킬 삭제");
      setDeleteNote(failureNote(error, "스킬 삭제"));
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
        h("span", null, target.kind === "skill" ? "삭제하려면 스킬 이름을 정확히 입력하세요: " : "삭제하려면 이 버전의 digest 앞 8자를 입력하세요: ",
          h("code", { class: "version__digest" }, confirmationText(target))),
        h("input", { id, ref: confirmField, class: "text-field", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: false,
          value: typed, disabled: busy, "aria-describedby": `${id}-consequence`,
          onInput: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => setTyped(event.currentTarget.value) })),
      h("div", { class: "cluster" },
        h("button", { class: "button secondary", type: "button", disabled: busy, onClick: () => setPending(null) }, keepLabel),
        h("button", { class: "button danger", type: "button", disabled: !armed, onClick: () => { if (armed) void onConfirm(); } }, "삭제 확인")));
  };

  const title = name === "" ? "스킬" : `스킬: ${name}`;
  const panelHead = h("div", { class: "panel__head" },
    h("h2", { id: "skill-title", ref: heading, tabIndex: -1 }, title),
    h("button", { class: "button secondary", type: "button", onClick: onBack }, "보관함으로 돌아가기"));

  if (detailState.status === "gone") {
    return h("section", { class: "panel skill", "aria-labelledby": "skill-title" },
      panelHead,
      h("p", { class: "note", role: "status", "aria-live": "polite" }, detailState.message),
      draftState.status === "ready" && h("p", null, "저장하지 않은 수정 내용을 복사할 수 있도록 아래에 남겨 두었습니다. 이 스킬에는 더 이상 게시할 수 없습니다."),
      draftState.status === "ready" && h("textarea", { class: "document-field", rows: 12, readOnly: true, "aria-label": "SKILL.md 수정 내용", value: draftState.draft.document }));
  }

  const versionRow = (version: Version) => {
    const current = head !== null && version.digest === head.digest;
    const protectedReason = current ? "현재 버전입니다. 삭제하려면 먼저 다른 버전을 현재 버전으로 선택하세요."
      : version.pinned ? "고정한 버전입니다. 삭제하려면 먼저 고정을 해제하세요." : null;
    const confirming = pending?.kind === "version" && pending.digest === version.digest;
    const rowId = `version-${version.digest.slice(0, 16)}`;
    return h("li", { key: version.digest, class: "version", "aria-labelledby": rowId, "data-current": current ? "true" : undefined },
      h("div", { class: "version__meta" },
        h("p", { id: rowId, class: "version__flags" },
          current && h("strong", null, "현재 버전"),
          current && version.pinned && " \u00b7 ",
          version.pinned && h("strong", null, "고정됨"),
          !current && !version.pinned && h("span", { class: "note" }, "이전 버전")),
        h("p", { class: "note" }, "생성 ", when(version.createdAt)),
        h("code", { class: "version__digest" }, version.digest)),
      h("div", { class: "cluster version__actions" },
        !current && head !== null && h("button", { class: "button secondary", type: "button", disabled: busy,
          onClick: () => run("현재 버전 변경", () => setHead(skillId, head, version.digest, signal)) }, "현재 버전으로 선택"),
        head !== null && h("button", { class: "button secondary", type: "button", disabled: busy, "aria-pressed": version.pinned,
          onClick: () => run(version.pinned ? "버전 고정 해제" : "버전 고정", () => setPinned(skillId, head, version.digest, !version.pinned, signal)) },
          version.pinned ? "고정 해제" : "고정"),
        h("button", { class: "button secondary", type: "button", disabled: busy, onClick: () => exportVersion(version.digest) }, "JSON 내보내기"),
        protectedReason === null && head !== null && (confirming
          ? confirmation({ kind: "version", digest: version.digest }, "내 계정에서 이 버전의 파일을 삭제합니다. 되돌릴 수 없습니다.", "버전 유지",
            () => run("버전 삭제", () => deleteVersion(skillId, head, version.digest, signal)))
          : h("button", { id: triggerId({ kind: "version", digest: version.digest }), class: "button secondary danger-quiet", type: "button", disabled: busy,
            onClick: () => openConfirmation({ kind: "version", digest: version.digest }) }, "버전 삭제\u2026")),
        protectedReason !== null && h("span", { class: "note version__protected" }, protectedReason)));
  };

  return h("section", { class: "panel skill", "aria-labelledby": "skill-title" },
    panelHead,
    (detail?.skill.description ?? summary?.description) !== undefined && h("p", { class: "account-lead" }, detail?.skill.description ?? summary?.description),
    h("p", { class: "note skill__status", role: "status", "aria-live": "polite" },
      detailState.status === "loading" ? "스킬 불러오는 중\u2026" : detailState.status === "failed" ? detailState.message : ""),
    detail !== null && h("dl", { class: "account-status skill__facts" },
      h("div", null, h("dt", null, "현재 리비전"), h("dd", null, String(detail.skill.head.revision))),
      h("div", null, h("dt", null, "보관 버전 수"), h("dd", null, String(detail.versions.length))),
      h("div", { class: "skill__digest" }, h("dt", null, "현재 digest"), h("dd", null, h("code", null, detail.skill.head.digest))),
      h("div", null, h("dt", null, "스킬 ID"), h("dd", null, h("code", null, detail.skill.skillId))),
      h("div", null, h("dt", null, "마지막 변경"), h("dd", null, when(detail.skill.updatedAt)))),
    detail !== null && h("div", { class: "skill__layout" },
      h("div", { class: "skill__support" },
        h("section", { class: "skill__section", "aria-labelledby": "versions-title" },
          h("h3", { id: "versions-title", class: "panel__subtitle", tabIndex: -1 }, "버전"),
          h("p", { class: "note" }, "‘현재 버전으로 선택’을 누르면 에이전트가 받을 버전을 해당 버전으로 바꿉니다. 고정한 버전은 삭제할 수 없습니다. 각 버전은 JSON으로 내보낼 수 있습니다."),
          h("div", { class: "cluster versions__note" }, h(NoteLine, { note: versionsNote })),
          h("ul", { class: "version-list" }, detail.versions.map(versionRow))),
        h("section", { class: "skill__section skill__evidence", "aria-labelledby": "evidence-title" },
          h("h3", { id: "evidence-title", class: "panel__subtitle" }, "읽기 기록과 평가"),
          h("dl", { class: "account-status" },
            h("div", null, h("dt", null, "버전별 읽기 기록"), h("dd", null, "이 화면에 연결되지 않음")),
            h("div", null, h("dt", null, "평가 결과"), h("dd", null, "이 화면에 연결되지 않음"))),
          h("p", { class: "note" }, "게시 기록은 읽기 기록이 아니며, 읽었다고 작업 성공이 입증되지는 않습니다. 이 화면에는 버전별 읽기·평가 결과가 연결되어 있지 않습니다."),
          h("a", { class: "button secondary", href: "/dashboard/" }, "대시보드 열기"))),
      h("div", { class: "skill__document" },
        h("section", { class: "skill__section", "aria-labelledby": "resources-title" },
          h("h3", { id: "resources-title", class: "panel__subtitle" }, "현재 버전의 파일"),
          draftState.status === "ready"
            ? h("dl", { class: "account-status resource-list" }, draftState.resources.map(resource =>
              h("div", { key: resource.path }, h("dt", null, h("code", null, resource.path)), h("dd", null, `${formatBytes(resource.bytes)} \u00b7 ${resource.mediaType}`))))
            : h("p", { class: "note", role: "status" }, draftState.status === "loading" ? "현재 버전 불러오는 중\u2026" : draftState.message)),
        draftState.status === "ready" && h("form", { class: "skill__section publish", onSubmit: publish, "aria-labelledby": "edit-title" },
          h("h3", { id: "edit-title", class: "panel__subtitle" }, "새 버전 편집·게시"),
          h("p", { class: "note" }, `게시하기 전까지 수정 내용은 이 화면에만 있습니다. 게시하면 리비전 ${draftState.draft.base?.revision ?? detail.skill.head.revision}을 기준으로 리비전 ${detail.skill.head.revision + 1}을 만들며, 이전 버전은 보관합니다.`),
          h(DraftEditor, { draft: draftState.draft, idPrefix: "edit-skill", busy, notes,
            onChange: (next, newNotes) => {
              setDraftState({ ...draftState, draft: next });
              if (newNotes.length > 0) setNotes(newNotes);
            } }),
          problems.length > 0 && h("ul", { class: "problems", role: "alert" }, problems.map(problem => h("li", { key: problem }, problem))),
          h("div", { class: "cluster publish__actions" },
            h("button", { class: "button primary", type: "submit", disabled: busy }, "새 버전 게시"),
            conflict && h("button", { class: "button secondary", type: "button", disabled: busy, onClick: review }, "현재 버전 확인"),
            isDirty(draftState) && head !== null && h("button", { class: "button secondary", type: "button", disabled: busy,
              onClick: () => loadDraft(head) }, "수정 내용 버리고 현재 버전 불러오기"),
            h(NoteLine, { note: publishNote }))),
        h("section", { class: "skill__section skill__danger", "aria-labelledby": "delete-title" },
          h("h3", { id: "delete-title", class: "panel__subtitle" }, "스킬 삭제"),
          h("p", { class: "note" }, "내 계정에서 이 스킬의 모든 버전을 삭제합니다. 보관할 내용은 먼저 내보내세요."),
          h("div", { class: "cluster" }, pending?.kind === "skill"
            ? confirmation({ kind: "skill", name }, `버전 ${detail.versions.length}개를 모두 삭제합니다. 되돌릴 수 없습니다.`,
              "스킬 유지", removeSkill)
            : h("button", { id: triggerId({ kind: "skill" }), class: "button secondary danger-quiet", type: "button", disabled: busy, onClick: () => openConfirmation({ kind: "skill" }) },
              "스킬 삭제\u2026"),
            h(NoteLine, { note: deleteNote }))))));
}
