import { Icon } from "../../components/icons";
import type { ViewProps } from "../../state";

export function EventViewTabs({ route, navigate, prefix = "event" }: Pick<ViewProps, "route" | "navigate"> & { readonly prefix?: string }) {
  const tab = route.traceTab ?? "tree";
  return <div class="lf-tabs lf-tabs--underline">
    <div class="event-console__tabs" role="tablist" aria-label="이벤트 표시" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
      const index = tabs.findIndex(node => node === event.target);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
      tabs[next]?.focus(); tabs[next]?.click();
    }}>
      {(["tree", "timeline"] as const).map(value => <button key={value} id={`${prefix}-${value}-tab`} role="tab" class="pe-button"
        data-view={value} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} aria-controls={`${prefix}-tree-panel`}
        onClick={() => navigate({ ...route, traceTab: value })}><Icon name={value} />{value === "tree" ? "트리" : "타임라인"}</button>)}
      <button role="tab" class="pe-button" disabled aria-selected="false" aria-describedby={`${prefix}-graph-reason`}><Icon name="graph" />그래프</button>
    </div>
    <p id={`${prefix}-graph-reason`} class="pe-muted event-graph-reason">인과관계 기록이 없어 그래프를 표시하지 않습니다.</p>
  </div>;
}
