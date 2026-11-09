import type { ComponentChildren } from "preact";

const paths = {
  check: <path d="m20 6-11 11-5-5" />,
  close: <><path d="m18 6-12 12" /><path d="m6 6 12 12" /></>,
  search: <><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></>,
  copy: <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  minus: <path d="M5 12h14" />,
  ellipsis: <><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></>,
  external: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></>,
} as const satisfies Record<string, ComponentChildren>;

export type ControlIcon = keyof typeof paths;

export function Glyph({ name, small = false }: { readonly name: ControlIcon; readonly small?: boolean }) {
  return <svg width={small ? 12 : 14} height={small ? 12 : 14} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
