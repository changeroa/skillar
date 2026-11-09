import type { ComponentChildren } from "preact";
import { Glyph } from "./icons";

export type BadgeColor = "primary" | "filled" | "filledOnMuted" | "ghost" | "inverted" | "green" | "blue" | "violet" | "teal" | "red" | "yellow";
export function Badge({ text, label, color = "primary", size = "default", mono = false, onDismiss }: {
  readonly text: string; readonly label?: string; readonly color?: BadgeColor;
  readonly size?: "lg" | "default" | "md" | "sm"; readonly mono?: boolean;
  readonly onDismiss?: () => void;
}) {
  const content = <>{label && <span>{label}:</span>}<span title={text}>{text}</span></>;
  const className = `lf-badge lf-badge--${color} lf-badge--${size}${mono ? " lf-mono" : ""}`;
  return onDismiss
    ? <button type="button" class={className} aria-label={`Remove ${text}`} onClick={onDismiss}>{content}</button>
    : <span class={className}>{content}</span>;
}

export function Tag({ text, secondaryText, status = "default", remove }: {
  readonly text: string; readonly secondaryText?: string;
  readonly status?: "default" | "warning" | "error";
  readonly remove?: { readonly onRemove: () => void; readonly disabled?: boolean };
}) {
  return <span class={`lf-tag lf-tag--${status}`}>
    <span title={[text, secondaryText].filter(Boolean).join(" ")}>{text}</span>
    {secondaryText && <span class="lf-tag__secondary">{secondaryText}</span>}
    {remove && <button type="button" aria-label={`Remove ${text}`} disabled={remove.disabled}
      onClick={event => { event.stopPropagation(); remove.onRemove(); }}><Glyph name="close" small /></button>}
  </span>;
}

const categories: Readonly<Record<string, string>> = {
  production: "active", live: "active", active: "active", public: "active",
  pending: "pending", waiting: "pending", queued: "pending", running: "pending", processing: "pending",
  delayed: "delayed", disabled: "inactive", inactive: "inactive", archived: "inactive", cancelled: "inactive",
  debug: "inactive", not_configured: "notConfigured", paused: "paused",
  completed: "completed", done: "completed", finished: "completed", error: "error", failed: "error",
  triggered: "error", partial: "partial", warning: "partial",
};
export function StatusBadge({ type, size = "default", transparent = false, isLive = true }: {
  readonly type: string; readonly size?: "default" | "lg"; readonly transparent?: boolean; readonly isLive?: boolean;
}) {
  const key = type.toLowerCase();
  const category = Object.hasOwn(categories, key) ? categories[key] ?? "unknown" : "unknown";
  const dot = isLive && !["completed", "error", "partial"].includes(category);
  const text = type ? type[0]?.toUpperCase() + type.slice(1).replaceAll("_", " ") : "Unknown";
  return <span class={`lf-status lf-status--${category} lf-status--${size}`} data-transparent={transparent}>
    {dot && <span class="lf-status__dot" aria-hidden="true" />}{text}
  </span>;
}

const keyLabels: Readonly<Record<string, string>> = {
  Control: "Ctrl", Meta: "\u2318", Enter: "\u21b5", Escape: "Esc", ArrowUp: "\u2191",
  ArrowDown: "\u2193", ArrowLeft: "\u2190", ArrowRight: "\u2192", Backspace: "\u232b", Delete: "Del",
};
export function KeyboardShortcut({ keys, variant = "default", platform = "auto", title }: {
  readonly keys: readonly [string, ...string[]]; readonly variant?: "default" | "subtle" | "inverse" | "keycap";
  readonly platform?: "auto" | "mac" | "other"; readonly title?: string;
}) {
  const mac = platform === "mac" || (platform === "auto" && typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform));
  return <kbd class={`lf-shortcut lf-shortcut--${variant}`} title={title} aria-label={keys.join("+")}>
    {keys.map((key, index) => {
      const label = key === "Mod" ? (mac ? "\u2318" : "Ctrl")
        : mac && key === "Shift" ? "\u21e7" : mac && key === "Alt" ? "\u2325" : keyLabels[key] ?? key;
      return <span key={index} data-symbol={/^[^\p{L}\p{N}]$/u.test(label)}>{label}</span>;
    })}
  </kbd>;
}

export function Skeleton({ label = "불러오는 중", rows = 3, variant = "default" }: {
  readonly label?: string; readonly rows?: number; readonly variant?: "default" | "contrast";
}) {
  return <div class={`lf-skeleton lf-skeleton--${variant}`} role="status" aria-label={label} aria-busy="true">
    {Array.from({ length: rows }, (_, index): ComponentChildren => <div key={index} aria-hidden="true" />)}
  </div>;
}
