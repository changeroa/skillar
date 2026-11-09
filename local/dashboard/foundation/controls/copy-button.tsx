import { useEffect, useRef, useState } from "preact/hooks";
import { IconButton } from "./buttons";

type CopyState = { readonly value: string; readonly outcome: "idle" | "copying" | "copied" | "failed" };

export function CopyButton({ value, label = "값", disabled = false }: {
  readonly value: string; readonly label?: string; readonly disabled?: boolean;
}) {
  const [result, setResult] = useState<CopyState>({ value, outcome: "idle" });
  const currentValue = useRef(value);
  currentValue.current = value;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = result.value === value ? result.outcome : "idle";
  const copy = async () => {
    setResult({ value, outcome: "copying" });
    try {
      await navigator.clipboard.writeText(value);
      if (mounted.current && currentValue.current === value) setResult({ value, outcome: "copied" });
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      if (mounted.current && currentValue.current === value) setResult({ value, outcome: "failed" });
    }
  };
  const unavailable = typeof navigator === "undefined" || !navigator.clipboard;
  return <span class="lf-copy" data-copy-state={state}>
    <IconButton size="sm" icon={state === "copied" ? "check" : "copy"} label={state === "copied" ? `${label} 복사됨` : `${label} 복사`}
      disabled={disabled || unavailable || state === "copying"} aria-busy={state === "copying" || undefined} onClick={copy} />
    <span class="lf-copy__feedback" role="status" aria-live="polite">
      {state === "failed" ? "복사하지 못했습니다. 다시 시도하세요." : state === "copied" ? `${label} 복사됨` : unavailable ? "클립보드를 사용할 수 없습니다." : ""}
    </span>
  </span>;
}
