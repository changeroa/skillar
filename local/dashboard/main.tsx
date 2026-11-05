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

const LIVE_TEXT: Record<LiveState, string> = { connecting: "연결 중", live: "연결됨", paused: "일시 중지", offline: "연결 끊김", fixtures: "예시 기록" };

const dateTime = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

type Chip = { key: FilterKey; label: string; value: string };

function chipsFor(filter: Filter): Chip[] {
  const chips: Chip[] = [];
  for (const key of FILTER_KEYS) {
    const value = filter[key];
    if (value === undefined) continue;
    switch (key) {
      case "from": chips.push({ key, label: "시작", value: dateTime.format(value as number) }); break;
      case "to": chips.push({ key, label: "종료", value: dateTime.format(value as number) }); break;
      case "runtime": chips.push({ key, label: "실행 환경", value: filter.runtime!.map((r) => RUNTIME_LABEL[r]).join(", ") }); break;
      case "skill": chips.push({ key, label: "스킬", value: filter.skill!.map(skillName).join(", ") }); break;
      case "searchStatus": chips.push({ key, label: "검색 상태", value: filter.searchStatus!.map(s => STATE_LABEL[s]).join(", ") }); break;
      case "loadStatus": chips.push({ key, label: "읽기 상태", value: filter.loadStatus!.map(s => STATE_LABEL[s]).join(", ") }); break;
      case "searchResult": chips.push({ key, label: "검색 결과", value: filter.searchResult!.map(result => result === "candidates_found" ? "후보 있음" : "후보 없음").join(", ") }); break;
      case "state": chips.push({ key, label: "상태", value: filter.state!.map((s) => STATE_LABEL[s]).join(", ") }); break;
      case "dow": chips.push({ key, label: "요일", value: DOW_LABEL[value as number] ?? String(value) }); break;
      case "hour": {
        const span = filter.hourSpan ?? 1;
        chips.push({ key, label: "시간", value: `${String(value).padStart(2, "0")}:00-${String(((value as number) + span) % 24).padStart(2, "0")}:00` });
        break;
      }
      case "hourSpan": break;
      case "q": chips.push({ key, label: "검색", value: String(value) }); break;
      case "automated": chips.push({ key, label: "자동 실행", value: value === "only" ? "만 보기" : "포함" }); break;
    }
  }
  return chips;
}

function FilterChips({ route, navigate }: { route: Route; navigate: (next: Route) => void }) {
  const chips = chipsFor(route.filter);
  if (!chips.length) return null;
  return (
    <div class="filters" aria-label="적용된 필터">
      {chips.map((chip) => (
        <span class="chip" key={chip.key}>
          <span class="chip__k">{chip.label}</span>
          <span class="chip__v" title={chip.value}>{chip.value}</span>
          <button type="button" class="chip__x" aria-label={`${chip.label} 필터 해제`} onClick={() => navigate({ ...route, filter: withoutFilterKey(route.filter, chip.key) })}>
            {"\u00d7"}
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" class="btn" onClick={() => navigate({ ...route, filter: {} })}>전체 해제</button>
      )}
    </div>
  );
}

export const AUTOMATED_EXPLAINER =
  "직접 시작하지 않은 세션입니다. Codex 대화 제목, herdr 패널 요약, 예약 작업, 메모리 검토·정리 작업, 요청문이나 스킬 활동이 없는 세션을 포함합니다. 표시를 켜기 전에는 모든 화면에서 숨깁니다.";

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
      {`자동 실행 세션 ${hidden}개 숨김 \u00b7 표시`}
    </button>
  );
}

const VIEW_LABEL: Record<View, string> = {
  sessions: "세션", trace: "세션", workspaces: "작업 공간", workspace: "작업 공간", flow: "흐름", heatmap: "활동", "not-found": "페이지를 찾을 수 없습니다",
};
const TABS: { view: View; label: string }[] = [
  { view: "sessions", label: VIEW_LABEL.sessions },
  { view: "flow", label: VIEW_LABEL.flow },
  { view: "workspaces", label: VIEW_LABEL.workspaces },
  { view: "heatmap", label: VIEW_LABEL.heatmap },
];

