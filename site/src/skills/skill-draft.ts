import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { PrivateSkillDetail, PrivateSkillHead, PrivateSkillPackage } from "../../../shared/dist/private-skills.js";
import { isUnauthorized, readExport } from "./api.ts";
import { useDraftGuard } from "./editor.ts";
import { draftFromExport } from "./model.ts";
import type { Draft } from "./model.ts";
import type { DraftState, SkillProps } from "./skill-state.ts";
import { isAbort, isDirty, describeDraftFailure } from "./skill-notes.ts";
export function useSkillDraft({ skillId, signal, onUnauthorized, onDirtyChange }: SkillProps) {
  const [draftState, setDraftState] = useState<DraftState>({ status: "loading" });
  const [notes, setNotes] = useState<readonly string[]>([]);
  const draftRef = useRef<DraftState>(draftState);
  draftRef.current = draftState;
  const dirty = isDirty(draftState);
  useDraftGuard(dirty);
  useLayoutEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

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

  const afterPublish = (next: PrivateSkillDetail, draft: Draft, pkg: PrivateSkillPackage) => {
    const settled: Draft = { ...draft, base: next.skill.head, acknowledged: false };
    setDraftState({ status: "ready", draft: settled, baseline: settled, resources: pkg.manifest.resources });
    setNotes([]);
  };

  return { draftState, setDraftState, notes, setNotes, dirty, loadDraft, adoptHead, afterPublish };
}
