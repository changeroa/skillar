import type {ReactNode as ComponentChildren, RefObject} from "react";
import { useLayoutEffect, useRef } from "react";
import type { SkillSpan, TraceStep } from "../../../src/types.js";
import { CopyButton } from "../../components/copy-button";
import { Icon } from "../../components/icons";
import type { ViewProps } from "../../state";

export function EventInspector({ id, kind, title, value, selected, narrow, trigger, route, navigate, children }: Pick<ViewProps, "route" | "navigate"> & {
  readonly id: string; readonly kind: string; readonly title: string; readonly value: TraceStep | SkillSpan;
  readonly selected: boolean; readonly narrow: boolean; readonly trigger: RefObject<HTMLButtonElement | null>;
  readonly children: ComponentChildren;
}) {
  const panel = useRef<HTMLElement>(null);
  const open = selected && (!narrow || route.event !== undefined);
  const domId = encodeURIComponent(id);
  const close = () => navigate({ ...route, event: undefined });
  useLayoutEffect(() => {
    if (!open || !narrow) return;
    panel.current?.focus({ preventScroll: true });
    return () => { if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); };
  }, [open, narrow]);
  const digest = "detail" in value && value.kind === "load" && typeof value.detail.manifestDigest === "string" ? value.detail.manifestDigest : undefined;
  return <section className="event-inspector" id={`${domId}-inspector`} ref={panel} tabIndex={-1} hidden={!open}
    data-kind={kind} data-source-key={id} role={narrow ? "dialog" : "region"} aria-modal={narrow && open ? true : undefined}
    aria-label={`${title} 이벤트`} onKeyDown={event => {
      if (!narrow) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab") {
        const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],summary,[tabindex='0']"))
          .filter(node => node.getClientRects().length > 0);
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <header className="event-inspector__head"><strong>{title}</strong><CopyButton value={id} label="이벤트 선택 ID" />
      {narrow && <button className="pe-button" onClick={close}><Icon name="close" />이벤트 목록</button>}
    </header>
    {digest && <p className="event-inspector__digest">읽은 버전 <code data-read-digest>{digest}</code></p>}
    <div id={`${domId}-content`}>
      <div className="event-inspector__preview" data-source-key={id}>{children}</div>
    </div>
  </section>;
}
import { CodeBlock } from "../../foundation/viewers";
