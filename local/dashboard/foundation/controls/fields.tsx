import type { JSX, Ref } from "preact";
import { useId, useRef, useState } from "preact/hooks";
import { Glyph, type ControlIcon } from "./icons";

type InputAttributes = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class" | "className" | "style" | "size" | "prefix">;
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
  return <div class={`lf-field${variant === "command" ? " lf-command-field" : ""}`}>
    <label for={inputId}>{label}</label>
    <div class="lf-input-wrap" data-invalid={Boolean(error)} data-disabled={Boolean(props.disabled)}
      data-prefixed={Boolean(prefix || valuePrefix)} data-value-prefixed={Boolean(valuePrefix)} data-icon={Boolean(icon)}
      onMouseDown={event => {
        if (event.target === ref.current) return;
        event.preventDefault();
        ref.current?.focus();
      }}>
      {prefix && <span class="lf-input-prefix">{prefix}</span>}
      {valuePrefix && <span class="lf-input-value-prefix">{valuePrefix}</span>}
      {icon && <span class="lf-input-icon"><Glyph name={icon} /></span>}
      <input {...props} ref={element => {
        ref.current = element;
        if (typeof inputRef === "function") inputRef(element);
        else if (inputRef) inputRef.current = element;
      }} id={inputId} class="lf-input"
        aria-invalid={error ? "true" : props["aria-invalid"]} aria-describedby={description} />
    </div>
    {error && <span id={`${inputId}-error`} class="lf-field-error">{error}</span>}
  </div>;
}

export function SearchInput({ label, value, onChange, onSubmit, placeholder = "검색", disabled = false,
  id, size = "default" }: {
  readonly label: string; readonly value: string; readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void; readonly placeholder?: string;
  readonly disabled?: boolean; readonly id?: string; readonly size?: "default" | "large";
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const ref = useRef<HTMLInputElement>(null);
  return <div class="lf-field">
    <label for={inputId}>{label}</label>
    <div class={`lf-search lf-search--${size}`} data-disabled={disabled}>
      <button type="button" aria-label={`${label} 실행`} disabled={disabled} onClick={() => onSubmit(value)}>
        <Glyph name="search" />
      </button>
      <input ref={ref} id={inputId} type="search" value={value} disabled={disabled} placeholder={placeholder}
        onInput={event => onChange(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            onSubmit(event.currentTarget.value);
          }
        }} />
      {value !== "" && <button type="button" aria-label={`${label} 지우기`} disabled={disabled}
        onMouseDown={event => event.preventDefault()}
        onClick={() => { onChange(""); ref.current?.focus(); }}>
        <Glyph name="close" />
      </button>}
    </div>
  </div>;
}

export type SelectOption = { readonly value: string; readonly label: string; readonly disabled?: boolean };
export function Select({ label, error, options, placeholder = "선택", id, onChange, size = "default", ...props }: FieldLabel & {
  readonly options: readonly SelectOption[]; readonly placeholder?: string;
  readonly size?: "default" | "sm";
} & Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "class" | "className" | "style" | "children" | "size" | "multiple">) {
  const generatedId = useId();
  const [nativeValue, setNativeValue] = useState(props.defaultValue ?? "");
  const selectId = id ?? generatedId;
  const selected = options.find(option => option.value === (props.value ?? nativeValue));
  const text = selected?.label ?? (options.length === 0 ? "선택 가능한 항목 없음" : placeholder);
  const description = [props["aria-describedby"], error ? `${selectId}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return <div class="lf-field">
    <label for={selectId}>{label}</label>
    <div class={`lf-select-wrap lf-select-wrap--${size}`} data-invalid={Boolean(error)}
      data-disabled={Boolean(props.disabled)} data-placeholder={!selected}>
      <select {...props} id={selectId} class="lf-select" aria-invalid={error ? "true" : props["aria-invalid"]}
        aria-describedby={description} onChange={event => { setNativeValue(event.currentTarget.value); onChange?.(event); }}>
        <option value="" disabled>{options.length === 0 ? "선택 가능한 항목 없음" : placeholder}</option>
        {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      <span class="lf-select-value" aria-hidden="true">{text}</span>
      <Glyph name={size === "sm" ? "chevrons" : "chevron"} />
    </div>
    {error && <span id={`${selectId}-error`} class="lf-field-error">{error}</span>}
  </div>;
}

export function Checkbox({ label, mixed = false, size = "default", ...props }: {
  readonly label: string; readonly mixed?: boolean; readonly size?: "default" | "sm";
} & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "type" | "size" | "class" | "className" | "style" | "children">) {
  return <label class={`lf-checkbox lf-checkbox--${size}`}>
    <input {...props} type="checkbox" ref={element => { if (element) element.indeterminate = mixed; }} />
    <span class="lf-checkbox__box" aria-hidden="true"><Glyph name="check" small={size === "sm"} /></span>
    <span>{label}</span>
  </label>;
}
