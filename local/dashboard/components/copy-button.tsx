import { CopyButton as FoundationCopyButton } from "../foundation/controls/copy-button";

export function CopyButton({ value, label = "ID" }: { readonly value: string; readonly label?: string }) {
  return <span class="pe-copy"><FoundationCopyButton value={value} label={label} /></span>;
}
