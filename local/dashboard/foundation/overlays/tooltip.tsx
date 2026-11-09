import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

/** Put one named, focusable control inside; the tooltip never adds a Tab stop. */
export function Tooltip({ id, content, children, size = "bounded" }: {
  readonly id: string; readonly content: string; readonly children: ComponentChildren;
  readonly size?: "bounded" | "content";
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const active = useRef({ hover: false, focus: false });
  useLayoutEffect(() => {
    const trigger = root.current?.querySelector<HTMLElement>("button,a[href],input,[tabindex]");
    if (!trigger) return;
    const previous = trigger.getAttribute("aria-describedby");
    const nativeTitle = trigger.getAttribute("title");
    trigger.removeAttribute("title");
    trigger.setAttribute("aria-describedby", [previous, id].filter(Boolean).join(" "));
    return () => {
      if (previous === null) trigger.removeAttribute("aria-describedby");
      else trigger.setAttribute("aria-describedby", previous);
      if (nativeTitle !== null) trigger.setAttribute("title", nativeTitle);
    };
  }, [id, children]);
  useLayoutEffect(() => {
    const node = tip.current, anchor = root.current;
    if (!node || !anchor || !open || dismissed) return;
    node.showPopover();
    const update = () => {
      const rect = anchor.getBoundingClientRect(), box = node.getBoundingClientRect();
      node.style.left = `${Math.round(Math.max(8, Math.min(rect.left + (rect.width - box.width) / 2, innerWidth - box.width - 8)) * devicePixelRatio) / devicePixelRatio}px`;
      node.style.top = `${Math.round(Math.max(8, rect.top > box.height + 4 ? rect.top - box.height - 4 : rect.bottom + 4) * devicePixelRatio) / devicePixelRatio}px`;
    };
    update();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); setDismissed(true);
    };
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      node.hidePopover();
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, dismissed]);
  const leave = () => {
    if (!active.current.hover && !active.current.focus) { setOpen(false); setDismissed(false); }
  };
  return <span ref={root} class="lf-tooltip-anchor"
    onPointerEnter={() => { active.current.hover = true; setOpen(true); }}
    onPointerLeave={() => { active.current.hover = false; leave(); }}
    onFocusIn={() => { active.current.focus = true; setOpen(true); }}
    onFocusOut={() => { active.current.focus = false; leave(); }}>
    {children}
    <span id={id} ref={tip} popover="manual" role="tooltip" class="lf-tooltip" data-size={size}>{content}</span>
  </span>;
}
