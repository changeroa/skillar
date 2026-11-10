import type { ComponentChildren, JSX } from "preact";
import { Checkbox } from "../controls/fields";
import type { TableSort } from "./model";
import { tableStyles } from "./styles";

export function SortButton({ label, direction, onSort }: {
  readonly label: string; readonly direction?: TableSort["direction"]; readonly onSort: () => void;
}) {
  tableStyles();
  return <button type="button" class="lf-table-sort" onClick={onSort}>
    <span>{label}</span>{direction && <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {direction === "ascending" ? <path d="m7 14 5-6 5 6z" /> : <path d="m7 10 5 6 5-6z" />}
    </svg>}
  </button>;
}

export function TableRow({ selected = false, onOpen, children, ...props }: {
  readonly selected?: boolean; readonly onOpen?: (target: HTMLTableRowElement) => void;
  readonly children: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLTableRowElement>, "onClick" | "onKeyDown">) {
  return <tr {...props} data-selected={selected || undefined} tabIndex={onOpen ? 0 : props.tabIndex}
    onClick={event => {
      if (event.target !== event.currentTarget && event.target instanceof Element &&
        event.target.closest("a,button,input,select,textarea,summary,[role=button]")) return;
      onOpen?.(event.currentTarget);
    }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      if (onOpen) { event.preventDefault(); onOpen(event.currentTarget); }
    }}>
    {children}
  </tr>;
}

export function RowCheckbox({ label, checked, mixed = false, disabled = false, onChange }: {
  readonly label: string; readonly checked: boolean; readonly mixed?: boolean; readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return <span class="lf-table-check"><Checkbox label={label} checked={checked} mixed={mixed} disabled={disabled}
    onChange={event => onChange(event.currentTarget.checked)} /></span>;
}

export function TableToolbar({ children }: { readonly children: ComponentChildren }) {
  tableStyles();
  return <div class="lf-table-toolbar">{children}</div>;
}
