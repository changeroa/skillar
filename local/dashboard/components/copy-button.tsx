import { useEffect, useState } from "preact/hooks";
import { Icon } from "./icons";

export function CopyButton({ value, label = "ID" }: { readonly value: string; readonly label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => setState("idle"), [value]);
  return <span class="pe-copy">
    <button class="pe-button pe-icon-button" aria-label={state === "copied" ? `${label} 복사됨` : `${label} 복사`}
      title={state === "copied" ? "복사됨" : `${label} 복사`}
      disabled={typeof navigator === "undefined" || !navigator.clipboard}
      onClick={() => navigator.clipboard.writeText(value).then(() => setState("copied"), () => setState("failed"))}>
      <Icon name={state === "copied" ? "check" : "copy"} />
    </button>
    {state === "failed" && <span role="alert">복사하지 못했습니다.</span>}
  </span>;
}
