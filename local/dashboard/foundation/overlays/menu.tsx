import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Fragment, type JSX } from "preact";
import { Button, IconButton, type ButtonProps } from "../controls/buttons";
import { Glyph, type ControlIcon } from "../controls/icons";

export type MenuItem = {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
  readonly checked?: boolean;
  readonly separatorBefore?: boolean;
  readonly icon?: ControlIcon;
  readonly onSelect: () => void;
};

export function DropdownMenu({ id, label, items, disabled = false, icon, heading, checkPosition = "end",
  width = "content", align = "start", variant = "outline", buttonIcon }: {
  readonly id: string; readonly label: string; readonly items: readonly MenuItem[]; readonly disabled?: boolean;
  readonly icon?: ControlIcon; readonly width?: "content" | "wide"; readonly align?: "start" | "end";
  readonly variant?: ButtonProps["variant"]; readonly buttonIcon?: ControlIcon;
  readonly heading?: string; readonly checkPosition?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const lastOnOpen = useRef(false);
  const search = useRef({ text: "", at: 0 });
  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) root.current?.querySelector("button")?.focus();
  };
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const node = menu.current;
    if (!node) return;
    node.showPopover();
    const enabled = Array.from(node.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    (lastOnOpen.current ? enabled.at(-1) : enabled[0])?.focus();
    if (!enabled.length) node.focus();
    const origin = root.current?.querySelector("button");
    const update = () => {
      if (!origin) return;
      const rect = origin.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const left = align === "end" ? rect.right - box.width : rect.left;
      node.style.left = `${Math.round(Math.max(8, Math.min(left, innerWidth - box.width - 8)) * devicePixelRatio) / devicePixelRatio}px`;
      node.style.top = `${Math.round(Math.max(8, rect.bottom + box.height + 4 <= innerHeight ? rect.bottom + 4 : rect.top - box.height - 4) * devicePixelRatio) / devicePixelRatio}px`;
    };
    update();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !node.contains(event.target) && !root.current?.contains(event.target)) dismiss(false);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      node.hidePopover();
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, disabled, align]);
  const trigger = {
    id: `${id}-trigger`, disabled, "aria-haspopup": "menu", "aria-expanded": open && !disabled, "aria-controls": id,
    onClick: () => { lastOnOpen.current = false; search.current.text = ""; setOpen(value => !value); },
    onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        lastOnOpen.current = event.key === "ArrowUp"; search.current.text = ""; setOpen(true);
    },
  } satisfies JSX.ButtonHTMLAttributes<HTMLButtonElement>;
  return <span class="lf-menu-anchor" ref={root}>
    {icon ? <IconButton {...trigger} label={label} icon={icon} /> : <Button {...trigger} text={label} variant={variant} {...(buttonIcon ? { icon: buttonIcon } : {})} />}
    {open && !disabled && <div id={id} ref={menu} popover="manual" role="menu" tabIndex={-1}
      aria-labelledby={`${id}-trigger`} class="lf-menu" data-width={items.length ? width : "content"}
      onKeyDown={event => {
        const enabled = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
        const index = enabled.findIndex(node => node === document.activeElement);
        switch (event.key) {
          case "Escape": event.preventDefault(); event.stopPropagation(); dismiss(true); return;
          case "Tab":
            // Restore before the browser computes sequential navigation, without trapping Tab.
            dismiss(true); return;
          case "ArrowDown": event.preventDefault(); enabled[(index + 1) % enabled.length]?.focus(); return;
          case "ArrowUp": event.preventDefault(); enabled[(index - 1 + enabled.length) % enabled.length]?.focus(); return;
          case "Home": event.preventDefault(); enabled[0]?.focus(); return;
          case "End": event.preventDefault(); enabled.at(-1)?.focus(); return;
        }
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.key === " ") return;
        event.preventDefault();
        const now = performance.now();
        const key = event.key.toLocaleLowerCase();
        const prior = now - search.current.at < 700 ? search.current.text : "";
        const text = prior === key ? key : prior + key;
        search.current = { text, at: now };
        const ordered = [...enabled.slice(index + 1), ...enabled.slice(0, index + 1)];
        ordered.find(node => node.textContent?.trim().toLocaleLowerCase().startsWith(text))?.focus();
      }}>
      <div class="lf-menu__body" data-check-position={checkPosition}>
        {heading && <div class="lf-menu__heading">{heading}</div>}
        {items.map(item => <Fragment key={item.id}>
        {item.separatorBefore && <div role="separator" class="lf-menu__separator" />}
        <button id={`${id}-${item.id}`} type="button"
        role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
        aria-checked={item.checked} disabled={item.disabled} tabIndex={-1}
        class="lf-menu__item" data-destructive={item.destructive || undefined}
        onPointerMove={event => { if (!item.disabled) event.currentTarget.focus(); }}
        onClick={() => { dismiss(true); item.onSelect(); }}>
        {item.icon && <Glyph name={item.icon} />}{item.label}
        {item.checked && <span aria-hidden="true"><Glyph name="check" /></span>}
      </button></Fragment>)}
      {!items.length && <span role="status" class="lf-menu__empty">사용 가능한 항목이 없습니다.</span>}</div>
    </div>}
  </span>;
}
