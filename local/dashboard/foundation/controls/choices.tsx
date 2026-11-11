import type { JSX } from "preact";
import { useId, useState } from "preact/hooks";
import { Tooltip } from "../overlays/tooltip";
export { Textarea } from "./textarea";

type ChoiceInput = Omit<JSX.InputHTMLAttributes<HTMLInputElement>,
  "type" | "size" | "class" | "className" | "style" | "children">;

export function Radio({ label, ...props }: ChoiceInput & { readonly label: string }) {
  return <label class="lf-radio">
    <input {...props} type="radio" />
    <span class="lf-radio__ring" aria-hidden="true"><span /></span>
    <span>{label}</span>
  </label>;
}

export function Switch({ label, size = "default", color = "default", ...props }: ChoiceInput & {
  readonly label: string; readonly size?: "default" | "sm"; readonly color?: "default" | "green";
}) {
  return <label class={`lf-switch lf-switch--${size} lf-switch--${color}`}>
    <input {...props} type="checkbox" role="switch" />
    <span class="lf-switch__track" aria-hidden="true"><span /></span>
    <span>{label}</span>
  </label>;
}

export function Avatar({ displayName, email, src, size = "lg", shape = "circle", tone = "muted" }: {
  readonly displayName: string; readonly email?: string; readonly src?: string;
  readonly size?: "sm" | "md" | "lg"; readonly shape?: "circle" | "rounded"; readonly tone?: "muted" | "tinted";
}) {
  const [image, setImage] = useState<{ readonly src: string; readonly status: "loaded" | "failed" }>();
  const status = image && image.src === src ? image.status : "loading";
  const tooltipId = useId();
  const name = displayName.trim() || email?.trim() || "User";
  const initials = name.split(/\s+/).slice(0, 2).map(word => word.charAt(0)).join("").toUpperCase();
  const accessible = email && email.toLowerCase() !== name.toLowerCase() ? `${name}, ${email}` : name;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  const color = (["blue", "green", "yellow", "violet"] as const)[hash % 4] ?? "blue";
  return <Tooltip id={tooltipId} content={email && email.toLowerCase() !== name.toLowerCase() ? `${name}\n${email}` : name} size="content"><span role="img" aria-label={accessible}
    class={`lf-avatar lf-avatar--${size} lf-avatar--${shape}`} data-tone={tone === "tinted" ? color : "muted"}>
    {status !== "loaded" && <span aria-hidden="true">{initials}</span>}
    {src && status !== "failed" && <img src={src} alt="" referrerpolicy="no-referrer"
      onLoad={() => setImage({ src, status: "loaded" })} onError={() => setImage({ src, status: "failed" })} />}
  </span></Tooltip>;
}
