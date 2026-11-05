import { h } from "preact";
import { useLayoutEffect } from "preact/hooks";

/** T1 may supply the shared title slot. Older shells keep their introduction but not a duplicate h1. */
export function SkillsHeading({ name }: { readonly name: string }) {
  const slot = document.querySelector<HTMLElement>("[data-page-title]");
  useLayoutEffect(() => {
    if (slot !== null) {
      const previous = slot.textContent;
      slot.textContent = name;
      return () => { slot.textContent = previous; };
    }
    const previous = document.querySelector(".dashboard-heading h1");
    const parent = previous?.parentNode;
    if (previous === null || parent === null || parent === undefined) return;
    const next = previous.nextSibling;
    parent.removeChild(previous);
    return () => { parent.insertBefore(previous, next); };
  }, [name, slot]);
  return slot === null ? h("h1", { class: "skills-heading" }, name) : null;
}
