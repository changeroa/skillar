# skillar 토큰 매핑: `--lf-*` ↔ Astryx

PR-2 (Astryx 디자인 시스템 재구축)의 토큰 이행 계획.
대상: `local/dashboard/foundation/tokens.css`의 `--lf-*` 249개와
`local/dashboard/design/skillar-theme`(Astryx neutral 포크)이 노출하는 Astryx 토큰 198개.

## 이행 전략

1. **테마가 값을 흡수**: 대응 관계가 있는 `--lf-*` 값은 skillar 테마의 Astryx 토큰 오버라이드로
   이동한다. Astryx 컴포넌트는 테마 토큰만 읽으므로, 테마에 기존 값을 싣는 것만으로
   기존 시각 언어(색·반경·타이포)를 유지한 채 컴포넌트를 교체할 수 있다.
2. **별칭 계층으로 점진 이행**: `tokens.css`의 `--lf-*` 정의를 `var(--color-*)` 등을 가리키는
   별칭으로 바꾸면 수백 곳의 사용처를 한 번에 고치지 않아도 된다. 사용처 정리는
   컴포넌트 슬라이스마다 따라간다.
3. **도메인 토큰은 유지**: 차트·observation·배지·배너 등 Astryx에 대응이 없는 토큰은
   `--lf-*` 그대로 Astryx 테마 위에 얹는 확장으로 남긴다.

## A. 직접 대응 — 값이 skillar 테마로 이동

### 표면·텍스트·테두리

| `--lf-*` | Astryx 토큰 | 비고 |
|---|---|---|
| `--lf-background` | `--color-background-body` | |
| `--lf-foreground` | `--color-text-primary` | |
| `--lf-foreground-secondary` | `--color-text-secondary` | |
| `--lf-foreground-tertiary` | `--color-text-disabled` | ⚠ 제안: disabled 용도 혼용 검토 (D-3) |
| `--lf-muted` / `--lf-surface-section` | `--color-background-muted` | |
| `--lf-surface-sunken` / `--lf-header` | `--color-background-surface` | |
| `--lf-card` | `--color-background-card` | |
| `--lf-popover` / `--lf-modal` | `--color-background-popover` | |
| `--lf-border` / `--lf-input` | `--color-border` | |
| `--lf-border-contrast` | `--color-border-emphasized` | |
| `--lf-muted-foreground` / `--lf-icon-foreground` | `--color-icon-secondary` | |
| `--lf-overlay-backdrop` | `--color-overlay` | hover/pressed는 `--color-overlay-hover/pressed` |
| `--lf-ring` | `--shadow-inset-selected` 계열 | ⚠ Astryx 포커스는 inset shadow 방식 (D-4) |

### 액센트·상태

