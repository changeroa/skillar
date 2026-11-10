# skillar Dashboard Design System

## Phase B widgets (PR-5)

The shared widget contract is the PR-5 section in `site/DESIGN.md`, including
measured chart fill/stroke channels and Callout dismissal paint. Local and
hosted galleries render the same `foundation/widgets/` primitives, preserving
32px mouse / 44px touch targets and visible keyboard focus.

## Phase B tables (PR-4)

The complete shared table contract is the PR-4 section in `site/DESIGN.md`.
`foundation/table/` owns table paint, sortable headers, row/checkbox selection,
column visibility, density, toolbar, facets and opt-in received-range pagination.
Local URL sort, columns, density and filters keep their existing names and
owners; the trace session-picker keyboard contract is unchanged. Existing
local all-columns-hidden state remains explicit. Local rows retain their
native peek links, while selected rows use neutral wash and a check glyph.
Phone rows keep the existing stacked presentation; document owns vertical
scroll. Shared controls are 32px mouse / 44px coarse-pointer or phone.
PR-1 native controls and PR-2 DropdownMenu own input and menu semantics.
No new accessibility debt or decorative motion is accepted.

## Phase B shell (PR-3)

The complete shared shell contract is the PR-3 section in `site/DESIGN.md`.
`foundation/shell/` owns Sidebar/NavGroup/NavItem, Topbar/PageHeader,
Breadcrumb, CommandPalette and Tabs. All interactive boxes are exactly
32px with mouse, 44px under coarse pointers or widths <=768px, overriding
Demo dimensions. Standalone local keeps document scroll ownership and its
source/status footer; embedded local installs no second shell or shortcut.
Hidden persistent tab panels retain disclosure state and URL ownership.
Native links remain links, not ARIA tabs. Existing brand artwork is unchanged.

## Phase B overlays (PR-2)

The complete overlay contract is the PR-2 section in `site/DESIGN.md`.
Shared `foundation/overlays/` provides Dialog, ConfirmDialog, Sheet,
DropdownMenu and Tooltip with native modality and WAI-ARIA keyboard behavior.
Paint uses the existing semantic tokens with named geometry/shadow/backdrop
tokens in `overlays/overlays.css`. Both galleries exercise these primitives.
Existing PeekPanel and ConsoleSheet change visuals only; their focus, URL,
dirty-state and responsive modality contracts remain owned by existing code.

## Phase B basic controls (PR-1)

The real Demo amendment in `site/DESIGN.md` supersedes pinned-primitive
defaults: inset Button/IconButton/Select rings; mono search-adorned fields;
Demo Beta/chip palettes; compact uppercase status; table/header Tag variants;
regular muted inline links; no invented selected Button wash. Input/SearchInput deliberately keep a visible
2px primary-accent keyboard ring with a 2px gap, plus CanvasText outlines in forced
colors: the owner approved this accessibility difference from the Demo.
Named Demo captures document any added tokens. Comparison hosts may choose public
variants and labels, never primitive CSS overrides.

Keep the owner-approved 32px desktop / 44px touch decisions, native Select
popup, native Checkbox and WAI-ARIA keyboard/form behavior. Report those
exceptions explicitly. Different live content uses computed-style plus
side-by-side evidence; matching content also reports raw, unmasked diffs.

Parity repair: add the missing 10px `--lf-space-2h` prefix spacing token.
Font shorthands must preserve inherited `rlig`/`calt`. Native mixed semantics
remain, with the pinned Check indicator. Status error uses upstream dark-red
ink, including its known light-theme contrast debt; exact reference parity is
the owner's current requirement. Native Select keeps its native popup, with
12px trigger padding and the same visible trailing indicator.
The Select's native control owns input, focus and options; a pointer-inert
value span paints the closed value without the browser clipping its line box.
TextLink follows the real Demo inline baseline geometry. Native focus ink
follows the document's color-scheme; rings use the existing ring tokens.

`foundation/controls/` owns the shared Button, IconButton, Badge, StatusBadge,
Tag, Input, SearchInput, native Select, Checkbox, Link, KeyboardShortcut,
Skeleton and CopyButton. Both dev galleries render this same Preact source;
existing product screens migrate separately. The complete basic-control
contract is the matching PR-1 section in `site/DESIGN.md`: PR-0 semantic
tokens, 32px desktop / 44px touch controls, native form and keyboard semantics,
explicit error descriptions, no custom overlay dependencies, and real
Langfuse reference provenance. Static badges/keyboard hints retain compact
geometry; interactive dismiss/clear/copy targets grow on touch.

Button's optional trailing glyph uses 4px spacing and tertiary ink; leading
gaps are primary 8px, ghost 4px, otherwise 6px. Comparison hosts match labels and
available widths without overriding primitive styles.

## Phase B foundation (PR-0, 2026-11-09)

This section supersedes the older geometry/type rules only for the new shared
foundation and future migrated primitives. Existing screens keep their layout
and interaction state until their scheduled migration.

Mono source fidelity: the shared mono token preserves upstream
`var(--font-plex-mono, plexMono), "plexMono Fallback"` before system fallbacks;
the unmodified Regular WOFF2 from the named public Demo resource is embedded
in the shared token CSS, with IBM Plex SIL OFL 1.1 in all shipped notices.
it does not download a font or change existing legacy mono variables.

The MIT source is `local/dashboard/foundation/tokens.css`, shared with site, derived
from Langfuse `69181812b87169df157841fce1314ec96ecd2c5a`,
`web/src/styles/globals.css`. Full colors use `--lf-*`, not the existing
brand/selection aliases. OKLCH values and alpha remain exact. Themes follow
`html[data-theme]` light/dark/system, with OS fallback when unset. Dark header,
sidebar, canvas, card, modal and popover are 2/4/6/7.5/9/12% lightness.

New control boxes are **32px desktop**, **44px visual height** at <=768px OR
`(pointer: coarse)`; small is 28px/44px. Typography is system sans/mono,
400/600, text-xs/sm/base/lg/xl/2xl = 12/13/14/16/20/22px; line heights
18/20/21/21.6/26/27.5px. Body `text-sm` is **13px/20px**. Radius lg/md/sm
is 8/6/4px. Spacing is 2/4/6/8/12/16/20/24/32/48/64px, border 1px, focus
2px with 2px offset. The owner-approved density overrides the old 14px minimum
for migrated primitives, not every existing page.

