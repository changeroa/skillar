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
  readonly placement?: "center" | "side" | "bottom";
  readonly size?: "default" | "comparison" | "confirm" | "command" | "navigation";
  readonly side?: "left" | "right";
  readonly subtitle?: string;
};

/** Native top-layer modality; ownership of drafts and async work stays with callers. */
export function Dialog({ id, open, title, onClose, children, actions, description,
  initialFocusId, kind = "dialog", placement = "center", size = "default", subtitle, side = "right" }: DialogProps) {
  const panel = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node || !open) return;
    const origin = document.activeElement;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    node.showModal();
    const initial = initialFocusId ? document.getElementById(initialFocusId) : null;
    if (initial && node.contains(initial) && !initial.matches(":disabled")) initial.focus({ preventScroll: true });
    else node.querySelector<HTMLElement>("[data-dialog-start]")?.focus({ preventScroll: true });
    return () => {
      node.close();
      document.documentElement.style.overflow = overflow;
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus({ preventScroll: true });
    };
  }, [open, initialFocusId]);
  return <dialog ref={panel} id={id} class={`lf-dialog lf-dialog--${placement} lf-dialog--${size}${placement === "side" && side === "left" ? " lf-dialog--left" : ""}`}
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
      )).filter(node => node.tabIndex >= 0 && node.checkVisibility() && !node.closest("[inert]"));
      const first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onClick={event => event.stopPropagation()}>
    <header class="lf-dialog__head">
      <div class="lf-dialog__head-content">
      <div class="lf-dialog__heading"><h2 id={`${id}-title`} tabIndex={-1} data-dialog-start>{title}</h2>
        {subtitle && <p>{subtitle}</p>}</div>
      <button type="button" class="lf-overlay-close" aria-label="닫기" onClick={onClose}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
      </div>
    </header>
    <div class="lf-dialog__body">
      {description && <p id={`${id}-description`}>{description}</p>}
      {children}
    </div>
    {actions && <footer class="lf-dialog__actions">{actions}</footer>}
  </dialog>;
}

export function ConfirmDialog({ id, open, title, description, confirmLabel, cancelLabel = "취소", onConfirm,
  onClose, busy = false, error, confirmDisabled = false, children }: {
  readonly id: string; readonly open: boolean; readonly title: string; readonly description: string;
  readonly confirmLabel: string; readonly onConfirm: () => void; readonly onClose: () => void;
  readonly cancelLabel?: string; readonly children?: ComponentChildren;
  readonly busy?: boolean; readonly error?: string | undefined;
  readonly confirmDisabled?: boolean;
}) {
  const dismiss = () => { if (!busy) onClose(); };
  return <Dialog id={id} open={open} title={title} description={description} kind="alertdialog" size="confirm"
    initialFocusId={`${id}-cancel`} onClose={dismiss} actions={<>
      <Button id={`${id}-cancel`} text={cancelLabel} variant="outline" disabled={busy} onClick={dismiss} />
      <Button text={confirmLabel} variant="destructive" disabled={confirmDisabled} loading={busy} onClick={onConfirm} />
    </>}>
    {error && <div role="alert" class="lf-confirm-error"><h5>오류:</h5><div>{error}</div></div>}
    {children}
  </Dialog>;
}

export function Sheet({ side = "right", ...props }: Omit<DialogProps, "placement" | "kind" | "side"> & {
  readonly side?: "right" | "bottom" | "left";
}) {
  return <Dialog {...props} placement={side === "bottom" ? "bottom" : "side"} side={side === "left" ? "left" : "right"} />;
}
