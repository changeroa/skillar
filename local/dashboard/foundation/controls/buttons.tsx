import type {JSX} from "react";
import { Button as AxButton } from "@astryxdesign/core/Button";
import { IconButton as AxIconButton } from "@astryxdesign/core/IconButton";
import { Glyph } from "./icons";
import type { ControlIcon } from "./icons";

// Astryx-backed controls. The wrapper keeps the dashboard's existing call
// shape (text/icon names/size names) so view code is untouched; variant and
// size names that have no Astryx equivalent collapse per token-mapping.md
// (outline→secondary, text→ghost, xs→sm) and are flagged in the PR.
type NativeButton = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "className" | "style" | "children" | "size">;
export type ButtonProps = NativeButton & {
  readonly text: string;
  readonly variant?: "primary" | "secondary" | "outline" | "destructive" | "ghost" | "text";
  readonly size?: "default" | "sm";
  readonly loading?: boolean;
  readonly icon?: ControlIcon;
  readonly trailingIcon?: ControlIcon;
};

type AxVariant = "primary" | "secondary" | "ghost" | "destructive";
const buttonVariant: Record<NonNullable<ButtonProps["variant"]>, AxVariant> = {
  primary: "primary", secondary: "secondary", outline: "secondary",
  destructive: "destructive", ghost: "ghost", text: "ghost",
};

export function Button({ text, variant = "primary", size = "default", loading = false,
  icon, trailingIcon, disabled, type = "button", ...props }: ButtonProps) {
  // exactOptionalPropertyTypes (site tsconfig) rejects optional props typed
  // `| undefined` from the spread; the runtime pass-through is identical.
  return <AxButton {...(props as object as React.ComponentProps<typeof AxButton>)} type={type} label={text} variant={buttonVariant[variant]}
    size={size === "sm" ? "sm" : "md"} isLoading={Boolean(loading)}
    isDisabled={Boolean(disabled)}
    icon={icon ? <Glyph name={icon} /> : undefined}
    endContent={trailingIcon ? <Glyph name={trailingIcon} /> : undefined} />;
}

export type IconButtonProps = NativeButton & {
  readonly label: string;
  readonly icon: ControlIcon;
  readonly size?: "xs" | "sm" | "md";
  readonly variant?: "ghost" | "outline" | "outlineDestructive" | "subtle" | "toolbar" | "destructive";
};

const iconButtonVariant: Record<NonNullable<IconButtonProps["variant"]>, AxVariant> = {
  ghost: "ghost", outline: "secondary", outlineDestructive: "destructive",
  subtle: "ghost", toolbar: "ghost", destructive: "destructive",
};

export function IconButton({ label, icon, size = "md", variant = "ghost", type = "button",
  disabled, title, ...props }: IconButtonProps) {
  return <AxIconButton {...(props as object as React.ComponentProps<typeof AxIconButton>)} type={type} label={label} variant={iconButtonVariant[variant]}
    size={size === "md" ? "md" : "sm"} isDisabled={Boolean(disabled)}
    tooltip={title ?? label}
    icon={<Glyph name={icon} small={size !== "md" || variant === "toolbar"} />} />;
}

export function Link({ text, href, external = false, icon, ...props }: {
  readonly text: string;
  readonly href: string;
  readonly external?: boolean;
  readonly icon?: ControlIcon;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "class" | "className" | "style" | "children">) {
  return <a {...props} className="lf-link" href={href} title={props.title ?? text}
    target={external ? "_blank" : props.target} rel={external ? "noopener noreferrer" : props.rel}>
    {icon && <Glyph name={icon} />}<span>{text}</span></a>;
}