/** The tab a detail route belongs to, so opening a trace or a flow keeps its list tab marked current. */
export const TAB_OF: Record<View, View> = {
  sessions: "sessions", trace: "sessions", workspaces: "workspaces", workspace: "workspaces", flow: "flow", heatmap: "heatmap", "not-found": "not-found",
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
    if (header.querySelector('[role="tablist"]')?.contains(document.activeElement)) return;
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
  if (live.invalidated) return <p role="status">클라우드 활동 기록을 볼 수 없습니다. 다시 로그인하거나 출처를 선택해 주세요.</p>;
  return (
    <>
      <Header class="top local-top">
        <div class="wrap top__row">
          {!embedded && (
            <a class="brand" href={buildHash({ view: "sessions", filter: route.filter })}>
              {/* Canonical wordmark (site/public/wordmark-*.svg): geometry verbatim, fills through the brand role tokens. */}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 100" role="img" aria-label="skillar" focusable="false">
                <title>skillar</title>
                <g transform="translate(-9.25 1.99)">
                  <path class="brand__prompt" d="M0 31L19 50L0 69L7 76L33 50L7 24Z" transform="translate(16.5 0)" fill-rule="evenodd" />
                  <path class="brand__ink" d="M47 35C36 27 5 27 4 46C3 60 16 62 29 65C43 68 40 79 27 80C18 81 10 78 3 73L0 83C10 91 34 94 46 82C55 71 49 57 34 54L21 51C7 47 24 35 43 44Z" transform="translate(70 0)" fill-rule="evenodd" />
                  <path class="brand__ink" d="M3 8H15V54L39 31H55L28 57L57 89H41L15 61V89H3Z" transform="translate(131 0)" fill-rule="evenodd" />
                  <path class="brand__ink" d="M14 31H38V77H56V89H14V77H26V43H14Z" transform="translate(192 0)" fill-rule="evenodd" />
                  <circle class="brand__ink" cx="224" cy="13" r="7" />
                  <path class="brand__ink" d="M14 8H38V77H56V89H14V77H26V20H14Z" transform="translate(256 0)" fill-rule="evenodd" />
                  <path class="brand__ink" d="M14 8H38V77H56V89H14V77H26V20H14Z" transform="translate(320 0)" fill-rule="evenodd" />
                  <path class="brand__ink" d="M45 89H34V83C23 95 0 90 0 71C0 53 22 49 34 55V50C34 35 13 37 5 44L2 33C22 23 46 28 46 50V89ZM34 65C22 57 11 63 11 72C11 83 27 84 34 74Z" transform="translate(391.5 0)" fill-rule="evenodd" />
                  <path class="brand__ink" d="M3 31H15V41C23 29 35 27 44 31L41 43C27 39 15 48 15 62V89H3Z" transform="translate(458 0)" fill-rule="evenodd" />
                </g>
              </svg>
            </a>
          )}
          {!embedded && <a class="btn" href="https://skillar.sh">skillar.sh 열기</a>}
          <nav class="tabs local-tabs" role="tablist" aria-label="화면 선택" onKeyDown={(event) => {
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="tab"]'));
            const index = tabs.findIndex(tab => tab === event.target);
            let next: number;
            switch (event.key) {
              case "ArrowRight": next = (index + 1) % tabs.length; break;
              case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
              case "Home": next = 0; break;
              case "End": next = tabs.length - 1; break;
              default: return;
            }
            event.preventDefault();
            event.stopPropagation();
            for (const [tabIndex, tab] of tabs.entries()) tab.tabIndex = tabIndex === next ? 0 : -1;
            tabs[next]?.focus();
            tabs[next]?.click();
          }}>
            {TABS.map((tab) => (
              <a key={tab.view} id={`skillar-local-tab-${tab.view}`} role="tab" aria-controls="skillar-local-panel"
                aria-selected={activeTab === tab.view} tabIndex={activeTab === tab.view || activeTab === "not-found" ? 0 : -1}
                class="tab" href={buildHash({ view: tab.view, filter: route.filter })} aria-current={activeTab === tab.view ? "page" : undefined}>
                {tab.label}
              </a>
            ))}
          </nav>
          <div class="top__status">
            <span class={`live live--${live.state}`} role="status" aria-live="polite">
              <span class="live__dot" aria-hidden="true" />
              {LIVE_TEXT[live.state]}
            </span>
            <FilterChips route={route} navigate={navigate} />
            <AutomatedToggle route={route} navigate={navigate} live={live} />
          </div>
        </div>
        <div class="wrap"><p class="local-location" aria-label="현재 위치">
          <span>출처: {embedded ? "선택한 출처" : api.mode === "fixtures" ? "예시 기록" : "이 기기"}</span>
          {" · "}{VIEW_LABEL[activeTab]}{route.view === "trace" && <> › <code>{route.sessionId}</code></>}
          {route.view === "workspace" && <> › <code>{route.flowId}</code></>}
        </p></div>
      </Header>
      <Content class="page wrap"
        id={embedded ? "skillar-local-panel" : undefined}
        ref={(node: HTMLElement | null) => { contentRef.current = node; }}
        tabIndex={embedded ? -1 : undefined} role={embedded ? "tabpanel" : undefined}
        aria-label={embedded ? `${VIEW_LABEL[activeTab]} 기록` : undefined}>
        <div id={embedded ? undefined : "skillar-local-panel"} role={embedded || route.view === "not-found" ? undefined : "tabpanel"}
          aria-labelledby={embedded || route.view === "not-found" ? undefined : `skillar-local-tab-${activeTab}`}>
        {(route.view === "sessions" || route.view === "trace") && (
          <div class={route.view === "trace" ? "sessions-detail" : undefined}>
            <div class={route.view === "trace" ? "sessions-detail__list" : undefined}>
              <SessionsView {...props} detail={route.view === "trace"} />
            </div>
            {route.view === "trace" && <TraceView {...props} key={route.sessionId} />}
          </div>
        )}
        {route.view === "workspaces" && <WorkspacesView {...props} />}
        {route.view === "workspace" && <WorkspaceView {...props} />}
        {route.view === "flow" && <FlowView {...props} />}
        {route.view === "heatmap" && <HeatmapView {...props} />}
        {route.view === "not-found" && <section class="empty">
          {embedded ? <h2>페이지를 찾을 수 없습니다</h2> : <h1>페이지를 찾을 수 없습니다</h1>}
          <p>주소가 올바르지 않거나 더 이상 사용할 수 없는 화면입니다. 세션 목록에서 다시 시작하세요.</p>
          <a class="btn" href={buildHash({ view: "sessions", filter: route.filter })}>세션으로 돌아가기</a>
        </section>}
        </div>
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
