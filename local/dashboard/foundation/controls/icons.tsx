import type { ComponentChildren } from "preact";

const paths = {
  panelLeft: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
  sessions: <><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></>,
  tree: <path d="M4 4v12a2 2 0 0 0 2 2h6M4 10h8M12 4h8M12 10h8M12 18h8" />,
  columns: <><rect x="3" y="3" width="18" height="18" /><path d="M9 3v18M15 3v18" /></>,
  rows: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  search: <><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></>,
  copy: <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.59 13.51 6.83 3.98m-.01-10.98-6.82 3.98" /></>,
  trash: <><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  diff: <><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM9 10h6M12 13V7M9 17h6" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronsLeft: <><path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" /></>,
  chevronsRight: <><path d="m6 17 5-5-5-5" /><path d="m13 17 5-5-5-5" /></>,
  chevrons: <><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></>,
  minus: <path d="M5 12h14" />,
  ellipsis: <><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></>,
  tag: <><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r="0.5" /></>,
  dashboard: <><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></>,
  external: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></>,
} as const satisfies Record<string, ComponentChildren>;

export type ControlIcon = keyof typeof paths;

export function Glyph({ name, small = false }: { readonly name: ControlIcon; readonly small?: boolean }) {
  return <svg width={small ? 12 : 14} height={small ? 12 : 14} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
