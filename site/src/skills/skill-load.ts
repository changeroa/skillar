import { useEffect, useState } from "preact/hooks";
import type { PrivateSkillHead } from "../../../shared/dist/private-skills.js";
import { classifyFailure, describeFailure, isUnauthorized, readSkill } from "./api.ts";
import { isAbort } from "./skill-notes.ts";
import type { DetailState, SkillProps } from "./skill-state.ts";

type LoadActions = {
  readonly reset: () => void;
  readonly loadDraft: (head: PrivateSkillHead) => Promise<void>;
};

export function useSkillLoad({ skillId, signal, onUnauthorized }: SkillProps, actions: LoadActions) {
  const [detailState, setDetailState] = useState<DetailState>({ status: "loading", detail: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setDetailState(current => ({ status: "loading", detail: current.status === "gone" ? null : current.detail }));
    actions.reset();
    readSkill(skillId, signal).then(next => {
      if (!active) return;
      setDetailState({ status: "ready", detail: next });
      void actions.loadDraft(next.skill.head);
    }, (error: unknown) => {
      if (!active || isAbort(error)) return;
      if (isUnauthorized(error)) { onUnauthorized(); return; }
      if (classifyFailure(error) === "gone") setDetailState({ status: "gone", message: describeFailure(error, "스킬 열기") });
      else setDetailState(current => ({ status: "failed", detail: current.status === "gone" ? null : current.detail,
        message: describeFailure(error, "스킬 열기") }));
    });
    return () => { active = false; };
  }, [skillId, signal, retry]);
  return { detailState, setDetailState, setRetry };
}
