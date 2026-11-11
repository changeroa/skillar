import { useEffect, useId, useState } from "preact/hooks";
import { Select } from "./fields";
import type { SelectOption } from "./fields";
import { Button } from "./buttons";
import { Input } from "./fields";

export type DateRange = { readonly from: number; readonly to: number };
type DateRangeText = { readonly from: string; readonly to: string };
/** datetime-local is a wall clock, explicitly interpreted in KST at this boundary. */
export function parseKstDateTime(value: string): number | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value)) return null;
  const timestamp = Date.parse(`${value}+09:00`);
  if (!Number.isFinite(timestamp)) return null;
  const roundtrip = formatKstDateTime(timestamp);
  return roundtrip.slice(0, 16) === value.slice(0, 16) ? timestamp : null;
}
export function formatKstDateTime(timestamp: number): string {
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 23);
}

export function TimePeriodSelect({ label = "기간", options, value, onChange, disabled }: {
  readonly label?: string; readonly options: readonly SelectOption[]; readonly value: string;
  readonly onChange: (value: string) => void; readonly disabled?: boolean;
}) {
  return <div class="lf-time-period"><Select label={label} options={options} value={value} disabled={disabled}
    onChange={event => onChange(event.currentTarget.value)} /></div>;
}

/** Presentation only: callers retain their draft parser, including exact-millisecond text fallbacks. */
export function DateRangeFields({ value, onChange, disabled, invalid, fromLabel = "시작 (KST)", toLabel = "종료 (KST)",
  fromType = "datetime-local", toType = "datetime-local", step }: {
  readonly value: DateRangeText; readonly onChange: (patch: Partial<DateRangeText>) => void;
  readonly disabled?: boolean; readonly invalid?: boolean; readonly fromLabel?: string; readonly toLabel?: string;
  readonly fromType?: "text" | "datetime-local"; readonly toType?: "text" | "datetime-local"; readonly step?: string;
}) {
  const id = useId();
  const precision = step === undefined ? {} : { step };
  return <>
    <Input id={`${id}-from`} label={fromLabel} type={fromType} data-date-range-field="" icon={false} disabled={disabled} {...precision}
      aria-invalid={invalid ? "true" : undefined}
      value={value.from} onInput={event => onChange({ from: event.currentTarget.value })} />
    <Input id={`${id}-to`} label={toLabel} type={toType} data-date-range-field="" icon={false} disabled={disabled} {...precision}
      aria-invalid={invalid ? "true" : undefined}
      value={value.to} onInput={event => onChange({ to: event.currentTarget.value })} />
  </>;
}

export function DateRangeInput({ label = "기간", range, onChange, disabled = false }: {
  readonly label?: string; readonly range: DateRange; readonly onChange: (range: DateRange) => void; readonly disabled?: boolean;
}) {
  const id = useId();
  const [fromText, setFromText] = useState(() => formatKstDateTime(range.from));
  const [toText, setToText] = useState(() => formatKstDateTime(range.to));
  const [error, setError] = useState("");
  useEffect(() => {
    setFromText(formatKstDateTime(range.from)); setToText(formatKstDateTime(range.to)); setError("");
  }, [range.from, range.to]);
  const apply = () => {
    const from = parseKstDateTime(fromText), to = parseKstDateTime(toText);
    if (from === null || to === null) { setError("유효한 KST 날짜와 시간을 입력하세요."); return; }
    if (from > to) { setError("시작은 종료보다 늦을 수 없습니다."); return; }
    onChange({ from, to }); setError("");
  };
  return <fieldset class="lf-date-range" disabled={disabled} aria-describedby={error ? `${id}-error` : undefined}>
    <legend>{label} · KST</legend>
    <DateRangeFields value={{ from: fromText, to: toText }} step="0.001" invalid={Boolean(error)} onChange={patch => {
      if (patch.from !== undefined) setFromText(patch.from);
      if (patch.to !== undefined) setToText(patch.to);
      setError("");
    }} />
    <Button text="기간 적용" variant="outline" disabled={Boolean(error)} onClick={apply} />
    {error && <p id={`${id}-error`} role="alert">{error}</p>}
  </fieldset>;
}
