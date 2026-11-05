import { h } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { PrivateSkillDetail, PrivateSkillDigest } from "../../../shared/dist/private-skills.js";
import { downloadTextFile } from "../dashboard/grant.ts";
import { classifyFailure, deleteSkill, describeFailure, isUnauthorized, readExport, readSkill } from "./api.ts";
import { exportFileName } from "./model.ts";
import { publishDraft } from "./skill-publish.ts";
import type { Note, SkillProps } from "./skill-state.ts";
import { isAbort, failureNote } from "./skill-notes.ts";
import { useSkillDraft } from "./skill-draft.ts";
import { useSkillLoad } from "./skill-load.ts";
import { useSkillConfirmation } from "./skill-delete.ts";
import { SkillView } from "./skill-render.ts";
export { confirmationText, confirmsDeletion } from "./skill-delete.ts";
export type { SkillProps, DeleteTarget } from "./skill-state.ts";
const silent: Note = { text: "", technical: null };
export function useSkillController(props: SkillProps) {
  const { skillId, summary, signal, focusHeading, onChanged, onDeleted, onBack, onUnauthorized } = props;
  const { draftState, setDraftState, notes, setNotes, dirty, loadDraft, adoptHead, afterPublish } = useSkillDraft(props);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [publishNote, setPublishNote] = useState<Note>(silent);
  const [versionsNote, setVersionsNote] = useState<Note>(silent);
  const [deleteNote, setDeleteNote] = useState<Note>(silent);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const { pending, setPending, openConfirmation, confirmation } = useSkillConfirmation(busy);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const { detailState, setDetailState, setRetry } = useSkillLoad(props, {
    loadDraft, reset: () => {
      setDraftState({ status: "loading" }); setNotes([]); setProblems([]);
      setPublishNote(silent); setVersionsNote(silent); setDeleteNote(silent);
      setConflict(false); setPending(null);
    },
  });
  const detail = detailState.status === "gone" ? null : detailState.detail;
  const name = detail?.skill.name ?? summary?.name ?? "";
  const head = detail?.skill.head ?? null;

  const gone = (error: unknown, action: string) => {
    if (classifyFailure(error) === "gone") setDetailState({ status: "gone", message: describeFailure(error, action) });
  };

  useLayoutEffect(() => {
    if (focusHeading > 0) heading.current?.focus();
  }, [focusHeading]);

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

  const publish = async (event: Event) => {
    event.preventDefault();
    if (submitting.current || busy || draftState.status !== "ready" || head === null) return;
    submitting.current = true;
    setBusy(true);
    const draft = draftState.draft;
    try {
      setPublishNote({ text: "게시 중\u2026", technical: null });
      const built = await publishDraft(draft, signal);
      if (!built.ok) {
        setProblems(built.problems);
        setPublishNote(silent);
        return;
      }
      setProblems([]);
      const next = built.detail;
      setDetailState({ status: "ready", detail: next });
      setConflict(false);
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
      submitting.current = false;
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

  return { detailState, draftState, detail, name, head, heading, busy, dirty, pending, notes, problems, conflict, publishNote, versionsNote, deleteNote, setRetry, setDraftState, setNotes, loadDraft, run, review, publish, exportVersion, removeSkill, openConfirmation, confirmation, onBack, skillId, signal, onUnauthorized, summary };
}

export function SkillPanel(props: SkillProps) {
  return h(SkillView, useSkillController(props));
}