| `--lf-*` | Astryx 토큰 | 비고 |
|---|---|---|
| (브랜드 #B4321C) | `--color-accent` / `--color-text-accent` | skillar 테마에 이미 반영. 다크 변형 #D9553A는 D-1 제안 |
| `--lf-destructive` | `--color-error` | |
| `--lf-destructive-foreground` | `--color-on-error` | |
| `--lf-status-error-fill` | `--color-error-muted` | |
| `--lf-status-error-ink` | `--color-on-error-muted` | |
| `--lf-status-error-border` | `--color-border-error` | |
| `--lf-status-warning-fill/border/ink` | `--color-warning-muted` / `--color-border-warning` / `--color-on-warning-muted` | |
| `--lf-muted-green` 계열 성공 표현 | `--color-success` / `--color-success-muted` / `--color-on-success-muted` | |

### 반경·그림자·타이포·모션

| `--lf-*` | Astryx 토큰 | 비고 |
|---|---|---|
| `--lf-radius-sm/md/lg` (4/6/8) | `--radius-inner` / `--radius-element` / `--radius-container` | |
| `--lf-shadow-modal` | `--shadow-high` | |
| `--lf-shadow-popover` | `--shadow-med` | |
| `--lf-widget-shadow` | `--shadow-low` | |
| `--lf-text-xs~2xl` + leading | `--font-size-*` / `--text-*-size/leading` | base 14px → `--text-body-size` |
| `--lf-weight-regular/medium/strong/bold` | `--text-*-weight` | |
| `--lf-font-sans` | `--font-family-body` | Figtree 로드 여부는 D-5 제안 |
| `--lf-font-mono` | `--font-family-code` | plexMono 유지 |
| `--lf-spinner-duration` | `--duration-medium` 계열 | |

### 구문 강조 (qlang/JSON)

| `--lf-*` | Astryx 토큰 |
|---|---|
| `--lf-json-value-string` | `--color-syntax-string` |
| `--lf-json-value-number` / `--lf-p1-json-value-number` | `--color-syntax-number` |
| `--lf-json-value-boolean` | `--color-syntax-constant` |
| `--lf-json-value-nullish` | `--color-syntax-comment` |
| `--lf-qlang-keyword` | `--color-syntax-keyword` |
| `--lf-qlang-field` | `--color-syntax-property` |
| `--lf-qlang-value` | `--color-syntax-string` |
| `--lf-qlang-number` | `--color-syntax-number` |

## B. 도메인 확장 — `--lf-*` 유지 (Astryx 대응 없음)

- **observation 타입 색** 33개 (`--lf-observation-{trace,span,generation,event,agent,evaluator,tool,chain,retriever,embedding,guardrail}{,-line,-fill}`)
- **차트** 17개 (`--lf-chart-1..8`, `--lf-chart-fill-1..8`, `--lf-chart-grid`, `--lf-color-1..5`, `--lf-chart-histogram-label-size`)
- **카테고리** 16개 (`--lf-category-*` 단색 + highlight/tint)
- **배지 triple** (`--lf-badge-{blue,red,yellow}-{fill,text,border}`, 높이 2개) — Astryx Badge 채택 시 재검토
- **배너 쌍** (`--lf-preview-banner-*`, `--lf-customer-data-banner-*`) — Astryx Banner/Callout 채택 시 재검토
- **레이아웃 치수** (`--lf-sidebar-*-width`, `--lf-topbar-height`, `--lf-command-*`, `--lf-dialog-*`, `--lf-sheet-width`, `--lf-menu-*`, `--lf-tooltip-width`, `--lf-control-*-height`, `--lf-badge-*-height`)
- **기타** (`--lf-find-match-*`, `--lf-selection-check`, `--lf-shortcut-*`, `--lf-viewer-*`, `--lf-metric-value-*`, `--lf-space-*` 스케일, `--lf-opacity-disabled`, `--lf-peek-shadow-*`, `--lf-confirm-*`, `--lf-toast-*`(Astryx Toaster 채택 전까지), `--lf-diff-added`, `--lf-muted-{blue,gray,magenta}`, `--lf-accent-{light,dark}-{green,blue}`, `--lf-light/dark-{red,yellow,green,blue,violet,teal}` 페어)

## C. 슬라이스에서 결정이 필요한 항목 (PR "제안" 섹션으로 이동)

- **D-1 다크 액센트 변형 #D9553A**: 원색 #B4321C는 near-black 배경 대비 3.22:1 → 부족. 변형은 5.01:1. 캡처 첨부 제안.
- **D-2 primary 버튼 의미 차이**: 기존 `--lf-primary`는 near-black 중립 버튼, Astryx primary는 액센트(브랜드 레드) 버튼. 기존 neutral primary는 Astryx secondary/outline으로 옮기고 primary를 브랜드 액센트로 쓸지 — 캡처 비교 제안.
- **D-3 foreground-tertiary → text-disabled 매핑**: 비활성 의미와 3차 텍스트 의미 혼용 위험.
- **D-4 포커스 표시 방식**: lf는 ring(`--lf-ring` + offset), Astryx는 inset shadow. 컴포넌트 교체 시 외관 차이 발생 — 캡처 제안.
- **D-5 Figtree 폰트**: 테마가 기대하는 서체. 현재 시스템 폰트 유지 vs Figtree 로드.
- **D-6 text 버튼 variant → ghost 매핑 여부**.
- **D-7 테마 dist 커밋 vs CI 빌드**.
- **D-8 lucide-react 버전 정합**: site ^1.74.0 / local ^1.75.0 — vite dedupe 적용 시 site 사본으로 통일.
