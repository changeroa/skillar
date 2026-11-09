import type { JSX } from "preact";
import { Glyph } from "./icons";
import type { ControlIcon } from "./icons";

type NativeButton = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "className" | "style" | "children" | "size">;
export type ButtonProps = NativeButton & {
  readonly text: string;
  readonly variant?: "primary" | "secondary" | "outline" | "destructive" | "ghost" | "text";
  readonly size?: "default" | "sm";
  readonly loading?: boolean;
  readonly icon?: ControlIcon;
};

export function Button({ text, variant = "primary", size = "default", loading = false,
  icon, disabled, type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} class={`lf-button lf-button--${variant} lf-button--${size}`}
    disabled={disabled || loading} aria-busy={loading || undefined} aria-label={props["aria-label"] ?? text}>
    <span class="lf-button__content" aria-hidden={loading || undefined}>
      {icon && <Glyph name={icon} />}{text}
    </span>
    {loading && <span class="lf-button__busy" aria-hidden="true"><svg class="lf-spinner" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a10 10 0 1 0 10 10" />
    </svg></span>}
  </button>;
}

export type IconButtonProps = NativeButton & {
  readonly label: string;
  readonly icon: ControlIcon;
  readonly size?: "xs" | "sm" | "md";
  readonly variant?: "ghost" | "outline" | "outlineDestructive" | "subtle" | "toolbar" | "destructive";
};

export function IconButton({ label, icon, size = "md", variant = "ghost", type = "button", ...props }: IconButtonProps) {
  return <button {...props} class={`lf-icon-button lf-icon-button--${variant} lf-icon-button--${size}`}
    type={type} aria-label={label} title={props.title ?? label}>
    <Glyph name={icon} small={size === "xs" || variant === "toolbar"} />
  </button>;
}

export function Link({ text, href, external = false, ...props }: {
  readonly text: string;
  readonly href: string;
  readonly external?: boolean;
} & Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "class" | "className" | "style" | "children">) {
  return <a {...props} class="lf-link" href={href} title={props.title ?? text}
    target={external ? "_blank" : props.target} rel={external ? "noopener noreferrer" : props.rel}>
    <span>{text}</span>
  </a>;
}
