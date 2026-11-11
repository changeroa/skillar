import { h } from "preact";
import type { ComponentChildren } from "preact";
import { Toast as SharedToast } from "../../../local/dashboard/foundation/controls/feedback";

export function Pill({ children, tone = "neutral" }: {
  readonly children: ComponentChildren;
  readonly tone?: "neutral" | "success" | "warning" | "error";
}) {
  return h("span", { class: `ui-pill ui-tone-${tone}` }, children);
}

export function KeyValueGrid({ entries }: {
  readonly entries: readonly { readonly label: string; readonly value: ComponentChildren }[];
}) {
  return h("dl", { class: "ui-kv" }, entries.map((entry, index) =>
    h("div", { key: index }, h("dt", null, entry.label), h("dd", null, entry.value))));
}

export function NumberTile({ label, value, note }: {
  readonly label: string;
  readonly value: string | number | null;
  readonly note: string;
}) {
  return h("section", { class: "ui-number-tile", "aria-label": label },
    h("p", null, label), h("strong", null, value ?? "미측정"), h("p", { class: "note" }, note));
}

export function Toast({ message, onDismiss }: {
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  return h(SharedToast, { message, onDismiss });
}

export function Skeleton({ label = "불러오는 중", rows = 3 }: {
  readonly label?: string;
  readonly rows?: number;
}) {
  return h("div", { class: "ui-skeleton", role: "status", "aria-label": label, "aria-busy": "true" },
    Array.from({ length: rows }, (_, index) => h("div", { key: index, "aria-hidden": "true" })));
}