`npm run dev:dashboard` serves the real app with fixtures and `/__gallery.html`.
The dev-only gallery reuses the site's shared Preact foundation specimens:
surfaces, status pairs, type/radius scales and metric probes in default,
hover/focus-visible/active, disabled/busy, invalid/empty and selected states.
This is the foundation showcase, not a claim that PR-1 components are complete.
Document scroll owns the page; intrinsic grids become one column without
horizontal overflow. Spatial reference: StyleGallery
[ram-grid](https://github.com/changeroa/StyleGallery/blob/main/patterns/grid-repetition/ram-grid.md).

Native labels, keyboard rings, textual status with SVG glyphs and neutral
selected wash/check remain required. No motion is added. Reference-only faint
color swatches do not relax contrast requirements for readable UI. Existing
status specimen labels use neutral foreground; their glyphs retain the exact
status foregrounds (the original light red text pair is only 3.15:1). Existing
dark `--ok/--warn/--bad` consume exact shared green/yellow/red foregrounds,
including the hosted embed through site aliases; light aliases stay unchanged.
URL, draft, keyed disclosure and renderer ownership contracts are untouched.

Source notices ship in `local/NOTICE` and `dist/dashboard/NOTICE`. Reusable
capture/diff evidence lives under `scripts/uxb/`. Missing upstream captures or
independent reviewers must be reported as unverified gates, never self-approved.

## Approved local analysis P-F (2026-11-05)

The analysis screens reuse the P-E shell, controls, sheet and typography.
The document owns vertical scrolling; charts and dense tables own labelled
horizontal scroll regions. Workspace peek is a 560px right pane on desktop
and a full-screen sheet below 1024px; its body alone scrolls.
Number tiles use a four-column grid, two columns on phones. Dashboard
widgets use a three-column grid, with the request chart spanning two columns;
phones stack widgets in the wireframe order. Tiles are bordered data regions,
not navigation cards. All text uses existing ink roles and controls are 44px.

AnalysisToolbar preserves period, runtime and automation in the hash URL.
Workspace queries support only period and automation; unsupported session
filters are not displayed as applied. Tables preserve sort and selection in
the URL, expose aria-sort, and sort only the received range. Facet counts
describe that same received range, not a server-wide count.
Reports retain their fetched conditions while pending selections are shown
separately; failed refreshes keep their old labelled result with retry.
Standalone reports refresh manually; embedded reports invalidate on live.seq.

Dashboard order follows local/analysis.html: number tiles, request series,
Top-N reads, search-result distribution, session-length histogram, read
latency, activity heatmap and flow preview. Every aggregate names its source and sample
coverage. Requests are normalized by requestRecords, not raw event count.
Actual successful reads and search candidates remain separate. Read latency,
skill-span and outcome quality remain 미측정 with reasons, never fake zeroes.
All bar groups use a shared baseline and scale, equal bar widths, above-bar
values and below-group labels; zero is a labelled 1px tick. No first-read flow.
Local date labels, daily buckets, ISO weeks and period presets use Asia/Seoul
even when the browser timezone is UTC. Weekly reads are rebuilt from timestamped
successful requests because the server's weekly aggregate has UTC boundaries.
Coverage stays visible, and failed trace retrieval is 미측정 rather than zero.
Planning and review tracking codes never appear in user-facing copy.

Flow charts retain the baseline pixels-per-value scale and fit all three
columns at phone widths. Grow vertical spacing, never compress the bands or
force a wider horizontal scroll canvas, to accommodate accessible targets.
Each route handle and actionable node owns a real 44px square. Route targets
are transparent and avoid measured label boxes, node bars and other targets;
their count markers never cover a node label or count. Focus rings have clearance.
Keyboard order follows source-column routes, then node columns. Non-actions
are not Tab stops. Back from a session drill-down restores the chart opener.
Visible names and counts, including truncation, remain in accessible names;
full recorded labels remain available. Ingest diagnostics explain failures in
Korean and retain exact codes only inside native technical disclosures.

## Approved local shell and sessions P-E (2026-11-05)

Gate revision: overlays use a bounded `100dvh` scroll-body shell. The peek
action bar stays outside `.session-peek__body`, which alone owns vertical
scroll; short sessions still fill the mobile viewport. Mobile navigation
exposes a drawer containing current-source status and the hosted-site link.
The mobile histogram stays visible above the rows with the same R7 geometry.
Mobile filters are a full-screen sheet with fixed header/actions, a scrolling
facet body, Escape dismissal, focus containment and trigger focus restoration.
Target-size safeguards apply to `.page` and `.pe-content`, including 44px-wide
back links and 44px heatmap cells. Peek includes Tree/Timeline/disabled Graph.
Gantt zoom and overview share the actual session axis: zoom changes its visible
window, the overview locates that window, and reset restores the full range.
Read-only JSON uses native nested disclosures, line numbers and full-value copy;
folding never changes the underlying captured event or its immutable key.

This section supersedes the older shell, sessions and trace compositions below.
The owner-approved v2 references are
`research/wireframes/local/{sessions-table,sessions-peek,session-detail}.html`
and their desktop/phone PNGs in the `skillar-ux-overhaul` lane evidence.
`research/langfuse/components.md` and `structure-rules.md` R1-R7 define semantics.
The local app is independent of the hosted shell: no `site/`, daemon or API changes.

Use the existing Evidence Console light/dark palette and system font stacks.
New layout tokens: sidebar 220px, facet rail 232px, peek 560px, top bar 48px,
desktop gutter 16px, phone gutter 12px, split gap 16px. UI/body metadata is
14px, small auxiliary labels 12px, title 22px, type icons 16px. The spacing
scale remains 4/8/12/16/20/24/32/48/64. Controls retain 44px targets and visible
keyboard focus; compact/normal/comfortable rows are 44/52/64px, with compact
two-line rows at phone widths. Data pills have a 10px radius and 22px height.
This approved component set replaces the older "no pills" rule for these views.

Shell: a persistent grouped sidebar (관찰: 세션; 분석: 대시보드, 흐름, 작업 공간,
활동), bottom current-source/live status and `skillar.sh 열기`. The top bar
contains source/location/item breadcrumb and a visible navigation-only `이동… ⌘K`
button. The palette is a labelled dialog: arrow selection, Enter navigation,
Escape dismissal and return to the trigger. At widths below 1024px use a compact
source/header and horizontally scrollable navigation, never primary-content overflow.
The existing embedded tablist remains a host-owned compatibility surface, with its
roving focus and resolved panel labels preserved.

Sessions structure, in order: title with one short subtitle; search/range/count/
column-density toolbar; applied filter pills; facet rail beside sessions/day histogram
and semantic dense table; attribution/count footer. Select/Text facets expose counts
in the loaded time/automation scope. Sorting is explicitly within the received range.
URL state retains search, filters, sort, columns/density and peek selection.
There is no 결과 table column. `읽은 스킬` is actual reads only; exposed
candidates are separate, never substituted for reads. Missing measurements stay
unknown and failures stay failures.

Histogram R7: derive counts from session `startedAt` and state the timezone/range.
All bars use the same numeric y-scale and baseline, equal widths and group spacing.
Zero counts are 1px ticks labelled `0`; value labels sit above and dates below.
The exported geometry must satisfy `y + height === baseline` for every bar.

Peek: keep the table visible at desktop widths, with action bar (full page,
previous, next, copy ID, close), summary pills, KV grid and typed event tree.
Below 1024px it becomes a full-screen sheet with a visible return action. Escape
closes it, preserves list URL state and restores focus to its row.

Detail: back link, session ID/copy and first-request disclosure, one wrapping
summary line, then tree/timeline beside selected-event inspector. Graph is disabled
with the missing-relationship-data reason. Gantt points use actual event offsets;
only explicitly bounded intervals become bars. No invented durations or causal edges.
Inspector supports preview/attributes and Formatted/Raw for the same event, full
captured content and ranked candidates. At phone widths an event inspector is a
sheet. Candidate relevance and later reads are observations, not a quality outcome.

CV-022 invariants remain mandatory: assign keys to the entire raw source trace
before filtering/grouping, carry those keyed records through every representation,
and use immutable activation-event member IDs for groups. Event inspector bodies
are the actual persistent keyed bodies, not disposable copies or hidden test-only
evidence. Selecting another event or receiving a report must not reset the surviving
event's native disclosures. Preserve all existing T6/T10 behavior tests.

Verification: R1-R7 and wireframe component-presence/order assertions, desktop and
phone in both color schemes, each local VQA manifest independently with unchanged
expectations, and no new failures relative to the recorded baseline. Public evidence
is one Langfuse demo / approved wireframe / before / after row for each of the three
screens, without annotations copied into product UI.

## Evidence Console V2 foundations (PR1)

Owner chose04 (Ev0CEN1JB875); lead authorized Phase C on2026-11-04. This visual contract supersedes earlier workshop/Linear color, typography, radius and target-size drawings below. Existing routing, auth, consent, command recovery, request outcomes, unknown values and all other behavior contracts remain unchanged. Approved source: /Users/iyen/.dori/state/lane-results/skillar-redesign/v2/sheets/04-evidence/DESIGN.md.

|Role|Light|Dark|
|---|---|---|
|bg|#FFFFFF|#171916|
|surface|#F3F5F2|#22261F|
|ink|#20231E|#F0F1E9|
|muted|#565C51|#B3BAAA|
|accent|#B4321C|#FF8F70|
|onAccent|#FFFFFF|#23110C|
|border|#7D8279|#7A8273|
|rule|#D9DDD6|#3C4336|
|success|#23603B|#8BD2A0|
|warn|#805000|#EAC477|
|error|#AC2045|#FF9CB4|

The exact07 Prompt SVG retains its own #1F201D/#F0F1E9 wordmark ink and vermilion exports. No artwork geometry changes. Code uses surface/ink/muted roles. UI edges use border; decorative separators use rule. No gradient, glow or elevated shadow. A static live dot retains its connection-state meaning; no pulse.

Typography: Helvetica Neue / Apple SD Gothic Neo / system-ui / sans-serif; mono ui-monospace / SF Mono / Menlo / Consolas. No fetched font. App title28, section22, subheading18, body/UI16, all metadata/code at least14px. Site long-form body18, landing display36–64 and section28–36 during incremental rollout; no decorative negative tracking. Korean body leading1.65, UI1.5, headings1.2–1.4.

Primitive geometry: 0px flat data boundaries, 2px controls/cards/tags; no pills. Buttons, inputs, selects, tabs and filter removal controls at least44px, including fold actions. Data-only badges/tags at least26px,14px text; do not imply a button target. Neutral row selection, accent underline for current navigation, 2px accent keyboard focus with2px offset. Hover and pressed states remain visible without fading text or moving the control. Tooltip is a flat bounded inverse surface, not a diffuse shadow.

Spacing follows existing4/8/12/16/20/24/32/48/64/96 scale. Native local dashboard content max1600px with20px phone/32px desktop gutters. Preserve document scroll owner, responsive table-to-card behavior, wrapping navigation and filter behavior. The hosted embed inherits the site's palette but keeps its own scoped styles and zero extra inner gutter. Segmented controls, back links, disclosures and heatmap cells retain44px targets in both renderers. Dense heatmaps scroll inside their grid, not the document. Native heatmap tooltips use scoped CSS anchors and fixed positioning to escape the grid scrollport, try the opposite side at viewport edges and hide when their anchor is offscreen. Hosted tooltips retain their existing viewport-position controller.

PR1 is foundations only: no session/search/skill/auth/landing behavior change. Existing page compositions are restyled in the subsequent approved PRs. site/src/skills/* is locked until lead confirms P14 merge; inherit base tokens there but do not edit its controls yet.

## Evidence Console V2 Sessions and Trace layout (PR2)

Approved reference: v2/sheets/04-evidence/home-light.html (the console: session list / event sequence / inspector) with its DESIGN.md. Touches `main.tsx`, `views/sessions.tsx`, `views/trace.tsx`, `components/requests.tsx` and `styles.css`. Where the AppShell, TabBar, SessionsToolbar, SessionsTable, TraceHeader, Timeline and AbstainBlock drawings further down differ from this block, this block wins; every route, hash, filter, live, eval and unknown-value contract stays as it is.

Tokens added: `--brand-ink` #1F201D / #F0F1E9 and `--brand-prompt` #B4321C / #FF8F70 (the exact light / dark wordmark export colors). They color the inline wordmark paths and nothing else.

Shell: `header.top > div.wrap.top__row` = `a.brand` (the canonical wordmark SVG inlined from site/public/wordmark-*.svg with its geometry verbatim, 120px wide, fills through `.brand__prompt` / `.brand__ink`), then `nav.tabs[aria-label=Views]`, then `div.top__status` (live indicator, filter chips, automated toggle) pushed to the end. One wrapping row at 640px and up; under 640px the tab row takes its own full-width line after brand and status. Tabs are 44px text links in muted ink with no box: hover is ink, current is ink at 600 with a 2px accent underline at 8px offset; `aria-current` and `TAB_OF` unchanged. The embed renders the same row without the brand.

Page title: `div.page-title` holds the view title (`h1`, `h2` when embedded) at 28px / 600 / 1.3 and a 16px muted lead, 32px above the content. Sessions: title "세션 사용 기록", lead "검색과 읽기 횟수는 요청 단위로 셉니다. 요청이 없었던 것과 결과를 알 수 없는 것은 다릅니다." (the former English dim sentence, same meaning). Trace: the back link, the first prompt (or the muted "(no prompt captured)", no italic) and the step counts as the lead.

Sessions: title, toolbar (controls, ids, names and aria names unchanged; 16px label on its own line, search field up to 25rem, selects at least 10rem, 24px below), then the table flat on the page in `div.sessions__frame` (horizontal scroll owner at tablet widths, no card): th 14px / 500 muted, cells 12px x 16px, first column flush left and last flush right, hairline rules under every row, hover wash. Under 640px the rows stay the named-area cards with 16px vertical padding and no inline padding. The attribution explanation (`p.usage`: unattributed counts, the "How attribution works" tooltip and the MCP attribution rates, text unchanged) moves below the table into `footer.sessions__foot`, 32px down behind a top rule.

Trace: `header.trace__head.page-title` then `div.trace__console` = `aside.trace__inspector` (260px right column at 960px and up, left rule, content at the top) beside `div.trace__events` (fluid, 24px stack). Inspector: h2 "세션 정보" (h3 embedded), the existing `dl.trace__meta` as one column (dt 14px muted, dd 16px ink, 16px apart; Runtime / Started / Duration / Attribution / Requests / Session unchanged, Duration states unchanged), then under a rule the h3 "확인 범위" with "검색과 읽기 기록은 요청 단위로 확인됩니다. 실제 적용과 작업 성공은 이 기록으로 확인되지 않습니다." Events: the existing callouts (unresolved loads, never consulted), h2 "이벤트 순서" with `ol.tl`, then the Search and load requests section flat behind a top rule (22px heading, 14px lead, reference table cells). Under 960px the console is one column: inspector first, then events; the inspector swaps its left rule for a top rule and its facts wrap as a cluster.

Timeline rows: `li.tl__step` is a grid `82px | minmax(0, 1fr) | 116px` (time | content | state) with 16px vertical padding and a bottom rule; `tl__head` is `display: contents` so its children sit in the grid. Time is HH:MM:SS over the +offset in 14px mono; the kind label is 18px / 600 ink; a skill span's name sits under its label. State words (`tl__tag`: native, skillar, failed, abstained) are plain 14px / 500 text in the state column, `--bad` for failed and abstained, muted otherwise; no box, no uppercase. Bodies: prompt text 16px ink, metadata lines 14px muted, the query and the abstain block (badge, hint, Save as eval case) on a surface block with no border; candidate rows unchanged except the invocation tag (14px mono, 26px, 0 radius, no uppercase). The rail and dots are retired: `tl__dot` is hidden, and a step's kind is read from its label, never from a color. Under 640px rows are `72px | minmax(0, 1fr)` and state words drop under the kind label.

Copy: all authored dashboard labels, accessible names, explanations, empty/error states and controls are plain Korean, per the owner's correction on PR74. Product/runtime names, recorded user content, code IDs, protocol tokens and machine status values stay exact. Existing shipped-copy test expectations follow the translated UI without weakening their behavior assertions. This supersedes the earlier English-label preservation rule.

Embedded trace navigation moves focus to its mounted heading. The trace panel is not the final focus target; heading and source-title outlines appear only for keyboard-visible focus. Capture navigation uses actual pointer events rather than synthetic DOM clicks that can retain keyboard modality.

At phone widths the request table becomes labeled rows with a 96px label column and a flexible value column. Column headers remain in the accessibility tree; operation, status, result/reason and skill values keep their original table semantics and wrap without squeezing individual letters into a vertical column. The same rule applies in the hosted embed.



Scope: `local/dashboard/**` (the Preact app served by the skillar daemon at `http://127.0.0.1:8799`).
Every color, size, and spacing value used by dashboard code must trace to a token here; the tokens
live as CSS custom properties in `styles.css` under the same names.

## 0. Research Log

- Embedded refs: shortlisted `linear.app`, `sentry`, `posthog` (data-dense dashboards) -> picked
  `taste-skill` (operational brief) + `layout-skill` (app shell) + `linear.app` as the Layer B token
  source, because the plan's mockups (`.senpi/html-pages/skillar 대시보드 목업*.html`,
  `skillar 라이브 활동 화면 목업*.html`) are near-black, card-based, achromatic with one accent and
  semantic status chips, which is Linear's luminance-stepping model. The mockups set visual
  direction only; the celebration ("처음 쓰임") card is dropped on purpose (user decision).
- Lazyweb: skipped - the plan supplies concrete mockups as the visual contract; no external
  research lane was budgeted for this executor.
- Imagen drafts: skipped - concrete mockups given; no generated concept needed.

## 1. Atmosphere & Identity

A quiet instrument panel for one person's skills. It reads like a log viewer that respects the
reader: dense rows, calm chrome, nothing animated unless it reports a live fact. Surfaces are
separated by luminance steps and hairline translucent borders, not by shadows or colored stripes.
The signature is restraint - one accent (indigo) used only for the live dot, the active tab, links,
and the keyboard focus ring; everything else is ink at alphas. Status (adoption state) is the only
other chroma, and it is semantic, never decorative. No streaks, badges, celebrations, or gimmicks.

## 2. Color

Light and dark values swap under `prefers-color-scheme: dark`. Washes are derived with
`color-mix()` from the ink and status colors so there is one ramp per role.

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Canvas | `--bg` | #f7f8f8 | #0f1011 | Page background |
| Surface | `--surface` | #ffffff | #151618 | Table, cards, header |
| Surface raised | `--surface-2` | #f3f4f5 | #1b1c1e | Monogram tiles, inputs, tooltip bg (inverted) |
| Ink | `--ink` | #15171a | #f7f8f8 | Primary text |
| Ink secondary | `--ink-2` | #5c6069 | #b4b9c2 | Body metadata, labels |
| Ink tertiary | `--ink-3` | #8a8f98 | #7f848d | Timestamps, dim text, placeholders |
| Line | `--line` | rgba(21,23,26,.08) | rgba(255,255,255,.08) | Hairline borders, dividers |
| Line strong | `--line-2` | rgba(21,23,26,.16) | rgba(255,255,255,.16) | Input borders, chip borders on hover |
| Wash hover | `--wash` | rgba(21,23,26,.04) | rgba(255,255,255,.04) | Row hover, ghost button hover |
| Wash active | `--wash-2` | rgba(21,23,26,.08) | rgba(255,255,255,.08) | Active tab, pressed, selected |
| Accent | `--accent` | #5e6ad2 | #7170ff | Live dot, active tab text, links |
| Accent hover | `--accent-2` | #4f5bc4 | #828fff | Link hover |
| Accent wash | `--accent-wash` | color-mix(accent 12%) | color-mix(accent 18%) | Live dot halo, focus ring halo |
| Status ok | `--ok` | #1f8f45 | #3ccb6a | `succeeded` (including `no_candidates`) |
| Status warn | `--warn` | #a8690f | #e0a84a | `in_progress` |
| Status bad | `--bad` | #c0392b | #ef6b6b | `failed`, ingest errors, offline dot |
| Status neutral | `--neutral` | #8a8f98 | #7f848d | `cancelled`, `unknown`, `not_attempted`, unattributed, paused live connection |

Rules
- Accent never marks state on a border. Selected / active / hover are `--wash` / `--wash-2`
  backgrounds plus ink; `:focus-visible` rings (`--accent`) are the only colored edge.
- Status colors appear only in state badges, the ingest error count, the live dot, and timeline
  step dots (kind colors, see TimelineStep): prompt `--ink`, search `--accent`, load / read_file
  `--ok` (read_file hollow), native_skill `--warn` (hollow), skill span `--ok` (hollow),
  error `--bad`, session_start / end `--neutral`. Candidate score bars use `--ok` when the
  candidate was loaded, otherwise ink at 35%.
- Step comparison badges carry status color because the spec declares an intent to compare against:
  matched `--ok`, partial / different `--warn`, no_skill_used / not_run `--neutral`. `--bad` is never
  used there: a deviation is feedback, not an error. Finding labels ("top result used", "native, no
  search") are descriptive, never judgements, so they render as neutral Tags with no status color.
- Never introduce a color outside this table; extend the table first.

## 3. Typography

| Level | Token | Size / Weight / LH | Usage |
|-------|-------|--------------------|-------|
| Title | `--t-title` | 15px / 600 / 1.3, tracking -0.01em | Brand wordmark, empty-state heading |
| Body | `--t-body` | 14px / 400 / 1.5 | Prompt text, empty-state copy |
| Small | `--t-sm` | 13px / 400 / 1.5 | Table cells, tabs, inputs, chips |
| Caption | `--t-cap` | 12px / 500 / 1.4 | Column headers, badges, meta |
| Micro | `--t-micro` | 11px / 600 / 1.2, tracking 0.02em | Monogram letters, counts |

Font stack
- Sans `--font-sans`: `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont,
  system-ui, "Apple SD Gothic Neo", "Segoe UI", Roboto, sans-serif` (system stack plus Pretendard
  when installed; never fetched from the network).
- Mono `--font-mono`: `ui-monospace, "SF Mono", Menlo, Consolas, monospace` for commands and
  session ids. Numbers use `font-variant-numeric: tabular-nums`.

Rules
- Korean text uses `word-break: keep-all` plus `overflow-wrap: anywhere` so words never split
  mid-syllable but unbroken URIs still wrap.
- Nothing below 11px; body copy never below 13px.

## 4. Spacing & Layout

Base unit 4px.

| Token | Value | Usage |
|-------|-------|-------|
| `--s-1` | 4px | Icon-to-label, chip inner gap |
| `--s-2` | 8px | Chip padding, cell inner gaps |
| `--s-3` | 12px | Cell padding, toolbar gaps |
| `--s-4` | 16px | Page gutter (mobile), card padding |
| `--s-5` | 20px | Section inner spacing |
| `--s-6` | 24px | Page gutter (desktop), block gaps |
| `--s-8` | 32px | Empty-state padding |
| `--s-12` | 48px | Empty-state vertical rhythm |

Layout
- Max content width `--max-w: 1180px`, centered; gutter `--s-4` under 640px, `--s-6` above.
- Shell = `sticky-header + document scroll`: the document owns vertical scroll; the header and tab
  bar are one sticky block at `top: 0`. No nested scroll regions in this todo's views.
- Breakpoint `--bp-sm: 640px`: the sessions table becomes a card list (`tr` -> grid card with
  named areas). Primary content never scrolls horizontally at 390px.
- Primitives used: `stack`, `cluster` (filter chips, skill chips), `content-limiter` (empty
  state, 48ch), `page-grid` (header / tabs / main).

## 5. Components

### AppShell (`main.tsx`)
- Structure: `header.top` (brand, live dot, filter chips) > `nav.tabs` > `main.page`.
- States: live dot `connecting` (neutral, no pulse), `live` (accent, one slow pulse), `offline`
  (bad), `fixtures` (accent, static, labelled "fixtures").
- Layout: page-grid, sticky header; `main` is a `stack` inside a `content-limiter` at `--max-w`.
- Motion: the live dot pulses at 2.4s ease-in-out (opacity + scale only); under
  `prefers-reduced-motion` it is static.

### TabBar
- Structure: `nav` > `a.tab` x4 (Sessions, Workspaces, Flow, Heatmap); hrefs keep the current filter
  query. A detail route marks its list tab current through `TAB_OF` (trace -> Sessions, workspace ->
  Workspaces).
- States: default `--ink-2`; hover `--wash`; active `--wash-2` + `--ink`; `focus-visible` ring.
- Accessibility: `aria-current="page"` on the active tab; 36px min target height.

### FilterChip
- Structure: `span.chip` > label (`--ink-3`) + value (`--ink`) + `button.chip__x` (remove).
- Variants: default, removable. Spacing: `--s-2` horizontal, `--s-1` inner gap; radius `--r-full`.
- States: hover `--line-2` border; `focus-visible` ring on the remove button.
- Accessibility: remove button has `aria-label="Remove <label> filter"`.

### SessionsToolbar (`views/sessions.tsx`)
- Structure: `form.toolbar` > search input (`q`) + runtime `select` + search status, load status and search result selects.
- States: input focus ring; placeholder `--ink-3`.
- Layout: `cluster`; wraps at narrow widths.

### SessionsTable
- Structure: `table.sessions` with columns runtime / started / prompt / skills / search / load /
  attribution; each row is a link target (`a.rowlink` on the prompt cell + whole row click).
- Spacing: cell padding `--s-3` x `--s-3`; row min-height 56px.
- States: hover `--wash`; `focus-visible` ring on the row link; empty (two variants below).
- Accessibility: real `<table>` semantics on desktop; `<th scope="col">`; on cards each cell keeps
  `data-label` for context.
- Layout: under 640px rows become grid cards:
  `"runtime started" / "prompt prompt" / "skills skills" / "search search" / "load load" / ". attr"`.

### RuntimeLabel
- Structure: `span.rt` > `span.rt__mark` (two-letter monogram, `--surface-2` tile, radius
  `--r-sm`) + label text. One geometric mark per runtime; no emoji, no hand-drawn glyphs.

### StateBadge
- Structure: `span.badge.badge--<state>` > dot + label. Dot color = status token; text `--ink-2`;
  background `color-mix(status 12%)`.
- Variants: succeeded (ok), in_progress (warn), failed (bad), cancelled / unknown / not_attempted (neutral).
- Search and load show all nonzero request counts independently. Zero total displays not_attempted; missing summary data displays unknown.

### SkillChip
- Structure: `span.skill` with the skill dir name; `title` carries the full URI. Max 3 shown,
  then `+n` chip. Border `--line`, radius `--r-full`, font `--t-cap`.
- Variant `skill--missing` (dashed border, `--ink-3`): an intended skill a step did not use. A used
  skill the step did not intend keeps the default chip plus a dim `skill__tag` reading "extra".

### Tag (`styles.css`)
- Structure: `span.tag` - one reported fact next to the thing it describes (basis, attribution share,
  call outcome, spec name). 18px, radius `--r-full`, `--surface-2` on a `--line` hairline, `--t-micro`
  at weight 600, never uppercased (labels are phrases, not codes).
- Variants: default, `tag--dim` (an absent fact: "unregistered", "outcome unknown"), `tag--ok` and
  `tag--bad` (a reported tool outcome only; both drop the border for a 12% status wash).
- Long values: a tag whose name is user-supplied splits into `tag__name` + `tag__suffix`. The tag caps
  at `max-width: 100%`, the name truncates with an ellipsis, and the suffix (`v3`) never shrinks, so a
  64-character workflow name still shows which version ran. The `title` carries the full value.

### Facts (`components/facts.tsx` + `styles.css`)
- A fact is a measurement, not a sentence: builders return `{ key, value }` (`panes`, `cost`,
  `active`, `finding`, ...) and `factText` is the single place that turns a key and a number into
  words. A measurement the runtime never reported is `null`, which renders as "unknown" and never as
  0. Wording therefore changes in one file, and no test depends on it.
- `Facts` renders `p.facts > span.facts__item[data-fact=<key>]`, with the finding label's definition
  as its `title`.

### Facts (`styles.css`)
- Structure: `p.facts` > `span.facts__item` x n - a wrapping line of dim facts separated by a middot
  rendered from `::before`, so no separator is ever stranded at the end of a line. Under 640px, where
  the line wraps between almost every fact, the middot is dropped and the `--s-3` gap separates them,
  so no separator is stranded at the start of a line either. Numbers are tabular. Each item carries
  its own unknown ("cost unknown"), never a 0 standing in for one.
- Used by: list row summaries, flow header counts, skill span facts, trace span rows.

### Tooltip
- Structure: any element with `data-tip` and `tabindex="0"`; `::after` renders `attr(data-tip)`
  on `:hover` and `:focus-visible`, inverted (`--ink` bg, `--bg` text), radius `--r-sm`.
- Used by the dim `unattributed` attribution cell: text `unattributed: <reason>`.

### EmptyState
- Structure: `section.empty` > title (`--t-title`) + copy + checklist (`dl`) + command `<code>`.
- Variants: `waiting` (no events yet: per-runtime last-seen list, ingest counters, `skillar doctor`)
  and `filtered` (events exist, filter matches nothing: "Clear filters" ghost button).

### GhostButton
- `button.btn`: transparent bg, `--line-2` border, radius `--r-sm`, 32px height; hover `--wash`;
  active `--wash-2` + `translateY(1px)`; `focus-visible` ring. `[disabled]` keeps the border, text
  `--ink-2`, default cursor; the saved eval-case variant (`data-save-eval="saved"`) is `--ok` text
  plus a check glyph.

### TraceHeader (`views/trace.tsx`)
- Structure: `header.trace__head.card` > `a.trace__back` (chevron + "Sessions", keeps the list
  filter) > `h1.trace__title` (first prompt; dim italic "(no prompt captured)") > `dl.trace__meta`
  (Runtime / Started / Duration / Attribution / State / Session) > `p.trace__counts`.
- Duration states: ended (`42m`), live and open (`in progress · 3m so far`), open without a live
  stream (`3m (no end recorded)`). Attribution `none` renders `unattributed · <reason>` in `--ink-3`.
- Spacing: card padding `--s-4` x `--s-5` (mobile `--s-4`); meta gaps `--s-3` x `--s-6`.

### WorkspaceRow (`views/workspaces.tsx`)
- Structure: `li.wsrow` grid with areas `"title tag when" / "meta meta when" / "sum sum sum"`; the
  title is the flow label (falling back to the workspace id) linking to the flow detail, the Tag is
  the spec `name v<version>` or a dim "unregistered". The title column floors at `min-content` and the
  tag column is the flexible one, so a long spec name truncates instead of squeezing the title.
- Lines: `facts wsrow__meta` = workspace id, tab, panes, sessions, plus inferred / unlinked link
  counts when non-zero; `facts wsrow__sum` = turns, found via search, spans with calls after
  activation (activity, not a quality claim), abstained turns, cost. The summary needs the flow
  report, so until it arrives the line reads "reading skill spans…"
  and on failure "skill span summary unavailable" - never an invented 0.
- States: hover `--wash`; `:has(.wsrow__title:focus-visible)` lifts the whole row.
- Layout: under 640px the row is one column and every part gets its own line, `"title" / "tag" /
  "when" / "meta" / "sum"`: at 390px a 64-character spec name and a flow label cannot share a line
  without one of them collapsing to one-character rows.
- Empty: `section.empty` "No herdr workspaces recorded" (with `skillar doctor`) or "No workspaces in
  this range" with a Clear filters GhostButton when the time filter is set.

### FlowHeader / Steps / PaneTree (`views/workspaces.tsx`)
- Flow cost sums unique model calls in the execution window, including calls with no skill.
  Identity is session + call id (event id when absent); an unreported cost makes the total unknown.
  Span costs remain observations, explicitly labelled shared when skills were co-active.
- Step intent shows "together (all required)" or "alternatives (any one)" from the exact spec version.
- Sessions outside the registered execution window carry a visible context label. An absent session
  end is "end not observed" when the flow/pane ended or a newer session appeared, never a claimed live run.
- EvidenceDisclosure: native `details` / `summary` beneath each turn and span, with a visible
  basis Tag, wrapping lists and selectable paths/event ids. Uses existing stack/cluster layout,
  `--s-2` / `--s-3` gaps, `--wash`, `--r-sm`, and body/small type; document owns scrolling.
  Turn evidence includes queries, candidates (collapsed/raw ranks and copies), used skills and
  latest-preceding-search ranks, abstention reasons, native-before-search and later-missed links.
  Candidates are the API's turn-wide union with latest ranks, not falsely assigned to each query.
  Span evidence includes labelled correction status/reason/matched terms and reported/heuristic
  supporting reads with file and event provenance. Missing evidence is unknown, not a negative result.
  Disclosure targets are at least 44px, keyboard focus uses the shared ring, and later-turn links
  open the target turn before focusing its summary. No new motion or colors.
- FlowHeader: `header.ws__head.card` > back link > `h1.ws__title` > `dl.ws__meta` (Workspace / Spec /
  Started / Ended / Panes / Sessions) > `p.facts.ws__counts` > `.ws__actions` (snapshot time plus a
  Refresh GhostButton). A flow report is computed on read, so the view states its `generatedAt` and
  refreshes on request - never on a timer, and never animated.
- Steps: `ol.steps` > `li.step` with the step id (mono), a status badge, its panes, then an
  `intended` and a `used` SkillChip row, and the unexpected-tool line when the spec listed tools.
- PaneTree: `ul.tabsets` > tab > `ul.panes` > `details.pane` (open) > session article > `ol.turns` >
  `details.turn` > `ul.spans` > `li.span` > CallList. Disclosure is native `details`/`summary` so
  every level is keyboard reachable; the chevron rotates 90 degrees over `--t-micro` and is the only
  motion in the view. Turns start open while a session has at most `TURNS_OPEN_MAX` (3) of them.
- A pane link herdr reported and one skillar inferred both show a Tag with the basis; a pane session
  skillar has not matched yet is a dim line naming the agent session, never a silent omission.

### CallList / Tokens (`components/calls.tsx`)
- Structure: `ul.calls` > `li.call` = mono name + optional `tag` (skillar) + outcome Tag (tool calls
  only) + duration + cost (model calls only) + `span.tok` token buckets. Over `MAX_CALL_ROWS` (12)
  rows a TextFold-style `foldbtn` reveals the rest.
- Rule: every figure is a reported measurement. An absent duration, cost or token bucket reads
  "unknown" (or is left out), and a tool call with no reported outcome gets `tag--dim` "outcome
  unknown" rather than being shown as a success.

### Timeline / TimelineStep (`views/trace.tsx`)
- Structure: `div.card.tl__card` > `ol.tl` > `li.tl__step.tl__step--<kind>` > `span.tl__dot` +
  `div.tl__head` (`span.tl__kind` label, optional `span.tl__tag` "native" / "abstained",
  `time.tl__time` = HH:MM:SS + `+offset` from session start) + `div.tl__body`.
- Rail: a 2px `--line-2` segment per step, starting at the first dot and ending at the last dot;
  dots are 8px (`--s-2`) with a 2px `--surface` ring so the rail never crosses them; hollow dots
  (read_file, native_skill) are an inset 2px ring of the kind color.
- Bodies: prompt = `p.tl__text` (pre-wrap) with a `button.foldbtn` fold over 600 chars; search =
  mode / elapsed ms / count / trace id row + `blockquote.tl__query` (`--wash`) + CandidatesPanel
  or AbstainBlock; load = name + mono URI + `@<8-char manifest digest>`; read_file = mono
  resource path relative to the skill dir + bytes + `from <skill>`; native_skill = name + `via`;
  error = mono code in `--bad` + message; session_end = `after <duration>`.
- Empty states: `section.empty` "Session not found" (stale id) and `div.callout` "This session
  never consulted skillar" above the timeline when no search step exists.
- Motion: none; live updates refetch the trace and keyed steps keep their DOM nodes.
- Skill span rows (`tl__step--span`, dot `--ok` hollow): when the session's skill report is readable,
  each span is folded into the timeline right after the step that activated it, the tool and model
  steps it owns move inside it, and its body is a `facts` line (active duration, call count, the
  turn's finding label with the label's definition as its `title`) over a CallList. Without a skill
  report the timeline stays exactly as recorded - the grouping is an enhancement, not a dependency.

### Layout
- Max content width `--max-w: 1180px`, centered; gutter `--s-4` under 640px, `--s-6` above.

### CandidatesPanel (`components/candidates.tsx`)
- Structure: `ol.cands` > `li.cand[.cand--chosen]` grid with areas
  `rank name inv bar score pick` / `rank desc` (mobile: `rank name inv score pick` / `rank bar` /
  `rank desc`). Rows are ordered by score descending, ties by rank.
- Parts: `cand__rank` (`--ink-3`, tabular), `cand__name` (ink, 500), `cand__inv` tag (`auto` /
  `explicit`, mono micro on `--surface-2`), `cand__bar` 6px track `--wash-2` with `cand__fill`
  width = score, `cand__score` (2 decimals), `cand__pick` = Lucide check in `--ok` only on loaded
  candidates, `cand__desc` (description `·` matched terms, `--ink-3`).
- States: chosen row = `--wash` background + `--ok` fill + check; nothing else is colored.

### AbstainBlock (`views/trace.tsx`)
- Structure: `div.tl__abstain` (hairline `--line`, radius `--r-sm`) > StateBadge
  `badge--succeeded` "no_candidates · <reason>" > `p.tl__hint` > GhostButton "Save as eval case"
  (POSTs `{query, fromTraceId}`; states idle / saving / saved / error with a `role="alert"` line).

### Callout
- `div.callout`: hairline card (`--line`, `--r-md`, `--surface`) with a bold `--ink` title and
  `--ink-2` copy; used for the never-consulted empty state. No status color.
- UnresolvedLoadNotice uses the same shared callout in flow and session trace reports. It shows
  the recorded unresolved count and a selectable, wrapping list of affected URIs. Attribution
  uncertainty is explicit, never a claim that the skill was unused. It is absent at count zero.
- Execution boundary disclosures use this callout too: recorded identity cuts and unavailable
  historical boundary order are distinct states. Session lifecycle tags never use analysis bounds.

### TextFold
- `button.foldbtn`: text-only accent button (`--fs-cap`, 500) toggling the prompt body between the
  600-char head and the full text; `aria-expanded` reflects the state.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 120ms | ease-out | Hover washes, button press |
| Live pulse | 2400ms loop | ease-in-out | Live dot only (opacity + scale) |

Rules: animate only `transform` and `opacity`; no entrance animations on rows (lists refetch
silently); `prefers-reduced-motion: reduce` removes the pulse and all transitions.

## 7. Depth & Surface

Strategy: tonal-shift plus hairline translucent borders (Linear's luminance stepping). No drop
shadows except the tooltip (`--shadow-pop: 0 4px 16px rgba(0,0,0,.18)`).

| Token | Value | Usage |
|-------|-------|-------|
| `--r-sm` | 6px | Inputs, buttons, monogram tiles, tooltip |
| `--r-md` | 10px | Table container, cards, empty state |
| `--r-full` | 9999px | Chips, badges, dots |

Nested corners are concentric (card 10px, inner chip 6px with 4px padding).

## 8. Accessibility Constraints & Accepted Debt

Constraints: WCAG 2.2 AA; body contrast >= 4.5:1 in both schemes (`--ink-2` on `--surface` is
7.1:1 light / 9.8:1 dark); every interactive element reachable by keyboard with a visible
`focus-visible` ring; tooltips open on focus as well as hover; `prefers-reduced-motion` honored;
`lang="en"` document with Korean-safe line breaking.

| Item | Location | Why accepted | Owner / Exit |
|------|----------|--------------|--------------|
| Trace / Flow / Heatmap views render "Coming soon" | `views/{trace,flow,heatmap}.tsx` | Stubs owned by todos 15-17 | Replaced in Wave 2 |
| Attribution reason tooltip depends on an optional `attributionReason` field the API may omit | `views/sessions.tsx` | `SessionRow` is frozen without a reason field; the dashboard tolerates its absence ("reason not reported") | Todo 5/12 may add the field; no contract change needed here |
| Trace view CSS ships as a `<style id="skillar-trace-style">` injected by `views/trace.tsx` instead of living in `styles.css` | `views/trace.tsx` | `styles.css` is owned by todo 6 in this wave; the block uses only tokens from this file | Fold into `styles.css` once the ledger allows (todo 18/19 cleanup) |
| Trace header fetches `/api/sessions` unfiltered and picks the row client-side | `views/trace.tsx` | The HTTP surface has no `GET /api/sessions/:id`; the list is local and small | Add a by-id endpoint if the list grows past retention defaults |
| The Workspaces list reads one flow report per row to fill its found/used summary | `views/workspaces.tsx` | `GET /api/flows` carries structure only; the analysis is computed on read. The list paints first and enriches at most `SUMMARY_CONCURRENCY` (2) rows at a time, and a row that fails says so | Fold a summary into the list DTO if a page ever feels slow |
| A flow detail does not follow the live stream | `views/workspaces.tsx` | A full report is far heavier than a session row, and the SSE contract only carries `session` rows; the header states the snapshot time and offers Refresh | Refetch on a flow-scoped event if the stream ever carries one |
| Workspaces view CSS ships as an injected `installStyles("workspaces")` block, and the call rows as `installStyles("calls")` | `views/workspaces.tsx`, `components/calls.tsx` | Same reason as the trace block: shared primitives (`tag`, `facts`, `dim`, `foldbtn`, step badges) were moved into `styles.css`, view-local rules stayed with their view | Fold into `styles.css` with the trace block in the cleanup todo |
## PR-5 shared widgets

The PR-5 widget contract is `site/DESIGN.md` section "Phase B widgets (PR-5)".
Both applications use the same source primitives and semantic tokens in
`foundation/widgets/`. Zero baseline, null gaps, measured-zero distinction,
accessible data tables, keyboard tooltips, PR-1 controls and 32px/44px targets
apply identically. The Callout-only pinned-MIT reference exception is recorded
there; it does not replace real Demo references for other components.
