import { Icon } from "../../components/icons";
import type { ViewProps } from "../../state";

export function EventViewTabs({ route, navigate, prefix = "event" }: Pick<ViewProps, "route" | "navigate"> & { readonly prefix?: string }) {
  const tab = route.traceTab ?? "tree";
  return <div className="lf-tabs">
    <div className="event-console__tabs" role="tablist" aria-label="이벤트 표시" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
      const index = tabs.findIndex(node => node === event.target);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
      tabs[next]?.focus(); tabs[next]?.click();
    }}>
      {(["tree", "timeline"] as const).map(value => <button key={value} id={`${prefix}-${value}-tab`} role="tab" className="pe-button"
        data-view={value} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} aria-controls={`${prefix}-tree-panel`}
        onClick={() => navigate({ ...route, traceTab: value })}><Icon name={value} />{value === "tree" ? "트리" : "타임라인"}</button>)}
    </div>
  </div>;
}
