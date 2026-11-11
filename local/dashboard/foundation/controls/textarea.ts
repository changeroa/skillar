import { h } from "preact";
import type { JSX } from "preact";

export function Textarea({ label, error, id, code = false, ...props }: {
  readonly label: string; readonly id: string; readonly error?: string; readonly code?: boolean;
} & Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "class" | "className" | "style">) {
  const fieldId = id;
  const description = [props["aria-describedby"], error ? `${fieldId}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return h("div", { class: "lf-field" },
    h("label", { for: fieldId }, label),
    h("textarea", { ...props, id: fieldId, class: `lf-textarea${code ? " lf-textarea--code" : ""}`,
      "aria-invalid": error ? "true" : props["aria-invalid"], "aria-describedby": description }),
    error && h("span", { id: `${fieldId}-error`, class: "lf-field-error" }, error));
}
