import { useId, useRef, useState } from "preact/hooks";
import type { JSX, Ref } from "preact";
import { Glyph } from "./icons";
import type { SelectOption } from "./fields";

type SelectionProps = {
  readonly label: string; readonly options: readonly SelectOption[];
  readonly disabled?: boolean; readonly error?: string; readonly placeholder?: string;
  readonly emptyMessage?: string; readonly id?: string;
};
type ListProps = SelectionProps & {
  readonly selected: readonly string[]; readonly multiple: boolean;
  readonly onSelect: (value: string) => void;
  readonly onSelectAll?: (values: readonly string[]) => void;
};

export function ComboboxInput({ inputRef, ...props }: Omit<JSX.InputHTMLAttributes<HTMLInputElement>,
  "class" | "className" | "style"> & { readonly inputRef?: Ref<HTMLInputElement> }) {
  return <input {...props} {...(inputRef ? { ref: inputRef } : {})} class="lf-combobox__control" role="combobox" />;
}

/** DOM focus stays on the search input; active and selected are separate states. */
function ChoiceList({ label, options, disabled, error, placeholder = "선택", emptyMessage = "일치하는 항목 없음",
  id, selected, multiple, onSelect, onSelectAll }: ListProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const listId = `${fieldId}-list`;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const expanded = open && !disabled;
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const enabled = filtered.filter(option => !option.disabled);
  const active = enabled.find(option => option.value === activeValue);
  const activeIndex = active ? options.indexOf(active) : -1;
  const optionId = (index: number) => `${fieldId}-option-${index}`;
  const close = () => { setOpen(false); setSearch(""); setActiveValue(null); };
  const choose = (value: string) => {
    onSelect(value);
    if (!multiple) close();
  };
  const selectAll = () => {
    const all = enabled.every(option => selected.includes(option.value));
    const choices = new Set(enabled.map(option => option.value));
    onSelectAll?.(all ? selected.filter(value => !choices.has(value)) : [...new Set([...selected, ...choices])]);
  };
  const move = (key: string) => {
    const index = enabled.findIndex(option => option.value === activeValue);
    const step = key === "ArrowDown" ? 1 : -1;
    // With no active option (opened by pointer or after typing), arrows start at the matching end.
    const next = key === "Home" ? enabled[0] : key === "End" ? enabled.at(-1)
      : index < 0 ? (step > 0 ? enabled[0] : enabled.at(-1))
      : enabled[(index + step + enabled.length) % enabled.length];
    setActiveValue(next?.value ?? null);
    if (next) requestAnimationFrame(() => document.getElementById(optionId(options.indexOf(next)))?.scrollIntoView({ block: "nearest" }));
  };
  const keydown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault(); setOpen(true);
        if (!expanded) setActiveValue((event.key === "ArrowDown" ? enabled[0] : enabled.at(-1))?.value ?? null);
        else move(event.key);
        break;
      case "Home":
      case "End":
        if (expanded) { event.preventDefault(); move(event.key); }
        break;
      case "Enter":
        if (expanded) { event.preventDefault(); if (active) choose(active.value); }
        break;
      case "Escape":
        if (expanded) { event.preventDefault(); event.stopPropagation(); close(); }
        break;
      case "Tab": close(); break;
      case "a":
        if (expanded && multiple && event.ctrlKey && search === "") { event.preventDefault(); selectAll(); }
        break;
    }
  };
  const summary = options.filter(option => selected.includes(option.value)).map(option => option.label).join(", ");
  return <div ref={root} class="lf-field lf-combobox" onBlur={event => {
    if (!(event.relatedTarget instanceof Node) || !root.current?.contains(event.relatedTarget)) close();
  }}>
    <label for={fieldId}>{label}</label>
    <div class="lf-combobox__input">
      <ComboboxInput inputRef={input} id={fieldId} type="text" autocomplete="off"
        disabled={disabled} placeholder={placeholder}
        value={expanded ? search : summary} aria-expanded={expanded}
        aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-invalid={error ? "true" : undefined} aria-describedby={error ? `${fieldId}-error` : undefined}
        onClick={() => { if (!expanded) { setOpen(true); setSearch(""); } }}
        onInput={event => { setSearch(event.currentTarget.value); setOpen(true); setActiveValue(null); }}
        onKeyDown={keydown} />
      <span aria-hidden="true"><Glyph name="chevron" /></span>
    </div>
    {expanded && <div class="lf-combobox__popup">
      {multiple && search === "" && enabled.length > 0 && <button type="button" class="lf-combobox__all" tabIndex={-1}
        aria-pressed={enabled.every(option => selected.includes(option.value))}
        onClick={() => {
          selectAll();
          input.current?.focus();
        }}>{enabled.every(option => selected.includes(option.value)) ? "전체 해제" : "전체 선택"}</button>}
      <ul id={listId} role="listbox" aria-label={label} aria-multiselectable={multiple || undefined}>
        {filtered.map(option => {
          const index = options.indexOf(option);
          const checked = selected.includes(option.value);
          return <li key={option.value} id={optionId(index)} role="option" aria-selected={checked}
            aria-disabled={option.disabled || undefined} data-active={active?.value === option.value}
            onPointerMove={() => { if (!option.disabled) setActiveValue(option.value); }}
            onMouseDown={event => event.preventDefault()}
            onClick={() => { if (!option.disabled) choose(option.value); }}>
            <span class="lf-combobox__check" aria-hidden="true">{checked && <Glyph name="check" />}</span>{option.label}
          </li>;
        })}
      </ul>
      {filtered.length === 0 && <p role="status">{emptyMessage}</p>}
    </div>}
    {error && <span id={`${fieldId}-error`} class="lf-field-error">{error}</span>}
  </div>;
}

export function Combobox({ value, onChange, ...props }: SelectionProps & {
  readonly value: string; readonly onChange: (value: string) => void;
}) {
  return <ChoiceList {...props} selected={value === "" ? [] : [value]} multiple={false} onSelect={onChange} />;
}

export function MultiSelect({ value, onChange, ...props }: SelectionProps & {
  readonly value: readonly string[]; readonly onChange: (value: readonly string[]) => void;
}) {
  return <ChoiceList {...props} selected={value} multiple onSelectAll={onChange} onSelect={choice =>
    onChange(value.includes(choice) ? value.filter(item => item !== choice) : [...value, choice])} />;
}
