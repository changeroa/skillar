import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { Button } from "../controls/buttons";

export type DialogProps = {
  readonly id: string;
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ComponentChildren;
  readonly actions?: ComponentChildren;
  readonly description?: string;
  readonly initialFocusId?: string;
  readonly kind?: "dialog" | "alertdialog";
  readonly placement?: "center" | "side";
};

/** Native top-layer modality; ownership of drafts and async work stays with callers. */
export function Dialog({ id, open, title, onClose, children, actions, description,
  initialFocusId, kind = "dialog", placement = "center" }: DialogProps) {
  const panel = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node || !open) return;
    const origin = document.activeElement;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    node.showModal();
    const initial = initialFocusId ? document.getElementById(initialFocusId) : null;
    if (initial && node.contains(initial)) initial.focus({ preventScroll: true });
    else node.querySelector<HTMLElement>("[data-dialog-start]")?.focus({ preventScroll: true });
    return () => {
      node.close();
      document.documentElement.style.overflow = overflow;
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus({ preventScroll: true });
    };
  }, [open, initialFocusId]);
  return <dialog ref={panel} id={id} class={`lf-dialog lf-dialog--${placement}`}
    role={kind} aria-modal="true" aria-labelledby={`${id}-title`}
    aria-describedby={description ? `${id}-description` : undefined} tabIndex={-1}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); onClose(); return;
      }
      if (event.key !== "Tab") return;
      const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        "button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex='0']",
      )).filter(node => node.checkVisibility() && !node.closest("[inert]"));
      const first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onClick={event => event.stopPropagation()}>
    <header class="lf-dialog__head">
      <h2 id={`${id}-title`} tabIndex={-1} data-dialog-start>{title}</h2>
      <button type="button" class="lf-overlay-close" aria-label="닫기" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </header>
    <div class="lf-dialog__body">
      {description && <p id={`${id}-description`}>{description}</p>}
      {children}
    </div>
    {actions && <footer class="lf-dialog__actions">{actions}</footer>}
  </dialog>;
}

export function ConfirmDialog({ id, open, title, description, confirmLabel, onConfirm,
  onClose, busy = false, error }: {
  readonly id: string; readonly open: boolean; readonly title: string; readonly description: string;
  readonly confirmLabel: string; readonly onConfirm: () => void; readonly onClose: () => void;
  readonly busy?: boolean; readonly error?: string | undefined;
}) {
  return <Dialog id={id} open={open} title={title} description={description} kind="alertdialog"
    initialFocusId={`${id}-cancel`} onClose={onClose} actions={<>
      <Button id={`${id}-cancel`} text="취소" variant="outline" onClick={onClose} />
      <Button text={confirmLabel} variant="destructive" loading={busy} onClick={onConfirm} />
    </>}>
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}

export function Sheet(props: Omit<DialogProps, "placement" | "kind">) {
  return <Dialog {...props} placement="side" />;
}
