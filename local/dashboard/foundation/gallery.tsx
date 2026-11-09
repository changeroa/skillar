import { render } from "preact";
import { useState } from "preact/hooks";
import { ControlsGallery } from "./controls-gallery";
import { DemoControls } from "./demo-controls";

const sizes = ["xs", "sm", "base", "lg", "xl", "2xl"] as const;
const surfaces = ["header", "sidebar-background", "background", "card", "modal", "popover", "surface-code"] as const;
const states = ["default", "hover", "focus-visible", "active", "disabled", "loading", "error", "empty", "selected"] as const;

function Check() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m5 12 4 4L19 6" />
  </svg>;
}

function Gallery() {
  const [theme, setTheme] = useState(document.documentElement.dataset["theme"] ?? "system");
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState(true);
  return <main class="lf-gallery" id="gallery" data-ready="true">
    <header class="lf-gallery__header">
      <div>
        <p class="lf-gallery__eyebrow">skillar / shared UI</p>
        <h1>컴포넌트 상태 갤러리</h1>
        <p>공용 토큰과 상태 검증용입니다. 제품 화면은 단계별로 적용합니다.</p>
      </div>
      <label class="lf-gallery__theme">테마
        <select value={theme} onChange={event => {
          const value = event.currentTarget.value;
          document.documentElement.dataset["theme"] = value;
          setTheme(value);
        }}>
          <option value="system">시스템</option>
          <option value="light">라이트</option>
          <option value="dark">다크</option>
        </select>
      </label>
    </header>

    <ControlsGallery />
    <section aria-labelledby="surface-title" data-component="surfaces">
      <h2 id="surface-title">표면 계층</h2>
      <div class="lf-gallery__grid">
        {surfaces.map(name => <div key={name} class="lf-gallery__surface" data-state={name}
          style={{ background: `var(--lf-${name})` }}>
          <code>{name}</code><span>같은 역할, 두 가지 테마</span>
        </div>)}
      </div>
    </section>

    <section aria-labelledby="status-title" data-component="status">
      <h2 id="status-title">상태 색상</h2>
      <p>원본 OKLCH 색상과 투명도를 유지합니다.</p>
      <div class="lf-gallery__cluster">
        {([{ hue: "green", label: "완료" }, { hue: "yellow", label: "확인 필요" },
          { hue: "red", label: "실패" }] as const).map(({ hue, label }) =>
          <span key={hue} data-state={hue} class="lf-gallery__status"
            style={{ color: `var(--lf-dark-${hue})`, background: `var(--lf-light-${hue})` }}>
            <Check /><span style={{ color: "var(--lf-foreground)" }}>{label}</span>
          </span>)}
      </div>
    </section>

    <section aria-labelledby="control-title" data-component="control">
      <h2 id="control-title">컨트롤 크기와 상태</h2>
      <p>마우스 32px / 터치·폰 44px. Hover, focus, active는 실제 입력으로 확인합니다.</p>
      <div class="lf-gallery__grid">
        {states.map(state => <div key={state} class="lf-gallery__specimen">
          <label for={`probe-${state}`}>{state}</label>
          {state === "empty" || state === "error"
            ? <input id={`probe-${state}`} class="lf-gallery__control" data-state={state}
              aria-invalid={state === "error" ? "true" : undefined}
              aria-describedby={state === "error" ? "probe-error-help" : undefined}
              placeholder="스킬 이름" defaultValue={state === "error" ? " " : ""} />
            : <button id={`probe-${state}`} type="button" class="lf-gallery__control"
              data-state={state} disabled={state === "disabled" || state === "loading"}
              aria-busy={state === "loading" ? "true" : undefined}
              aria-pressed={state === "selected" ? selected : undefined}
              onClick={() => state === "selected" ? setSelected(value => !value) : setCount(value => value + 1)}>
              {state === "selected" && selected ? <Check /> : null}
              {state === "loading" ? "불러오는 중" : state === "selected" ? "선택" : "확인"}
            </button>}
          {state === "error" ? <span id="probe-error-help">이름을 입력하세요.</span> : null}
        </div>)}
      </div>
      <output aria-live="polite" id="probe-result">확인 {count}회</output>
    </section>

    <section aria-labelledby="type-title" data-component="type">
      <h2 id="type-title">타이포그래피</h2>
      <div class="lf-gallery__grid">
        {sizes.map(size => <div key={size} class="lf-gallery__specimen">
          <code>text-{size}</code>
          <span data-state={size} style={{ fontSize: `var(--lf-text-${size})`,
            lineHeight: `var(--lf-leading-${size})` }}>스킬을 읽고 기록합니다</span>
        </div>)}
      </div>
    </section>

    <section aria-labelledby="radius-title" data-component="radius">
      <h2 id="radius-title">모서리</h2>
      <div class="lf-gallery__cluster">
        {["lg", "md", "sm"].map(size => <div key={size} data-state={size}
          class="lf-gallery__radius" style={{ borderRadius: `var(--lf-radius-${size})` }}>
          <code>radius-{size}</code>
        </div>)}
      </div>
    </section>
    <footer>합성 데이터 · foundation probes · <a href="/NOTICE">오픈소스 고지</a></footer>
  </main>;
}

export function mountGallery(root: HTMLElement): void {
  const theme = new URLSearchParams(location.search).get("theme");
  if (theme === "light" || theme === "dark" || theme === "system") {
    document.documentElement.dataset["theme"] = theme;
  }
  render(new URLSearchParams(location.search).has("demoControl") ? <DemoControls /> : <Gallery />, root);
}
