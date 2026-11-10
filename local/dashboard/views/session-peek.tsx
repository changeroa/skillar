import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { installStyles } from "../charts/sankey";
import type { SessionListRow } from "../api";
import { CopyButton } from "../components/copy-button";
import { Icon } from "../components/icons";
import { useNarrow } from "../components/use-narrow";
import { buildHash, type ViewProps } from "../state";
import { TraceView } from "./trace";

export function SessionPeek({ route, navigate, live, rows }: ViewProps & { readonly rows: readonly SessionListRow[] }) {
  installStyles("session-peek", `
.session-peek{position:sticky;top:16px;align-self:start;display:flex;flex-direction:column;max-height:calc(100dvh - 32px);overflow:hidden;min-width:0;padding:0;border:1px solid var(--lf-border);background:var(--lf-modal);color:var(--lf-foreground);border-radius:0;box-shadow:var(--lf-shadow-peek);font:var(--lf-weight-regular) var(--lf-text-lg)/var(--lf-menu-leading) var(--lf-font-sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.session-peek__body{min-height:0;overflow:auto;overscroll-behavior:contain;padding:var(--lf-space-4)}
.session-peek__actions{display:flex;flex:none;align-items:center;gap:var(--lf-space-1);z-index:2;background:var(--lf-modal);padding:var(--lf-space-2);border-bottom:1px solid var(--lf-border)}
.session-peek__actions .pe-button{height:var(--lf-control-height);min-height:var(--lf-control-height);min-width:var(--lf-control-height);padding-block:0;border-color:var(--lf-border);border-radius:var(--lf-radius-md);background:var(--lf-modal);color:var(--lf-foreground)}
.session-peek__actions .pe-icon-button{width:var(--lf-control-height)}
.session-peek__actions .pe-button:hover{background:var(--lf-accent)}.session-peek__actions .pe-button:focus-visible{outline:var(--lf-focus-width) solid var(--lf-ring);outline-offset:var(--lf-focus-offset)}
.session-peek :is(.trace-event-row[aria-pressed=true],.event-console__tabs [aria-selected=true],.event-inspector__tabs [aria-selected=true]){box-shadow:none;background:var(--lf-accent)}
.session-peek :is(.trace-event-row[aria-pressed=true],.event-console__tabs [aria-selected=true],.event-inspector__tabs [aria-selected=true])::after{content:"";display:inline-block;flex:none;width:var(--lf-space-4);height:var(--lf-space-4);background:currentColor;mask:var(--lf-selection-check) center/contain no-repeat}
.session-peek__actions>a{margin-right:auto;font-size:12px}.session-peek__actions>span{font-size:12px}
.session-peek .trace__back{display:none}.session-peek .trace__console{display:block}.session-peek .trace__title{font-size:16px;overflow-wrap:anywhere}
.session-peek .trace__inspector{border:0;padding:0;margin:12px 0}.session-peek .trace__scope{display:none}
@media(max-width:1023px){.session-peek{position:fixed;inset:0;z-index:60;align-self:stretch;height:100dvh;max-height:100dvh;border:0}.session-peek__body{flex:1;padding-bottom:max(12px,env(safe-area-inset-bottom))}}
`);
  const closeButton = useRef<HTMLButtonElement>(null);
  const originId = useRef(route.peek);
  const origin = useRef<HTMLElement | null>(null);
  const narrow = useNarrow();
  const close = () => navigate({ ...route, peek: undefined, event: undefined });
  useLayoutEffect(() => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      const row = document.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(originId.current ?? "")}"] .rowlink`);
      if (row) row.focus({ preventScroll: true });
      else if (origin.current?.isConnected) origin.current.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [route]);
  const index = rows.findIndex(row => row.id === route.peek);
  const move = (offset: number) => {
    const row = rows[index + offset];
    if (row) navigate({ ...route, peek: row.id, event: undefined });
  };
  return <aside class="session-peek pe-console" data-pe-screen="sessions-peek" role="dialog" aria-modal={narrow ? true : undefined}
    aria-labelledby="session-peek-title" onKeyDown={event => {
      if (!narrow || event.key !== "Tab") return;
      const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),summary,[tabindex='0']"))
        .filter(node => node.getClientRects().length > 0);
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <h2 id="session-peek-title" class="sr-only">세션 미리보기</h2>
    <div class="session-peek__actions" aria-label="세션 미리보기 작업">
      <a class="pe-button" href={buildHash({ ...route, view: "trace", sessionId: route.peek, peek: undefined })}>전체 화면<Icon name="external" /></a>
      <span>{index < 0 ? "—" : index + 1}/{rows.length}</span>
      <button class="pe-button pe-icon-button" aria-label="이전 세션" disabled={index <= 0} onClick={() => move(-1)}><Icon name="previous" /></button>
      <button class="pe-button pe-icon-button" aria-label="다음 세션" disabled={index < 0 || index >= rows.length - 1} onClick={() => move(1)}><Icon name="next" /></button>
      <CopyButton value={route.peek ?? ""} />
      <button ref={closeButton} class={`pe-button${narrow ? "" : " pe-icon-button"}`} aria-label="세션 미리보기 닫기" onClick={close}><Icon name="close" />{narrow ? "닫기" : ""}</button>
    </div>
    <div class="session-peek__body">
      <TraceView key={route.peek} route={{ ...route, view: "trace", sessionId: route.peek }}
        navigate={next => navigate({ ...next, view: "sessions", sessionId: undefined, peek: route.peek })}
        live={live} embedded presentation="peek" />
    </div>
  </aside>;
}
