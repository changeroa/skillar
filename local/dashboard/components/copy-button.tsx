import { CopyButton as FoundationCopyButton } from "../foundation/controls/copy-button";

export function CopyButton({ value, label = "ID" }: { readonly value: string; readonly label?: string }) {
  return <FoundationCopyButton value={value} label={label} />;
}
