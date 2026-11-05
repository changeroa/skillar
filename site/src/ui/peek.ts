import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export function peekUrl(href: string, parameter: string, selectedId: string | null): string {
  const url = new URL(href);
  if (selectedId === null) url.searchParams.delete(parameter);
  else url.searchParams.set(parameter, selectedId);
  return url.href;
}

/** Pair with PeekPanel; restores a selected record on reload and Back/Forward. */
export function usePeekSelection(parameter = "selected"): readonly [string | null, (id: string | null) => void] {
  const [selected, setSelected] = useState(() => new URL(window.location.href).searchParams.get(parameter));
  useEffect(() => {
    const restore = () => setSelected(new URL(window.location.href).searchParams.get(parameter));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [parameter]);
  const select = (id: string | null) => {
    const next = peekUrl(window.location.href, parameter, id);
    if (next !== window.location.href) window.history.pushState(null, "", next);
    setSelected(id);
  };
  return [selected, select];
}

export function PeekPanel({ id, selectedId, title, fullPageHref, returnFocus, onClose, children }: {
  readonly id: string;
  readonly selectedId: string | null;
  readonly title: string;
  readonly fullPageHref?: string;
  readonly returnFocus: HTMLElement | null;
  readonly onClose: () => void;
  readonly children: ComponentChildren;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const dismiss = useRef(onClose);
  dismiss.current = onClose;
  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!panel || selectedId === null) return;
    const mobile = window.matchMedia("(max-width: 1023px)");
    const show = () => {
      panel.close();
      if (mobile.matches) panel.showModal();
      else panel.show();
      close.current?.focus();
    };
    show();
    mobile.addEventListener("change", show);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !mobile.matches &&
          (panel.contains(document.activeElement) || document.activeElement === returnFocus)) {
        event.preventDefault();
        dismiss.current();
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      mobile.removeEventListener("change", show);
      window.removeEventListener("keydown", escape);
      panel.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [selectedId, returnFocus]);
  return h("dialog", { id, ref: dialog, class: "ui-peek", "aria-labelledby": `${id}-title`,
    onCancel: event => { event.preventDefault(); onClose(); } },
    h("header", null, h("h2", { id: `${id}-title` }, title),
      fullPageHref && h("a", { class: "button secondary", href: fullPageHref }, "전체 페이지로 열기"),
      h("button", { ref: close, type: "button", class: "button secondary", onClick: onClose }, "닫기")),
    h("div", { class: "ui-peek-body" }, children));
}
