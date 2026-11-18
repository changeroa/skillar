import type {JSX} from "react";
import { Glyph } from "./icons";
import type { ControlIcon } from "./icons";
import { Spinner } from "./feedback";

type NativeButton = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "className" | "style" | "children" | "size">;
export type ButtonProps = NativeButton & {
  readonly text: string;
  readonly variant?: "primary" | "secondary" | "outline" | "destructive" | "ghost" | "text";
  readonly size?: "default" | "sm";
  readonly loading?: boolean;
  readonly icon?: ControlIcon;
  readonly trailingIcon?: ControlIcon;
};

export function Button({ text, variant = "primary", size = "default", loading = false,
  icon, trailingIcon, disabled, type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} className={`lf-button lf-button--${variant} lf-button--${size}`}
    disabled={disabled || loading} aria-busy={loading || undefined} aria-label={props["aria-label"] ?? text}>
    <span className="lf-button__content" data-trailing={Boolean(trailingIcon)} aria-hidden={loading || undefined}>
      {icon && <Glyph name={icon} />}{text}{trailingIcon && <Glyph name={trailingIcon} />}
    </span>
    {loading && <span className="lf-button__busy" aria-hidden="true"><Spinner decorative variant="inherit" /></span>}
  </button>;
}

export type IconButtonProps = NativeButton & {
  readonly label: string;
  readonly icon: ControlIcon;
  readonly size?: "xs" | "sm" | "md";
  readonly variant?: "ghost" | "outline" | "outlineDestructive" | "subtle" | "toolbar" | "destructive";
};

export function IconButton({ label, icon, size = "md", variant = "ghost", type = "button", ...props }: IconButtonProps) {
  return <button {...props} className={`lf-icon-button lf-icon-button--${variant} lf-icon-button--${size}`}
    type={type} aria-label={label} title={props.title ?? label}>
    <Glyph name={icon} small={size === "xs" || variant === "toolbar"} />
  </button>;
}

export function Link({ text, href, external = false, ...props }: {
  readonly text: string;
  readonly href: string;
  readonly external?: boolean;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "class" | "className" | "style" | "children">) {
  return <a {...props} className="lf-link" href={href} title={props.title ?? text}
    target={external ? "_blank" : props.target} rel={external ? "noopener noreferrer" : props.rel}>
    <span>{text}</span>
  </a>;
}
