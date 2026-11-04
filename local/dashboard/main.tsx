import { render } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Filter } from "../src/types.js";
import { api, type LiveState, type SessionListRow } from "./api";
import {
  DOW_LABEL, FILTER_KEYS, RUNTIME_LABEL, STATE_LABEL, buildHash, parseHash, skillName, withoutFilterKey,
  type FilterKey, type LiveInfo, type Route, type View,
} from "./state";
import { FlowView } from "./views/flow";
import { HeatmapView } from "./views/heatmap";
import { SessionsView } from "./views/sessions";
import { TraceView } from "./views/trace";
import { WorkspaceView, WorkspacesView } from "./views/workspaces";

function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: Route) => {
    location.hash = buildHash(next);
  }, []);
  return [route, navigate];
}

function useLive(): LiveInfo & { invalidated?: boolean } {
  const [live, setLive] = useState<LiveInfo & { invalidated?: boolean }>({ state: "connecting", seq: 0 });
  useEffect(() => api.events({
    onState: (state: LiveState) => setLive((prev) => (prev.state === state ? prev : { ...prev, state })),
    onSession: (row: SessionListRow) => setLive((prev) => ({ ...prev, seq: prev.seq + 1, last: row })),
    onRefresh: () => setLive((prev) => ({ state: prev.state, seq: prev.seq + 1 })),
    onInvalidate: () => setLive({ state: "offline", seq: 0, invalidated: true }),
  }), []);
  return live;
}

const LIVE_TEXT: Record<LiveState, string> = { connecting: "connecting", live: "live", paused: "paused", offline: "offline", fixtures: "fixtures" };

const dateTime = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

type Chip = { key: FilterKey; label: string; value: string };

function chipsFor(filter: Filter): Chip[] {
  const chips: Chip[] = [];
  for (const key of FILTER_KEYS) {
    const value = filter[key];
    if (value === undefined) continue;
    switch (key) {
      case "from": chips.push({ key, label: "from", value: dateTime.format(value as number) }); break;
      case "to": chips.push({ key, label: "to", value: dateTime.format(value as number) }); break;
      case "runtime": chips.push({ key, label: "runtime", value: filter.runtime!.map((r) => RUNTIME_LABEL[r]).join(", ") }); break;
      case "skill": chips.push({ key, label: "skill", value: filter.skill!.map(skillName).join(", ") }); break;
      case "searchStatus": chips.push({ key, label: "search status", value: filter.searchStatus!.join(", ") }); break;
      case "loadStatus": chips.push({ key, label: "load status", value: filter.loadStatus!.join(", ") }); break;
      case "searchResult": chips.push({ key, label: "search result", value: filter.searchResult!.join(", ") }); break;
      case "state": chips.push({ key, label: "state", value: filter.state!.map((s) => STATE_LABEL[s]).join(", ") }); break;
      case "dow": chips.push({ key, label: "day", value: DOW_LABEL[value as number] ?? String(value) }); break;
      case "hour": {
        const span = filter.hourSpan ?? 1;
        chips.push({ key, label: "hour", value: `${String(value).padStart(2, "0")}:00-${String(((value as number) + span) % 24).padStart(2, "0")}:00` });
        break;
      }
      case "hourSpan": break;
      case "q": chips.push({ key, label: "search", value: String(value) }); break;
      case "automated": chips.push({ key, label: "automated", value: value === "only" ? "only" : "shown" }); break;
    }
  }
  return chips;
}

