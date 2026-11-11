import type { EventKind } from "../../src/types.js";

const paths = {
  sessions: "M12 8v4l3 3M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  flow: "M5 3v12a4 4 0 0 0 4 4h10M5 7h10a4 4 0 0 1 4 4v8M2 3h6M16 16l3 3 3-3",
  workspaces: "M3 7h7l2-3h9v16H3z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  search: "m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  external: "M15 3h6v6M10 14 21 3M21 14v7H3V3h7",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  previous: "m6 10 6-6 6 6M12 4v16",
  next: "m6 14 6 6 6-6M12 4v16",
  close: "m6 6 12 12M6 18 18 6",
  copy: "M9 9h12v12H9zM5 15H3V3h12v2",
  check: "m5 12 4 4L19 6",
  columns: "M3 3h18v18H3zM9 3v18M15 3v18",
  density: "M4 6h16M4 10h16M4 14h16M4 18h16",
  filter: "M3 4h18l-7 8v7l-4 2v-9z",
  calendar: "M3 5h18v16H3zM7 3v4M17 3v4M3 11h18",
  sort: "m8 4-3 3-3-3M5 4v16m11 0 3-3 3 3M19 4v16",
  tree: "M4 4v12a2 2 0 0 0 2 2h6M4 10h8M12 4h8M12 10h8M12 18h8",
  timeline: "M4 3v18M8 5h9v4H8zM12 13h9v4h-9z",
  graph: "M5 5h4v4H5zM15 15h4v4h-4zM9 7h8v8M7 9v8h8",
  prompt: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  book: "M12 5c-4-2-7-2-10-1v15c3-1 6-1 10 1m0-15c4-2 7-2 10-1v15c-3-1-6-1-10 1V5",
  file: "M14 2H4v20h16V8zM14 2v6h6",
  model: "M4 8h16v12H4zM9 12v2M15 12v2M9 17h6M12 8V3M10 3h4M1 12h3M20 12h3",
  tool: "M14.7 6.3a5 5 0 0 0-6.4 6.4L2 19l3 3 6.3-6.3a5 5 0 0 0 6.4-6.4l-3 3-3-3z",
  error: "m12 3 10 18H2zM12 9v4M12 17h.01",
  play: "m7 4 14 8-14 8z",
  stop: "M5 5h14v14H5z",
  native: "m13 2-9 12h7l-1 8 10-13h-7z",
  braces: "M8 3H6v6l-3 3 3 3v6h2M16 3h2v6l3 3-3 3v6h-2",
} as const;

export type IconName = keyof typeof paths;
export const EVENT_ICON: Record<EventKind, IconName> = {
  session_start: "play", session_end: "stop", prompt: "prompt", search: "search",
  load: "book", read_file: "file", native_skill: "native", llm_call: "model",
  tool_call: "tool", error: "error", skill_request: "braces",
};

export function Icon({ name, class: className = "" }: { readonly name: IconName; readonly class?: string }) {
  return <svg class={`pe-icon ${className}`} width="14" height="14" viewBox="0 0 24 24"
    aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"><path d={paths[name]} /></svg>;
}
