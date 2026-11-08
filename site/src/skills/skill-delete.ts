import { h } from "preact";
import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Pending, DeleteTarget } from "./skill-state.ts";
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
export function triggerId(pending: Pending): string {
  return pending.kind === "skill" ? "skill-delete" : `version-delete-${pending.digest.slice(0, 16)}`;
}


export function useSkillConfirmation(busy: boolean) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");
  const confirmField = useRef<HTMLInputElement | null>(null);
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
        h("span", null, target.kind === "skill" ? "삭제하려면 스킬 이름을 정확히 입력하세요: " : "삭제하려면 이 버전의 식별자 앞 8자를 입력하세요: ",
          h("code", { class: "version__digest" }, confirmationText(target))),
        h("input", { id, ref: confirmField, class: "text-field", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: false,
          value: typed, disabled: busy, "aria-describedby": `${id}-consequence`,
          onInput: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => setTyped(event.currentTarget.value) })),
      h("div", { class: "cluster" },
        h("button", { class: "button secondary", type: "button", disabled: busy, onClick: () => setPending(null) }, keepLabel),
        h("button", { class: "button danger", type: "button", disabled: !armed, onClick: () => { if (armed) void onConfirm(); } }, "삭제 확인")));
  };

  return { pending, setPending, openConfirmation, confirmation };
}
