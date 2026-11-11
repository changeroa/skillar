import type { JSX } from "preact";
import { useState } from "preact/hooks";

/** Chronological leaves have no fabricated parents; the timeline has one cell per row. */
export function useEventRoving(keys: readonly string[], selected?: string) {
  const [focused, setFocused] = useState<string>();
  const active = keys.find(key => key === focused) ?? keys.find(key => key === selected) ?? keys[0];
  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLOListElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches("[data-event-kind]")) return;
    const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-event-kind]"));
    const index = nodes.indexOf(event.target);
    const grid = event.currentTarget.getAttribute("role") === "grid";
    let next: number;
    switch (event.key) {
      case "ArrowDown": next = Math.min(nodes.length - 1, index + 1); break;
      case "ArrowUp": next = Math.max(0, index - 1); break;
      case "Home": next = grid && !event.ctrlKey ? index : 0; break;
      case "End": next = grid && !event.ctrlKey ? index : nodes.length - 1; break;
      case "ArrowLeft":
      case "ArrowRight": event.preventDefault(); return;
      case " ": {
        if (event.target instanceof HTMLAnchorElement) {
          event.preventDefault(); event.target.click();
        }
        return;
      }
      default: {
        if (grid || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        const query = event.key.toLocaleLowerCase("ko-KR");
        const match = [...nodes.slice(index + 1), ...nodes.slice(0, index + 1)]
          .find(node => node.textContent?.trim().toLocaleLowerCase("ko-KR").startsWith(query));
        if (match) { event.preventDefault(); match.focus(); }
        return;
      }
    }
    event.preventDefault();
    nodes[next]?.focus();
  };
  return { active, onFocus: setFocused, onKeyDown };
}
