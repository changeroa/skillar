import { h } from "preact";
import type { ComponentChildren, JSX } from "preact";
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

export function PeekPanel({ id, selectedId, title, fullPageHref, returnFocus, onClose, children, actions, onFullPage, closeDisabled = false }: {
  readonly id: string;
  readonly selectedId: string | null;
  readonly title: string;
  readonly fullPageHref?: string;
  readonly returnFocus: HTMLElement | null;
  readonly onClose: () => void;
  readonly children: ComponentChildren;
  readonly actions?: ComponentChildren;
  readonly onFullPage?: () => void;
  readonly closeDisabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const dismiss = useRef(onClose);
  dismiss.current = () => { if (!closeDisabled) onClose(); };
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
      if (event.key === "Escape" && !event.defaultPrevented && !mobile.matches &&
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
    onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLDialogElement>) => {
      const panel = event.currentTarget;
      if (event.defaultPrevented || event.key !== "Tab" || !panel.matches(":modal")) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(
        "button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex='0']",
      )).filter(node => node.tabIndex >= 0 && node.checkVisibility() && !node.closest("[inert]"));
      const first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    },
    onCancel: event => { event.preventDefault(); if (!closeDisabled) onClose(); } },
    h("header", null, h("h2", { id: `${id}-title` }, title),
      fullPageHref && h("a", { class: "button secondary", href: fullPageHref, onClick: onFullPage
        ? (event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => { event.preventDefault(); onFullPage(); } : undefined }, "전체 페이지로 열기"),
      actions,
      h("button", { ref: close, type: "button", class: "button secondary", disabled: closeDisabled, onClick: onClose }, "닫기")),
    h("div", { class: "ui-peek-body" }, children));
}
