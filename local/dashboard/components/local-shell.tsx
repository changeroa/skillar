import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { buildHash, type LiveInfo, type Route } from "../state";
import { consoleStyles } from "./console-style";
import { CommandJump, DESTINATIONS, destination } from "./command-jump";
import { Icon } from "./icons";
import { useNarrow } from "./use-narrow";
import { ConsoleSheet } from "./console-sheet";

const LIVE_TEXT = { connecting: "연결 중", live: "연결됨", paused: "일시 중지", offline: "연결 끊김", fixtures: "예시 기록" };
function Wordmark({ href }: { readonly href: string }) {
  return <a class="brand" href={href} aria-label="skillar 세션">
    <svg viewBox="0 0 500 100" role="img" aria-label="skillar" focusable="false"><title>skillar</title>
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
  </a>;
}

export function LocalShell({ route, navigate, live, embedded, automation, children }: {
  readonly route: Route; readonly navigate: (next: Route) => void; readonly live: LiveInfo;
  readonly embedded: boolean; readonly automation: ComponentChildren; readonly children: ComponentChildren;
}) {
  consoleStyles();
  const [open, setOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const narrow = useNarrow();
  const trigger = useRef<HTMLButtonElement>(null), returnFocus = useRef<HTMLElement | null>(null);
  const close = () => { setOpen(false); returnFocus.current?.focus(); };
  useEffect(() => {
    if (embedded) return;
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger.current;
        setOpen(value => !value);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [embedded]);
  if (embedded) return <>{children}</>;
  const active = route.view === "trace" ? "sessions" : route.view === "workspace" ? "workspaces" : route.view;
  const label = DESTINATIONS.find(item => item.view === active)?.label ?? "페이지를 찾을 수 없습니다";
  const source = api.mode === "fixtures" ? "예시 기록" : "이 기기";
  const sourceInfo = <div class="pe-source"><strong>{source}</strong>
    <span class={`live live--${live.state}`} role="status"><span class="live__dot" aria-hidden="true" />{LIVE_TEXT[live.state]}</span></div>;
  const links = (mobile: boolean, inDrawer = false) => DESTINATIONS.map((item, index) => <span key={item.view}>
    {!mobile && (index === 0 || index === 1) && <p class="pe-nav__group">{item.group}</p>}
    <a id={mobile || inDrawer ? undefined : `skillar-local-tab-${item.view}`} class="tab"
      href={buildHash(destination(route, item.view))} aria-current={active === item.view ? "page" : undefined}>
      <Icon name={item.icon} />{item.label}</a>
  </span>);
  return <div class="pe-shell">
    <aside id={narrow ? undefined : "app-navigation"} class="pe-sidebar" aria-label="로컬 대시보드">
      <Wordmark href={buildHash(destination(route, "sessions"))} />
      <nav class="pe-nav tabs local-tabs" aria-label="주요 화면">{links(false)}</nav>
      <div class="pe-sidebar__foot">{sourceInfo}
        {automation}<a class="pe-button" href="https://skillar.sh">skillar.sh 열기<Icon name="external" /></a>
      </div>
    </aside>
    <div class="pe-body"><header class="pe-topbar app-topbar">
      <button class="pe-button pe-source-toggle" aria-label="출처와 탐색 메뉴" aria-haspopup="dialog"
        aria-expanded={drawer} aria-controls="pe-source-drawer" onClick={() => setDrawer(true)}><Icon name="columns" /></button>
      <nav class="pe-breadcrumb" aria-label="경로"><a href={buildHash(destination(route, "sessions"))}>{source}</a>
        <Icon name="chevron" /><a href={buildHash(destination(route, active))}>{label}</a>
        {(route.sessionId || route.flowId) && <><Icon name="chevron" /><code title={route.sessionId ?? route.flowId}>{route.sessionId ?? route.flowId}</code></>}
      </nav>
      <button class="pe-button pe-jump" ref={trigger} aria-haspopup="dialog" onClick={() => {
        returnFocus.current = trigger.current; setOpen(true);
      }}><Icon name="search" />이동… <kbd>⌘K</kbd></button>
    </header>
      <nav id={narrow ? "app-navigation" : undefined} class="pe-mobile-nav tabs local-tabs" aria-label="주요 화면">{links(true)}</nav>
      {children}
    </div>
    {open && <CommandJump route={route} navigate={navigate} close={close} />}
    {narrow && drawer && <ConsoleSheet id="pe-source-drawer" title="출처와 탐색" close={() => setDrawer(false)}>
      {sourceInfo}
      {automation}
      <a class="pe-button" href="https://skillar.sh">skillar.sh 열기<Icon name="external" /></a>
      <nav class="pe-nav" aria-label="메뉴 화면" onClick={event => {
        if (event.target instanceof Element && event.target.closest("a")) setDrawer(false);
      }}>{links(false, true)}</nav>
    </ConsoleSheet>}
  </div>;
}
