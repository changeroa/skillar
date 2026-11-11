import { Button } from "./buttons";
import { ToastIcon, ToastLoading } from "./toast-icon";

export function Spinner({ label = "불러오는 중", size = "sm", variant = "inherit", display = "block", decorative = false }: {
  readonly label?: string; readonly size?: "xxs" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl" | "full";
  readonly variant?: "primary" | "muted" | "inherit"; readonly display?: "block" | "inline"; readonly decorative?: boolean;
}) {
  return <span class={`lf-loading lf-loading--${size} lf-loading--${variant} lf-loading--${display}`}
    role={decorative ? undefined : "status"} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined}>
    <svg class="lf-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  </span>;
}

export type ToastVariant = "default" | "success" | "info" | "warning" | "error" | "loading";
export function Toast({ message, description, variant = "default", onDismiss, action }: {
  readonly message: string; readonly description?: string; readonly variant?: ToastVariant;
  readonly onDismiss: () => void; readonly action?: { readonly label: string; readonly onClick: () => void };
}) {
  return <div class="lf-toast-region">
    <p class="lf-toast-announcement" aria-live="polite" aria-atomic="true" role={message === "" ? undefined : "status"}>
      {message}{message && description ? ` ${description}` : ""}
    </p>
    {message !== "" && <div class="lf-toast" data-variant={variant}>
      {variant === "loading" ? <span class="lf-toast__icon"><ToastLoading /></span> : variant !== "default" &&
        <span class="lf-toast__icon" aria-hidden="true"><ToastIcon variant={variant} /></span>}
      <div class="lf-toast__content" aria-hidden="true"><strong>{message}</strong>{description && <div>{description}</div>}</div>
      {variant !== "loading" && action && <Button text={action.label} onClick={action.onClick} />}
      {variant !== "loading" && <button class="lf-toast__dismiss" type="button" aria-label="알림 닫기" onClick={onDismiss}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>}
    </div>}
  </div>;
}
