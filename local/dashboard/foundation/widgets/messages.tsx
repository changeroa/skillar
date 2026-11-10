import type { ComponentChildren } from "preact";
import { Button, IconButton, Link } from "../controls/buttons";
import { Glyph } from "../controls/icons";
import type { ControlIcon } from "../controls/icons";

export function EmptyState({ title, description, action, variant = "default" }: {
  readonly title: string; readonly description?: string; readonly action?: ComponentChildren;
  readonly variant?: "default" | "intro";
}) {
  return <div class="lf-empty" data-variant={variant}>
    <p class="lf-empty__title">{title}</p>
    {description && <p class="lf-empty__description">{description}</p>}
    {action && <div class="lf-empty__action">{action}</div>}
  </div>;
}

export function Alert({ title, children, variant = "default", size = "default", icon, action, announce = false }: {
  readonly title?: string; readonly children: ComponentChildren;
  readonly variant?: "default" | "destructive" | "info" | "warning";
  readonly size?: "default" | "sm"; readonly icon?: ControlIcon;
  readonly action?: ComponentChildren; readonly announce?: boolean;
}) {
  return <div class={`lf-alert lf-alert--${variant}`} data-size={size} data-icon={Boolean(icon)}
    role={announce ? "alert" : "note"}>
    {icon && <span class="lf-alert__icon"><Glyph name={icon} /></span>}
    {title && <h5 class="lf-alert__title">{title}</h5>}
    <div class="lf-alert__description">{children}</div>
    {action && <div class="lf-message-actions">{action}</div>}
  </div>;
}

export function StatusMessage({ level, message, size = "default", announce = false }: {
  readonly level: "DEFAULT" | "DEBUG" | "WARNING" | "ERROR";
  readonly message: string; readonly size?: "default" | "compact"; readonly announce?: boolean;
}) {
  const roles = { DEFAULT: "status", DEBUG: "status", WARNING: "status", ERROR: "alert" } as const;
  return <div class="lf-status-message" data-level={level} data-size={size}
    role={announce ? roles[level] : undefined}>{message}</div>;
}

export type CalloutAction =
  | { readonly type: "button"; readonly label: string; readonly onClick: () => void; readonly disabled?: boolean }
  | { readonly type: "link"; readonly label: string; readonly href: string };

export function Callout({ variant, align = "top", children, actions = [], onDismiss, dismissLabel = "안내 닫기" }: {
  readonly variant: "info" | "warning"; readonly align?: "top" | "middle";
  readonly children: ComponentChildren; readonly actions?: readonly CalloutAction[];
  readonly onDismiss: () => void; readonly dismissLabel?: string;
}) {
  return <div class={`lf-callout lf-callout--${variant}`} role="note" data-align={align}>
    <div class="lf-callout__description">
      <div class="lf-callout__content">
        <div class="lf-callout__text">{children}</div>
        {actions.length > 0 && <div class="lf-message-actions">
          {actions.map(action => {
            switch (action.type) {
              case "button": return <Button key={action.label} text={action.label} variant="outline"
                onClick={action.onClick} disabled={action.disabled} />;
              case "link": return <Link key={action.label} text={action.label} href={action.href}
                external={/^https?:/.test(action.href)} />;
              default: { const unreachable: never = action; return unreachable; }
            }
          })}
        </div>}
      </div>
      <IconButton label={dismissLabel} icon="close" onClick={onDismiss} />
    </div>
  </div>;
}
