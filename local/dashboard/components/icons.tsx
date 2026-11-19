import { iconMarkup, iconNodes, type SkillarIcon } from "../../../shared/icons";
import type { EventKind } from "../../src/types.js";

// 예전 이름 → 공통 맵 이름. 같은 뜻은 모든 화면에서 같은 아이콘을 쓴다(inbox85).
const alias = {
  sessions: "clock",
  dashboard: "layout-grid",
  prompt: "user",
  book: "book-open",
  external: "external-link",
  chevron: "chevron-right",
  down: "chevron-down",
  close: "x",
  filter: "funnel",
} as const satisfies Record<string, SkillarIcon>;

type LegacyName = keyof typeof alias;
export type IconName = SkillarIcon | LegacyName;

export function resolveIcon(name: IconName): SkillarIcon {
  return (alias as Record<string, SkillarIcon>)[name] ?? (name as SkillarIcon);
}

export const EVENT_ICON: Record<EventKind, IconName> = {
  session_start: "play", session_end: "stop", prompt: "prompt", search: "search",
  load: "book", read_file: "file", native_skill: "native", llm_call: "model",
  tool_call: "tool", error: "error", skill_request: "braces",
};

export function Icon({ name, className = "", size = 14 }: { readonly name: IconName; readonly className?: string; readonly size?: number }) {
  return <svg className={`pe-icon ${className}`} width={size} height={size} viewBox="0 0 24 24"
    aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round"
    dangerouslySetInnerHTML={{ __html: iconMarkup(resolveIcon(name)) }} />;
}