function FilterChips({ route, navigate }: { route: Route; navigate: (next: Route) => void }) {
  const chips = chipsFor(route.filter);
  if (!chips.length) return null;
  return (
    <div class="filters" aria-label="Active filters">
      {chips.map((chip) => (
        <span class="chip" key={chip.key}>
          <span class="chip__k">{chip.label}</span>
          <span class="chip__v" title={chip.value}>{chip.value}</span>
          <button type="button" class="chip__x" aria-label={`Remove ${chip.label} filter`} onClick={() => navigate({ ...route, filter: withoutFilterKey(route.filter, chip.key) })}>
            {"\u00d7"}
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" class="btn" onClick={() => navigate({ ...route, filter: {} })}>Clear</button>
      )}
    </div>
  );
}

export const AUTOMATED_EXPLAINER =
  "Sessions you did not start: Codex thread titles, Herdr pane recaps, scheduled jobs, memory reflection and dreaming runs, and sessions with no prompt or skill activity. Hidden from every view unless shown.";

function AutomatedToggle({ route, navigate, live }: { route: Route; navigate: (next: Route) => void; live: LiveInfo }) {
  const [hidden, setHidden] = useState(0);
  const { automated: _shown, ...base } = route.filter;
  const baseKey = buildHash({ view: "sessions", filter: base });
  useEffect(() => {
    let cancelled = false;
    api.stats(base).then((stats) => { if (!cancelled) setHidden(stats.automatedSessions ?? 0); }, () => { if (!cancelled) setHidden(0); });
    return () => { cancelled = true; };
  }, [baseKey, live.seq]);
  if (route.filter.automated !== undefined || hidden === 0) return null;
  return (
    <button type="button" class="btn" data-automated-toggle title={AUTOMATED_EXPLAINER}
      onClick={() => navigate({ ...route, filter: { ...route.filter, automated: "include" } })}>
      {`${hidden} automated ${hidden === 1 ? "session" : "sessions"} hidden \u00b7 Show`}
    </button>
  );
}

const TABS: { view: View; label: string }[] = [
  { view: "sessions", label: "Sessions" },
  { view: "workspaces", label: "Workspaces" },
  { view: "flow", label: "Flow" },
  { view: "heatmap", label: "Heatmap" },
];

/** The tab a detail route belongs to, so opening a trace or a flow keeps its list tab marked current. */
export const TAB_OF: Record<View, View> = {
  sessions: "sessions", trace: "sessions", workspaces: "workspaces", workspace: "workspaces", flow: "flow", heatmap: "heatmap",
};

export type AppOptions = { embedded?: boolean };
export function App({ embedded = false }: AppOptions = {}) {
  const [route, navigate] = useRoute();
  const live = useLive();
  const contentRef = useRef<HTMLElement | null>(null);
  const firstRoute = useRef(true);
  const activeTab: View = TAB_OF[route.view];
  const props = { route, navigate, live, embedded };
  const Header = embedded ? "div" : "header";
  const Content = embedded ? "div" : "main";
  useLayoutEffect(() => {
    if (!embedded) return;
    if (firstRoute.current) { firstRoute.current = false; return; }
    const content = contentRef.current;
    if (content === null) return;
    const header = content.previousElementSibling;
    if (header === null) return;
    content.style.scrollMarginTop = `${header.getBoundingClientRect().height}px`;
    content.scrollIntoView({ block: "start" });
    content.focus({ preventScroll: true });
  }, [embedded, route.view, route.sessionId, route.flowId]);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!embedded || content === null) return;
    const root = content.parentElement, toolbar = content.previousElementSibling;
    if (root === null || toolbar === null) return;
    const spacing = getComputedStyle(root);
    const inset = parseFloat(spacing.getPropertyValue("--s-6")), gap = parseFloat(spacing.getPropertyValue("--s-2"));
    let active: HTMLElement | null = null;
    const position = () => {
      const tip = active;
      if (tip === null) return;
      if (!tip.isConnected || !tip.matches(":hover, :focus-visible")) {
        tip.removeAttribute("data-tip-active");
        active = null;
        return;
      }
      const rect = tip.getBoundingClientRect(), clip = (tip.closest(".hm") ?? root).getBoundingClientRect();
      const outside = rect.right <= Math.max(0, clip.left) || rect.left >= Math.min(innerWidth, clip.right)
        || rect.bottom <= Math.max(0, clip.top) || rect.top >= Math.min(innerHeight, clip.bottom);
      tip.toggleAttribute("data-tip-offscreen", outside);
      if (outside) return;
      const style = getComputedStyle(tip, "::after"), width = parseFloat(style.width), height = parseFloat(style.height);
      const above = rect.top - gap - height;
      tip.style.setProperty("--tip-left", `${Math.max(inset, Math.min(rect.left, innerWidth - inset - width))}px`);
      tip.style.setProperty("--tip-top", `${Math.max(inset, Math.min(above >= inset ? above : rect.bottom + gap, innerHeight - inset - height))}px`);
    };
    const show = (event: Event) => {
      const tip = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
      if (!(tip instanceof HTMLElement) || !root.contains(tip)) return;
      if (active !== tip) active?.removeAttribute("data-tip-active");
      active = tip;
      active.setAttribute("data-tip-active", "");
      position();
    };
    const leave = (event: PointerEvent) => {
      const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest("[data-tip]") : null;
      const tip = next ?? root.querySelector("[data-tip]:focus-visible");
      if (!(tip instanceof HTMLElement) || !root.contains(tip)) {
        active?.removeAttribute("data-tip-active");
        active = null;
        return;
      }
      if (active !== tip) active?.removeAttribute("data-tip-active");
      active = tip;
      active.setAttribute("data-tip-active", "");
      position();
    };
    const measure = () => {
      root.style.setProperty("--embedded-toolbar-height", `${toolbar.getBoundingClientRect().height}px`);
      position();
    };
    const observer = new ResizeObserver(measure);
    const layoutRoot = root.parentElement ?? root;
    observer.observe(toolbar); observer.observe(layoutRoot); measure();
    const mutations = new MutationObserver(position);
    mutations.observe(layoutRoot, { childList: true, characterData: true, subtree: true });
    root.addEventListener("pointerover", show); root.addEventListener("focusin", show); root.addEventListener("pointerout", leave);
    addEventListener("scroll", position, true); addEventListener("resize", position);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      root.removeEventListener("pointerover", show); root.removeEventListener("focusin", show); root.removeEventListener("pointerout", leave);
      removeEventListener("scroll", position, true); removeEventListener("resize", position);
    };
  }, [embedded]);
  if (live.invalidated) return <p role="status">Cloud activity is unavailable. Sign in or select a source again.</p>;
  return (
    <>
      <Header class="top">
        <div class="wrap">
          <div class="top__row">
            {!embedded && <a class="brand" href={buildHash({ view: "sessions", filter: route.filter })}>skillar</a>}
            <span class={`live live--${live.state}`} role="status" aria-live="polite">
              <span class="live__dot" aria-hidden="true" />
              {LIVE_TEXT[live.state]}
            </span>
            <FilterChips route={route} navigate={navigate} />
            <AutomatedToggle route={route} navigate={navigate} live={live} />
          </div>
          <nav class="tabs" aria-label="Views">
            {TABS.map((tab) => (
              <a key={tab.view} class="tab" href={buildHash({ view: tab.view, filter: route.filter })} aria-current={activeTab === tab.view ? "page" : undefined}>
                {tab.label}
              </a>
            ))}
          </nav>
        </div>
      </Header>
      <Content class="page wrap"
        ref={(node: HTMLElement | null) => { contentRef.current = node; }}
        tabIndex={embedded ? -1 : undefined} role={embedded ? "region" : undefined}
        aria-label={embedded ? `${activeTab} snapshot` : undefined}>
        {route.view === "sessions" && <SessionsView {...props} />}
        {route.view === "trace" && <TraceView {...props} />}
        {route.view === "workspaces" && <WorkspacesView {...props} />}
        {route.view === "workspace" && <WorkspaceView {...props} />}
        {route.view === "flow" && <FlowView {...props} />}
        {route.view === "heatmap" && <HeatmapView {...props} />}
      </Content>
    </>
  );
}

export function mount(element: Element, options: AppOptions = {}): () => void {
  render(<App {...options} />, element);
  return () => render(null, element);
}
const el = typeof document === "undefined" ? null : document.getElementById("app");
if (el && api.mode !== "cloud") mount(el);
