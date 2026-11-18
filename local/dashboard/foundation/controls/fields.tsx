import type {JSX, Ref} from "react";
import { useId, useRef, useState } from "react";
import { TextInput as AxTextInput } from "@astryxdesign/core/TextInput";
import { CheckboxInput as AxCheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Glyph, type ControlIcon } from "./icons";

type InputAttributes = Omit<React.InputHTMLAttributes<HTMLInputElement>, "class" | "className" | "style" | "size" | "prefix">;
type FieldLabel = { readonly label: string; readonly error?: string };

export function Input({ label, error, id, prefix, valuePrefix, inputRef, icon = prefix || valuePrefix ? false : "search",
  variant = "default", ...props }: InputAttributes & FieldLabel & {
  readonly prefix?: string; readonly valuePrefix?: string; readonly icon?: ControlIcon | false;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly variant?: "default" | "command";
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const ref = useRef<HTMLInputElement>(null);
  const description = [props["aria-describedby"], error ? `${inputId}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return <div className={`lf-field${variant === "command" ? " lf-command-field" : ""}`}>
    <label htmlFor={inputId}>{label}</label>
    <div className="lf-input-wrap" data-invalid={Boolean(error)} data-disabled={Boolean(props.disabled)}
      data-prefixed={Boolean(prefix || valuePrefix)} data-value-prefixed={Boolean(valuePrefix)} data-icon={Boolean(icon)}
      onMouseDown={event => {
        if (event.target === ref.current) return;
        event.preventDefault();
        ref.current?.focus();
      }}>
      {prefix && <span className="lf-input-prefix">{prefix}</span>}
      {valuePrefix && <span className="lf-input-value-prefix">{valuePrefix}</span>}
      {icon && <span className="lf-input-icon"><Glyph name={icon} /></span>}
      <input {...props} ref={element => {
        ref.current = element;
        if (typeof inputRef === "function") inputRef(element);
        else if (inputRef) inputRef.current = element;
      }} id={inputId} className="lf-input"
        aria-invalid={error ? "true" : props["aria-invalid"]} aria-describedby={description} />
    </div>
    {error && <span id={`${inputId}-error`} className="lf-field-error">{error}</span>}
  </div>;
}

export function SearchInput({ label, value, onChange, onSubmit, placeholder = "검색", disabled = false,
  id, size = "default" }: {
  readonly label: string; readonly value: string; readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void; readonly placeholder?: string;
  readonly disabled?: boolean; readonly id?: string; readonly size?: "default" | "large";
}) {
  // Astryx TextInput: Enter submission is IME-safe inside the component, and
  // its clear button returns focus to the field. onEnter passes no value, so
  // submit the live field value (tests set input.value directly).
  const ref = useRef<HTMLInputElement>(null);
  // The lf-field wrapper preserves the layout contract the toolbar CSS keys
  // on (flex child + context label hiding); Astryx renders label + control.
  return <div className="lf-field">
    <AxTextInput ref={ref} type="search" id={id} label={label} value={value} width="100%"
      onChange={next => onChange(next)} placeholder={placeholder} isDisabled={disabled}
      size={size === "large" ? "lg" : "md"} hasClear enterKeyHint="search"
      onEnter={() => onSubmit(ref.current?.value ?? value)} />
  </div>;
}

export function TextInput({ label, value, onChange, placeholder, id, type = "text", disabled = false,
  size = "default" }: {
  readonly label: string; readonly value: string; readonly onChange: (value: string) => void;
  readonly placeholder?: string; readonly id?: string; readonly type?: "text" | "search";
  readonly disabled?: boolean; readonly size?: "default" | "large";
}) {
  // Astryx TextInput for plain text/search callers (D-12): live onChange
  // filtering with the same focus ring and clear button as SearchInput.
  // Native Input stays for date/time (date-range), prefix/valuePrefix and
  // the command-palette combobox, which TextInput cannot express.
  return <div className="lf-field">
    <AxTextInput type={type} id={id} label={label} value={value} width="100%"
      onChange={next => onChange(next)} placeholder={placeholder} isDisabled={disabled}
      size={size === "large" ? "lg" : "md"} hasClear />
  </div>;
}

/** `badge` is a short closed-control prefix (e.g. "7d"), shown only for the selected option. */
export type SelectOption = { readonly value: string; readonly label: string; readonly disabled?: boolean; readonly badge?: string };
export function Select({ label, error, options, placeholder = "선택", id, onChange, size = "default", ...props }: FieldLabel & {
  readonly options: readonly SelectOption[]; readonly placeholder?: string;
  readonly size?: "default" | "sm";
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "class" | "className" | "style" | "children" | "size" | "multiple">) {
  const generatedId = useId();
  const [nativeValue, setNativeValue] = useState(props.defaultValue ?? "");
  const selectId = id ?? generatedId;
  const selected = options.find(option => option.value === (props.value ?? nativeValue));
  const text = selected?.label ?? (options.length === 0 ? "선택 가능한 항목 없음" : placeholder);
  const description = [props["aria-describedby"], error ? `${selectId}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return <div className="lf-field">
    <label htmlFor={selectId}>{label}</label>
    <div className={`lf-select-wrap lf-select-wrap--${size}`} data-invalid={Boolean(error)}
      data-disabled={Boolean(props.disabled)} data-placeholder={!selected}>
      <select {...props} id={selectId} className="lf-select" aria-invalid={error ? "true" : props["aria-invalid"]}
        aria-describedby={description} onChange={event => { setNativeValue(event.currentTarget.value); onChange?.(event); }}>
        <option value="" disabled>{options.length === 0 ? "선택 가능한 항목 없음" : placeholder}</option>
        {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      {selected?.badge && <span className="lf-select-badge" aria-hidden="true">{selected.badge}</span>}
      <span className="lf-select-value" aria-hidden="true">{text}</span>
      <Glyph name={size === "sm" ? "chevrons" : "chevron"} />
    </div>
    {error && <span id={`${selectId}-error`} className="lf-field-error">{error}</span>}
  </div>;
}

export function Checkbox({ label, mixed = false, size = "default", checked, onChange, disabled, name, ...props }: {
  readonly label: string; readonly mixed?: boolean; readonly size?: "default" | "sm";
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size" | "class" | "className" | "style" | "children">) {
  // Astryx CheckboxInput is controlled; every dashboard call site is too. It
  // syncs the native indeterminate property itself and (like the old control)
  // deliberately exposes no aria-checked for mixed. exactOptionalPropertyTypes
  // cast as in buttons.tsx. NOTE: title is not accepted by Astryx BaseProps
  // (facet checkbox value tooltip dropped — flagged for review).
  return <AxCheckboxInput {...(props as object as React.ComponentProps<typeof AxCheckboxInput>)}
    label={label} size={size === "sm" ? "sm" : "md"} {...(name !== undefined ? { htmlName: name } : {})}
    value={mixed ? "indeterminate" : Boolean(checked)}
    isDisabled={Boolean(disabled)}
    onChange={(_next, event) => onChange?.(event)} />;
}
