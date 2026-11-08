import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Route, View } from "../state";
import { Icon, type IconName } from "./icons";

export const DESTINATIONS: readonly { view: View; label: string; icon: IconName; group: string }[] = [
  { view: "sessions", label: "세션", icon: "sessions", group: "관찰" },
  { view: "dashboard", label: "대시보드", icon: "dashboard", group: "분석" },
  { view: "evaluation", label: "검색 평가", icon: "graph", group: "분석" },
  { view: "flow", label: "흐름", icon: "flow", group: "분석" },
  { view: "workspaces", label: "작업 공간", icon: "workspaces", group: "분석" },
  { view: "heatmap", label: "활동", icon: "activity", group: "분석" },
];

export function destination(route: Route, view: View): Route {
  return { ...route, view, sessionId: undefined, flowId: undefined, peek: undefined, event: undefined };
}

export function CommandJump({ route, navigate, close }: {
  readonly route: Route; readonly navigate: (next: Route) => void; readonly close: () => void;
}) {
  const [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLElement>(null);
  const choices = DESTINATIONS.filter(item => item.label.includes(query.trim()));
  useLayoutEffect(() => { input.current?.focus(); }, []);
  const go = () => {
    const item = choices[active];
    if (item) { close(); navigate(destination(route, item.view)); }
  };
  return <div class="pe-overlay" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section class="pe-command" role="dialog" aria-modal="true" aria-labelledby="pe-command-title" ref={dialog}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input,button:not([tabindex="-1"])') ?? []);
          const first = nodes[0], last = nodes.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div class="pe-command__head"><h2 id="pe-command-title">화면 이동</h2>
        <button class="pe-button pe-icon-button" aria-label="화면 이동 닫기" onClick={close}><Icon name="close" /></button></div>
      <label class="sr-only" for="pe-command-input">이동할 화면</label>
      <input id="pe-command-input" ref={input} role="combobox" aria-expanded="true" aria-controls="pe-command-list"
        aria-autocomplete="list" aria-activedescendant={choices[active] ? `pe-command-${choices[active].view}` : undefined}
        value={query} placeholder="화면 이름으로 찾기" onInput={event => { setQuery(event.currentTarget.value); setActive(0); }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (choices.length) setActive(index => (index + (event.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length);
          } else if (event.key === "Enter") { event.preventDefault(); go(); }
        }} />
      <div id="pe-command-list" role="listbox" aria-label="화면">
        {choices.map((item, index) => <button key={item.view} id={`pe-command-${item.view}`} role="option" tabIndex={-1}
          class="pe-button" aria-selected={active === index} onPointerMove={() => setActive(index)}
          onClick={() => { close(); navigate(destination(route, item.view)); }}><Icon name={item.icon} />{item.label}</button>)}
      </div>
      {!choices.length && <p role="status">일치하는 화면이 없습니다.</p>}
      <p class="pe-command__help">화면만 이동합니다. 위아래 방향키로 선택하고 엔터로 이동합니다.</p>
    </section>
  </div>;
}
