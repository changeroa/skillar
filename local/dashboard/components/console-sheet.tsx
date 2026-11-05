import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { Icon } from "./icons";

export function ConsoleSheet({ id, title, close, children, actions }: {
  readonly id: string; readonly title: string; readonly close: () => void;
  readonly children: ComponentChildren; readonly actions?: ComponentChildren;
}) {
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const origin = document.activeElement;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => { if (origin instanceof HTMLElement && origin.isConnected) origin.focus({ preventScroll: true }); };
  }, []);
  return <div class="pe-sheet-overlay">
    <section id={id} class="pe-sheet" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} ref={panel}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key !== "Tab") return;
        const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),summary,[tabindex='0']"))
          .filter(node => node.checkVisibility());
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header class="pe-sheet__head"><h2 id={`${id}-title`}>{title}</h2>
        <button class="pe-button" aria-label={`${title} 닫기`} onClick={close}><Icon name="close" />닫기</button>
      </header>
      <div class="pe-sheet__body">{children}</div>
      {actions && <footer class="pe-sheet__actions">{actions}</footer>}
    </section>
  </div>;
}
