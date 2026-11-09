# skillar.sh

## Phase B basic controls (PR-1)

Parity repair: add the missing 10px `--lf-space-2h` prefix spacing token.
Font shorthands must preserve inherited `rlig`/`calt`. Native mixed semantics
remain, with the pinned Check indicator. Status error uses upstream dark-red
ink, including its known light-theme contrast debt; exact reference parity is
the owner's current requirement. Native Select keeps its native popup, with
12px trigger padding and the same visible trailing indicator.
The Select's native control owns input, focus and options; a pointer-inert
value span paints the closed value without the browser clipping its line box.
TextLink follows upstream inline-block baseline geometry. Native focus ink
follows the document's color-scheme; rings use the existing ring tokens.

The reusable Preact controls live in `local/dashboard/foundation/controls/`,
shared by the two development galleries. Product screens migrate in later PRs.
They use PR-0 `--lf-*` tokens exclusively. Button variants are primary,
secondary, outline, destructive, ghost and text; small/default sizes are
28/32px desktop and 44px touch. IconButton sizes are 16/24/32px desktop and
44px touch. Loading disables activation without changing label geometry.
Input and native Select retain form semantics, visible labels and associated
error descriptions. SearchInput owns submit/clear only, not remote results.
Checkbox retains native form, Space and mixed-state semantics; its 16/14px
indicator sits in a 32px desktop, 44px touch label.

Badge sizes are 18/20/22/24px, Tag is 20px, StatusBadge uses 12px/18px type
and 8px/4px padding. Dismissible badges/tags become 44px on touch; static
labels do not. Status labels retain unknown/cancelled/pending distinctions.
TextLink is 12px/18px, weight 600; standalone touch links have 44px height.
KeyboardShortcut is non-interactive semantic kbd with platform-specific Mod
labels and 20/16/14px boxes with 12/10/9px text. CopyButton uses the Codeblock
24px IconButton composition on desktop. Skeleton uses muted fill, 6px radius and a status announcement, static
under reduced motion. CopyButton copies the original value, reports rejection
inline, and resets feedback when its value changes.

All interactive controls have keyboard rings and native disabled behavior.
Selection uses a wash and glyph. No coloured selection border is added;
invalid fields retain their validation border. Native Select deliberately
keeps the browser popup rather than adding PR-2 overlays. The desktop visual
contract is pinned Langfuse MIT source; 44px touch boxes and accessible names,
error messages, mixed checkboxes and status text contrast are intentional
accessibility adaptations. References and measured differences are recorded
per component in PR-1 evidence, not inferred from token equality.

Button supports an optional trailing glyph for real filter-trigger composition:
the trailing slot uses the 4px spacing token; leading-only content keeps its
6px gap. Comparison hosts may match reference labels and widths, but must not
override primitive typography, padding, colors, radii or rings to force a pass.

## Phase B foundation (PR-0, 2026-11-09)

This section takes precedence for the new shared UI foundation. Existing product
screens retain their current layout, font sizes and control geometry until their
scheduled component/screen migration; PR-0 changes only their dark status aliases.

- Source: Langfuse `69181812b87169df157841fce1314ec96ecd2c5a`,
  MIT `web/src/styles/globals.css`, as catalogued in components-v3/tokens.md.
  `local/dashboard/foundation/tokens.css` is the shared MIT source, not the
  API-contract package. Its location keeps Preact's existing module identity.
  All colors are complete CSS colors under `--lf-*`, including native OKLCH
  alpha, with separate primary action, selection (`accent`), link and ring roles.
  Never alias the existing brand `--accent` to Langfuse's selection background.
- Theme: `html[data-theme="light"|"dark"|"system"]`; absent/system follows the
  OS. `light-dark()` resolves shared colors using the root color-scheme.
  Surface ladder in dark: header 2%, sidebar 4%, canvas 6%, card 7.5%,
  modal 9%, popover 12%. Existing pages do not adopt these surfaces yet.
- Type: upstream system sans and Plex Mono/IBM Plex Mono with system monospace
  fallback, weights 400/600. New shared text
  xs/sm/base/lg/xl/2xl is 12/13/14/16/20/22px with line heights
  18/20/21/21.6/26/27.5px. Body `text-sm` is **13px/20px**.
- Geometry: radius lg/md/sm is 8/6/4px. New standard controls are **32px**
  visual height with a fine pointer, **44px** under `(pointer: coarse)` OR
  viewport width <=768px; small controls are 28px desktop and 44px touch.
  The touch rule changes the actual box, not a transparent pseudo-element.
  Space tokens are 2/4/6/8/12/16/20/24/32/48/64px; borders 1px, focus 2px
  with 2px offset. Root rem sizing is not required to obtain these pixel sizes.
- Showcase: `/__gallery.html` is a dev-only foundation gallery, with identical
  shared Preact content in site and local dev. It proves surface, status, type,
  radius and control-metric tokens, not completion of PR-1 controls.
  States: default, real pointer hover/active, keyboard focus-visible, native
  disabled, busy, invalid, empty and selected. Selected state uses a neutral wash
  plus a check glyph. Theme selection includes system and never writes account
  preferences. Its document owns vertical scroll; intrinsic grids collapse to
  one column. Named spatial reference: StyleGallery
  [ram-grid](https://github.com/changeroa/StyleGallery/blob/main/patterns/grid-repetition/ram-grid.md).
- Accessibility: semantic headings/labels, native controls, visible keyboard
  rings, textual status labels plus SVG glyphs, natural Korean word breaks,
  no decorative motion. This explicitly approved 13px desktop density overrides
  the older 14px minimum for migrated primitives only. Known upstream faint
  text/control-boundary contrast is not silently endorsed: unmodified token
  swatches are reference samples, not permission to use them for body copy.
  The light red pair measures 3.15:1: status specimen text uses neutral foreground,
  while its SVG glyph preserves the exact status foreground on the status fill.
- Dark status compatibility: existing success/warn/error roles now consume
  the exact shared green/yellow/red foreground tokens. Their light values and
  the brand, screen layouts, URL state and interaction ownership are unchanged.
  Attribution ships at `/NOTICE`; source SHA/files are in THIRD_PARTY_NOTICES.md.
- Verification/debt: `scripts/uxb/` owns the reusable per-component capture,
  computed-style and visual diff protocol. Missing upstream references or
  independent review are failures to report, never parity passes. No screen
  redesign, overlay replacement or accessibility debt is accepted by PR-0.

## Hosted date and version labels

All hosted date labels and calendar buckets use Asia/Seoul, explicitly marked
KST. The shared `src/time.ts` day key supplies skills facets, the histogram,
dashboard chart and weekly tile. Chart dates use two lines so KST remains
visible without crowding the phone axis.

Comparison starts on opening its tab and refreshes on either selection using
the existing export GETs. Inactive comparison tabs do not fetch. Options and
summaries use `rN · digest8 · M/D` for the current head, using its actual
revision number. The API has no historical per-version revision, so other
versions use `보관 #N` for retained creation order. Current/pinned markers and
KST dates remain explicit. Breadcrumb options omit the date and put 현재
first, with a nonshrinking field, so the marker remains visible on phones.
Full digests appear only in detail-view read-only monospace copy fields
inside native disclosures, never inside search listbox candidates.
Long diffs start expanded and can be collapsed. Existing field, disclosure,
status, spacing and focus primitives apply. Missing read data explains the
connection needed in Korean, without internal proposal identifiers.

## P-D connections

Connections keeps the existing shell and orders execution location, MCP setup,
upload consent, copyable command, then the devices/MCP table. Token creation
and pairing remain in disclosures after the table. The workspace reuses
DataTable, FacetPanel, Pill, KeyValueGrid, PeekPanel, Toast and Skeleton.
Kind/status facets count the returned range before filtering; search, facets,
sort and selected connection persist in URL parameters. Unknown usage is
미측정. Active means registered and unrevoked/unexpired, never online.
The desktop facet rail and table use zero-minimum columns; on phones facets
collapse behind a disclosure and the table owns horizontal overflow. Main
keeps vertical scroll ownership; the shared peek owns its detail scroll.
Existing device consent, disconnect confirmation and pairing components are
reused, with no changes to their requests or confirmation semantics.
DataTable accepts an optional controlled sort so URL restoration does not
reset column visibility or density. PeekPanel can omit its full-page link
when the record has no separate full-page route; it must not link to itself.
Connections starts with the active status facet selected. The visible
해제됨 보기 toggle uses `revoked=1` and clears the status facet to show all
statuses; turning it off restores active-only. Explicit status facets still
override that view, and `status=all` preserves a cleared facet on reload.
The caption counts visible rows and names hidden revoked rows. Neither the
table nor its counts appear until both connection lists have settled; a
failed list keeps the count unknown. Table cells share a top-aligned 26px
line box, with the status badge's borders included and the 44px name action
aligned to the start rather than vertically centered.

## P-C approved dashboard home B

P-C2 replaces the no-viewable-source checklist cards with one wrapping status
strip: three numbered, textual state chips and one primary next-step action.
Device loading/failure remains explicit and never reuses stale consent as done.
Connection and consent actions open existing management; after consent the
action refreshes sources for the first session. Revoked notices are grouped
behind one counted native disclosure; opaque IDs appear only when expanded.
The strip uses existing surface, Pill geometry, spacing and 44px action tokens.
At 1440x900 both tiles and the R7 chart begin within the first viewport.
The second tile is 이번 주 변경 수: skills with last updatedAt in the seven
KST calendar dates ending today, independent of the chart's selected range.
Its caption identifies updatedAt, the seven-day range and KST; missing catalog
data remains unknown and retained data keeps the existing stale-read notice.

Home follows `hosted/dashboard-widgets-b.html`: four NumberTiles, a paired
BarChart/recent-skills DataTable, a connection-state DataTable, then three
explicitly unmeasured usage slots with consent links. Use the shared `src/ui`
primitives. DataTable adds only an optional `controls` switch (default true);
the fixed top-five summary omits density/column controls but keeps sorting.
BarChart leaves null slots empty and marks missing coverage in the shared
legend, instead of repeating wide unmeasured labels between phone bars.
Existing spacing, type and color tokens apply; widgets
use a two-column zero-minimum grid above 1024px and stack below it. Tiles
use four columns on desktop and two on phones. No account data in main.
The compact source disclosure retains explicit selection and close-focus
restoration. Selected activity retains the existing embedded views.

Asset counts describe the entire returned catalog; the chart and top five
describe the selected recent KST calendar-day range, including both ends.
The chart counts last `updatedAt`, not a complete change-event history.
The version creation series stays unmeasured: the catalog has no version
list and home does not eagerly fan out detail reads. Empty catalog establishes
zero versions. Device + MCP registration counts are not deduplicated physical
clients; active means unrevoked and, for MCP, unexpired, not online.
PATs alone count as active tokens. Every missing/failed source stays explicit.
Usage slots do not infer collection or consent from account/connection state.
Existing checklist, metadata-only explanations, permission facts and stale
503 recovery remain available. R7 uses shared chart geometry without a fork.

## P-B approved skills workspace

The approved v2 `skills-table`, `skills-peek` and `skill-full` wireframes
define this composition. Reuse `src/ui` table, facets, peek, tabs, pills,
key-value grid, toast, skeleton and chart primitives without a parallel kit.
The table has four columns: name, current revision, updatedAt and an
eight-character digest pill. No reads column. Facet counts cover the received
catalog; revision facets use the current revision number, not an invented
retained-version count. The selected workspace provides the actual retained
version count. Date buckets use KST, include zero days, and count skills by
updatedAt, never reads. Bars share the primitive's scale and zero baseline.

Desktop orders a 160px facet rail and a shrinkable table; the compact
histogram precedes a single search/column/density toolbar. Metadata uses the
14px role, rows are at least 44px. At phone width facets collapse into a
native disclosure, the histogram stays legible and each row becomes two
lines. Name and compact metadata stay available with no page overflow.
Phone row densities are 64px, 80px and 96px so the density control remains
meaningful even when two-line content determines the minimum row height.
The shell main remains the scroll owner.
Name is the required identity column. On phones, optional updated/digest
columns become short-date and digest-pill metadata, and their visibility
controls still govern those inline fields.

Row selection preserves the list and opens the shared right-side peek.
Below 1024px it is a full-screen modal sheet. Its action bar includes full
page, previous/next, explicit ID copy feedback, and close/back. Escape and
close restore the triggering row. A dirty draft still requires confirmation.
Full-page expansion retains the controller and its in-memory draft.
Query, sorting, facets, columns, density, selected ID, version and detail tab
are URL state; old `#skill/<id>` links remain full-page links.

The detail summary is a wrapping single metric strip: current revision,
retained versions, selected digest, update time, and read-connection guidance.
The full view has document/version/comparison/file tabs; the document tab
keeps a version rail, Formatted/Raw views of the same verified bytes and an
explicitly unmeasured per-version reads frame. Formatted Markdown is built
as safe text nodes, never unsanitized HTML. Editing always targets current
head, separately labelled from the read-only selected version. P14 typed
deletion, export payloads, upload acknowledgement and retry semantics remain.
Below 1024px the document precedes the version index in both visual and DOM
order. Desktop keeps the index on the left. Responsive reordering preserves
the document and draft rather than relying on a visually reordered focus path.
No new palette, font, radius or motion is introduced.

## P-A approved app shell and shared UI

The owner-approved wireframes v2 (`hosted/app-shell.html` and
`hosted/component-sheet.html`) define component presence and order, not new
brand tokens. The Langfuse mapping C01/C03–05/C08–17/C22–24/C29–30 supplies
component anatomy. Keep the Evidence Console V2 palette, system typography,
2px radius, 14px minimum metadata and 44px minimum interactive targets.

The signed-in shell is a bounded `100dvh` fixed-sidenav-shell: the 256px rail
and 64px-minimum top bar stay visible while `main` owns content scrolling.
This supersedes document scrolling for these four hosted app routes only.
The rail orders wordmark, 관찰 (대시보드, 세션), 자산 (스킬), 설정 (연결),
then theme and the bottom account name/email, 계정 link and unchanged POST
`/auth/logout` form. Selected navigation uses a neutral surface wash, bold
ink and a check glyph; no accent stripe. Sessions uses the existing dashboard
hash, never a new data endpoint. No widget destination is invented before P-C.
Below 1024px the same navigation and account nodes move into the native modal
drawer. The drawer owns its overflow and Escape restores its menu opener.

The top bar orders breadcrumb then the visible 이동… ⌘K button. Breadcrumb
dropdowns contain real navigation destinations, with skill name and revision
derived from already-rendered detail; `#skills-page-title` remains mounted.
The native command dialog is navigation-only: local label filtering, five
destinations, wrapping Up/Down selection, Home/End endpoints, explicit URL
activation for Enter/click and Escape focus
return. It is instant, including reduced motion. Page headings have at most
one short subtitle (80 characters); introductory banners and repeated account
boxes do not occupy the content workspace. Public landing/login/404 keep
their public layout.

Shared primitives live in `src/ui/` and accept caller-supplied data:
- DataTable: semantic caption/header/body, client-range sorting with
  `aria-sort`, column checkboxes (at least one stays visible), density choices
  조밀/보통/여유 at 44/48/64px minimum rows.
- FacetPanel: labelled groups of checkboxes with caller-supplied counts and
  an explicit count scope; zero remains selectable.
- Pill: a noninteractive 26px-minimum metadata label, never a fake button.
- KeyValueGrid: semantic `dl`, zero-minimum columns and wrapping opaque values.
- SegmentedTabs: named tablist, linked tabpanels, roving focus, arrow/Home/End
  activation. IDs are caller supplied and unique per instance.
- PeekPanel: nonmodal desktop dialog beside the preserved list, full-screen
  modal sheet below 1024px; selected ID in a named URL query parameter,
  Back/Forward restoration, Escape/close restores the triggering row.
- NumberTile: label/value/note, null rendered as 미측정 rather than zero.
- Toast: persistent polite live feedback, explicit dismissal, no timer;
  important errors remain in the caller's inline recovery surface.
- Skeleton: static layout-preserving blocks with a single loading status,
  decorative blocks hidden from assistive technology; no shimmer.
- BarChart/LineChart: labelled SVG with text alternatives and a shared
  nonnegative y-scale across series. Every bar ends on one common zero
  baseline, including the 1px zero tick. Equal-width grouped bars use equal
  intra-group gaps; values are above bars, group labels below. Null is a
  visible 미측정 gap, never zero; absent measurements render no invented chart.
  SVG geometry uses a 640×280 reference grid, 48px horizontal inset, 32px top
  inset and baseline y=232. Bar coordinates round to integer CSS pixels so
  float32 SVG storage cannot move their bottoms off the baseline. Percentage
  x positions keep all text at the 14px type role on phones; only the line
  paths use a nested, horizontally scaling viewBox.

Accessibility constraints: all controls keep the existing 2px accent
focus-visible ring and 2px offset; native dialogs trap focus only when modal.
Long account values wrap without horizontal overflow. Shared data components
do not fetch, infer consent, persist private data or make API calls.
Accepted debt: P-B/P-C/P-D adopt these primitives into their data surfaces;
P-A does not replace their data logic or fabricate widget metrics.

## Skill evidence and dashboard recovery (PR3)

Authored skills-page copy is plain Korean throughout: navigation, account
states, library/search, editor, upload consent, publishing, version actions,
errors and deletion confirmation. Keep stored names and document content,
SKILL.md, digest, MCP, product names and code tokens unchanged. In particular,
typed deletion still compares the exact stored skill name or digest prefix;
localizing the instruction must never localize the required value.

The selected skill remains a real document and version workspace, using the
existing hash route, editor, verified package and version actions. Make the
current revision, full digest, files and retained versions easy to distinguish.
Publication history is not read history. The current skill API supplies neither
version-linked reads nor evaluation results, so show those as not connected to
this view, never as zero reads, a passing score or an evaluation gate. A real
Dashboard link can lead to session evidence without claiming a prefiltered
version match. Existing pin, head, publish, export and P14 typed-delete contracts
remain unchanged. Lead cleared the skills ownership gate after PR71 merged.

The detail workspace adapts the approved version rail and document relationship:
a 320px supporting column holds retained versions and the evidence availability
facts, beside a zero-minimum document column from 1000px. Below that width,
the same source and focus order stacks in the document. Current revision and
retained-version count lead the compact facts; the full current digest keeps
its own row. Version rows use flat rule separators, a neutral current-version
wash and 44px actions, not repeated elevated cards. The current document stays
plain text in the existing editor. Section headings use the 22px app role.
Destructive triggers use the existing error ink and border; an armed typed
confirmation uses error fill and background ink. Disabled confirmation remains
neutral. No confirmation predicate, request, default action or focus rule changes.

The Dashboard workspace offers source selection only when a successful source
read includes a viewable source. When none are viewable, explain that state and
offer device-connection guidance and the existing local-setup destination.
Opening guidance reveals the existing management disclosure; it creates no
grant, device or consent. Loading and failed reads must not invent an empty
result.

Desktop source rails use 320px, expanding to 360px from 1200px. At the existing
900px reflow they return to a single document column. Source facts use a 56px
label track and a shrinkable value track. Opaque source/device IDs use the
existing middle-ellipsis formatter with their full value in a native title;
dates stay on one line and revision groups wrap only between complete values.
The page remains the sole vertical scroll owner. No new color, font, radius,
motion or API token is introduced.

Spatial references, adapted to the existing page rather than copied:
[sidebar](https://raw.githubusercontent.com/changeroa/StyleGallery/main/patterns/split-sidebar/sidebar.md)
for source/supporting columns and
[list-detail](https://raw.githubusercontent.com/changeroa/StyleGallery/main/patterns/split-sidebar/list-detail.md)
for the selected document relationship. Source order and focus order stay
aligned; zero-minimum tracks and the phone stack are load-bearing constraints.

## Dashboard composition (PR2)

Evidence Console puts source selection beside the activity workspace, with account and connection management below it. A source is still explicitly selected; no source is selected automatically and unavailable sources remain disabled. Without a selection, the workspace explains the next action rather than showing example data. Selected activity keeps the existing Sessions/Workspaces/Flow/Heatmap routes and report adapter.

Desktop uses the source rail dimensions defined in PR3 and a flexible activity region. At narrow widths they stack with 20–24px gutters and no document overflow. Snapshot freshness, technical metadata and remote commands live in a named disclosure above the activity; their components remain mounted and all existing consent, confirmation and expiry rules apply. Device and private-pack management stay available in a separate disclosure. The account menu, auth routes, source lifecycle and all API contracts are unchanged. New explanation is plain Korean. Read/search evidence is explicitly distinguished from task success.

The source chooser starts open before selection. After explicit selection, its disclosure closes and keeps the selected source identifier visible; it can be reopened to change sources. Focus moves to the mounted snapshot heading, with the same keyboard-visible accent focus ring as controls. Closing a snapshot reopens source selection. The choice is never inferred from source arrival order.

The owner's PR74 correction requires plain Korean for all authored dashboard copy, including navigation, account/source actions, trace labels, empty/error states, accessible names and explanations. Product/runtime names, recorded content, code IDs, commands, protocol tokens and machine values remain exact. Embedded trace focus ends on the mounted trace heading, not a full-panel outline. Real-pointer and keyboard evidence must distinguish focus modality.

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

Spacing follows existing4/8/12/16/20/24/32/48/64/96 scale. Native local dashboard content max1600px with20px phone/32px desktop gutters. Preserve document scroll owner, responsive table-to-card behavior, wrapping navigation and filter behavior. The hosted embed inherits the site's palette but keeps its own scoped styles and zero extra inner gutter.

PR1 is foundations only: no session/search/skill/auth/landing behavior change. Existing page compositions are restyled in the subsequent approved PRs. The initial site/src/skills/* lock was cleared by lead after P14 PR71 merged; PR3 may restyle that UI while preserving its confirmation and transaction contracts.



## P12 remote mutation increment

The dashboard keeps the existing document scroll owner, tokens and account
shell. Source commands and private-pack publication are separate operations;
neither uploads local skill files or grants execution permission.

- Source commands live in a native disclosure beneath the selected source.
  Reuse the field, document-field, choice, wrapping action cluster and facts
  primitives from Section 5. Every operation names its source and base journal
  revision. An explicit submission creates a command ID; nothing applies
  optimistically.
- Pending means the server holds a command, not that the source applied it.
  Explain the existing sync cadence, offline behavior and the source-side
  `skillar sync commands --enable` opt-in, which is off by default.
  Applied, conflict, rejected, uncertain and definitely refused outcomes have
  distinct text and recovery actions. Needs-attention text never relies on
  color alone. Technical codes stay in a native disclosure.
- Retrying an uncertain submission preserves its exact ID and content.
  A definitely refused or conflicted command needs a fresh source read before
  a new ID is offered. A higher reported source revision must be visible first;
  an equal revision is sufficient when another command completed without
  changing source data. Completed-load counters and profile data change in
  the same state transition. Manual ID lookup recovers durable statuses after
  reload; browser drafts and source data are not persisted.
- Private packs use a stacked panel and native authoring disclosure. The JSON
  picker reads only a chosen definition, checks its pinned member references,
  and waits for a separate unchecked publication acknowledgement. Reuse
  `.field-label`, `.text-field`, `.choice` and the intrinsic fields grid.
  The file input must shrink with its column; no unnamed, unreset fieldset
  may impose an intrinsic minimum width.
- Pack catalog entries use a named heading and `.account-status` facts for
  Pack URI and Digest, never concatenated inline identifiers. Long values
  wrap without truncation. The `.private-packs` panel inherits
  `overflow-wrap: anywhere` through names and selected-file notes, including
  a valid 128-character unbroken display name; it must not expand the mobile
  layout viewport. The update action copies the current digest;
  it also opens authoring and focuses the file picker. The definition still
  determines the target pack. Explain a locked request
  beside unavailable authoring or update actions.
- A publication request fixes its ID, definition and expected digest until
  a terminal receipt is read. Accepted is explicitly not published.
  Published states the immutable revision and current searchability; a failed
  request keeps its definition and directs the person to review both the
  digest and pinned members. Retry sends the identical request.
- With no active draft, a labeled publication-request ID field reads a durable
  receipt without a file or upload acknowledgement. It is read-only recovery,
  not a new publication. Results name their request and pack URI. Reload
  clears the draft but does not prevent this lookup.

All additions reuse square surfaces, 44px fields, 48px actions, ink focus,
existing contrast pairs and no decorative motion. Loading and failures use
inline status/alert text; disabled actions have an adjacent reason. Test the
unchanged document scroll at phone, tablet and desktop widths, light/dark,
keyboard focus, text reflow, long IDs, pending and terminal outcomes.

## P11 private MCP authorization increment

This supersedes earlier MCP-preview restrictions only when the deployed MCP
service is enabled. The account shell and all existing color, type, spacing,
square-corner, focus and motion tokens stay unchanged. There is no new font.
`/connections/` replaces the non-working example with the canonical endpoint
returned by the authenticated service and actual OAuth/PAT connection facts.
The old Connect MCP destination leads to that working route.

- A connection is not a device-upload grant. It can read private skills the
  person has already explicitly published. No write/manage capability is
  offered in P11, and no local files are scanned or uploaded.
- OAuth `/oauth/authorize` is a server-rendered, no-JavaScript consent page.
  One h1 names the decision; the untrusted client name, verified CIMD domain
  when available, requested read permission and exact redirect host precede
  the form. A loopback redirect explicitly says any local process could be
  listening; a registered client name is not presented as verified.
- The consent page reuses the account wordmark, document scroll, 18px body,
  15px note/code, 48px actions, ink focus and desktop/phone gutters. Its
  surface is a single readable form, not a dialog over a fake app. Native
  system light/dark applies without script; all text and labels wrap at390px.
- Browser authorization failures retain that document shell, explain an ended
  sign-in, invalid/expired request or unavailable service, and link back to
  Connections. Restarting in the agent creates a fresh approval request.
  This HTML recovery applies only to authorization documents requesting HTML;
  API errors and MCP bearer challenges retain their protocol responses.
- Consent documents use `Referrer-Policy: same-origin` so the browser's native
  form POST retains the required Origin. External client referrers remain
  suppressed; API responses retain no-referrer and null Origin is rejected.
- Read access needs an explicit Allow action. Cancel stays a separate
  secondary action; no automatic approval or remembered consent is added.
  Recording this connection's server-readable search queries and resource
  observations is a separate unchecked choice. OAuth state is bound to the
  same Google session and account on submission.
- Token issuance is an explicit form submission: label, default7-day expiry
  (maximum30), fixed private-read permission, optional unchecked recording.
  The returned token is a password field by default, with explicit reveal,
  copy and dismiss. It is never stored in a URL, localStorage, screenshots
  or logs. Dismiss clears it; later lists cannot recover it.
- Connection rows show human name, OAuth/token type, permissions, recording,
  locale-formatted expiry and revoked state. Revoke uses the existing
  two-step confirmation pattern and keeps the safe action first in focus.
  It removes access, not the separately retained activity history.
- Loading is text, errors remain beside their action, and retry preserves
  draft fields. Signed-out, disabled, unavailable, empty, active and revoked
  are distinct states. No spinner, fake zero, optimistic success or timeout
  dismissal is introduced. The service-returned endpoint is the copy value;
  a browser cookie or connector bearer is never a suggested MCP credential.

Private consent pages use noindex and a restrictive CSP rather than weakening
privacy for a search-engine score. Existing light/dark, keyboard, phone,
zoom/reflow and original-capture gates apply to both new surfaces.

## P10 private skills library increment

This adds one account route, `/skills/`, and changes nothing about sign-in,
the dashboard or the P9 transport rules. MCP remains an explicitly labeled
preview until P11: nothing on this route says an agent can read a private
skill, and the availability notice says so. Private skills are files a person
chooses and publishes; the page never scans a filesystem and never renders a
skill document as HTML.

### P10 route and shell

`/skills/` uses the account shell: skip link, wordmark, theme select, the
account nav (Account, Connect MCP, Dashboard, Skills) with `aria-current` on
Skills, the availability notice band, one `main`, one h1 ("Your private
skills."), the account footer. Skills is a destination, not a stage of the
account journey, so the step list is omitted here and unchanged elsewhere; the
only edit to the other account routes is the fourth nav link. Availability
notice text: "Google sign-in, the activity dashboard and your private skills
library work. MCP setup is still a screen-only preview: no endpoint is
assigned, and agents cannot read private skills over MCP yet."

The page is one document scroll owner with stacked panels in reading order:
account line (Signed in as, Sign out), Library, the Skill panel once a skill is
opened (directly under the card that opened it), then Publish a skill. Opening
a skill sets the hash `#skill/<uuid>`, so Back returns to the library; a hash
for a skill that is not in the catalog shows a not-found note in the Skill
panel, never a blank. Focus moves to the Skill panel heading only when the
person opened it from this page, never on browser Back or a pasted link.

### P10 primitives

All reuse the tokens above and the P8 primitives (`.panel`, `.panel__head`,
`.account-status` facts, `.choice`, `.field-label`, `.text-field`,
`.problems`, `.command`, `.button`, `.note`). Nothing new in color, type,
radius or motion. New names:

- Skill card: a surface block in the `.source-list` grid. h3 at body size for
  the name, description in ink with a 70ch measure, a facts list (Revision,
  Updated), one secondary "Open" action at 48px. The opened card carries
  `aria-current="true"` and the 2px inset ink ring the source card uses.
- File picker: two 48px secondary actions, "Choose a skill folder…"
  (`webkitdirectory`) and "Choose files…", each opening its own hidden native
  file input; one sentence before them says what is read and when. A
  selected-files list follows: path in `code`, size and media type in muted
  small text, a 44px "Remove" per row. Paths keep their folder structure; the
  selected folder's own name is stripped. Hidden entries (a dot-leading name)
  and files over the per-file limit are skipped by name and reported in a
  status list before any byte is read; a selection over 400 entries is refused
  outright. Archives are refused with the fixed sentence from the shared
  contract error, named per file.
- Document field: a `textarea.document-field` for `SKILL.md` text. Code font
  at 15px, code field colors, 1px muted border, square, 18 rows minimum,
  vertical resize only, `spellcheck="false"`, ink focus ring. It is the only
  way skill text appears; no Markdown is ever rendered to HTML.
- Upload acknowledgement: a `.choice` checkbox row, unchecked on every visit
  and after every publish, labeled "Upload these files to my private skillar
  library." with the detail that this is separate from device activity
  consent, that only the listed files are sent, and that they are stored under
  the account until deleted. Publish stays enabled; an unchecked box is
  reported as a problem next to the action, not as a disabled control.
- Resource list: `dl.account-status` rows per manifest resource: path in
  `code`, then size and media type. Read-only.
- Version row: a surface row per version in a list. Digest in `code` wrapped
  with `overflow-wrap: anywhere`, created `time`, text labels "Current" and
  "Pinned" at weight 600 (never color alone), then an action cluster: Make
  current, Pin or Unpin, Export JSON, Delete version. A row that is current or
  pinned shows why Delete version is unavailable in a note instead of a
  disabled control.
- Secondary action on a surface block: the secondary action is an ink wash
  relative to its parent, so inside a surface-colored block (skill card,
  version row, search result, file picker) it uses the page background
  instead of the surface color; on the page background it stays surface.
- Confirm step: destructive actions (Delete skill, Delete version) swap the
  trigger for "Confirm delete" (primary) and "Keep" (secondary) plus one
  sentence on the consequence; focus moves to Keep and returns to the trigger
  on cancel, exactly like device revocation. Enter never deletes by default.
- Search field (optional capability, server-backed): a labeled text field and
  a secondary "Search" action under the cards; each result is a surface row
  with name, description, matched words and an "Open" action. An abstained
  search shows the shared contract's fixed hint sentence as a note; a 404 from
  the search route is reported as search not being available yet.
- Status placement: every action reports next to itself. The Skill panel has
  one status line under the publish actions, one above the version list and
  one beside the delete actions; the line under the heading carries only
  loading and open-failure text. "Technical details" is a compact native
  disclosure after the sentence.
- CJK text: names, descriptions, facts and the document field use
  `word-break: keep-all` so Korean wraps at spaces, with `overflow-wrap:
  anywhere` still breaking a digest or a path that would otherwise overflow.

### P10 copy and data rules

- Name and description are read by the server from `SKILL.md` front matter;
  the page shows the values it finds in the draft as "will be published as" and
  lists a problem when `name:` or `description:` is missing. It never asks for
  a separate name field, so there is nothing to drift.
- A new skill gets a client-generated UUID (`crypto.randomUUID()`); the page
  shows it in `code` after the first publish.
- Sizes are shown in bytes under 1 KB, otherwise in KB (or MB) with one
  decimal; times are locale-formatted from epoch milliseconds; digests are
  shown in full in `code` at 15px, never smaller.
- Export downloads the server's export JSON unchanged, named
  `skill-<name-slug>-<first 8 digest chars>.json`, offered only after the
  export response parsed against the shared schema.
- Publishing sends `{ base, acknowledgePrivateUpload: true, package }` where
  `package` comes from `createPrivateSkillPackage` over the retained supporting
  files plus the current document text, so quota, path, archive and digest
  rules are checked in the browser before any request. Editing loads the head
  package from the export route and verifies it with
  `verifyPrivateSkillPackage` before any byte is shown.
- Responses are parsed with the shared schemas; a response that does not parse
  is a failure, never partial data. Server text is never echoed; the fixed code
  is available under "Technical details".

### P10 states

| State | Rule |
| --- | --- |
| Checking | "Checking your account…" status text; no spinner |
| Signed out / unreachable / unexpected | The dashboard's signed-out block: fixed sentence, real "Continue with Google" link, privacy note. No library content |
| Expired (401 on any call) | Library and drafts are cleared; the signed-out block says the session ended |
| Not available (404 on the catalog) | One note: private skills are not available on this deployment yet, nothing is uploaded; no publish form. Covers the environment flag being off and an undeployed route alike |
| Loading | "Loading your skills…" status text; existing content stays |
| Load failed | Fixed sentence by cause plus a "Try again" secondary action; prior content stays |
| Empty | "You haven't published a private skill yet." with one sentence pointing at the Publish panel |
| Populated | Skill cards, newest update first |
| Draft problems | `.problems` list beside Publish: missing `SKILL.md`, missing front matter fields, archive, quota, path, unchecked acknowledgement |
| Publishing | Status text "Publishing…"; actions disabled; nothing is shown as published |
| Published | Status text names the new revision; acknowledgement unchecks; the draft clears only after the parsed response |
| Conflict (409 `head_conflict`) | The draft and files stay. Note: the skill changed elsewhere; a "Review current version" secondary action re-reads the skill and states the new head. Nothing is overwritten silently |
| Protected (409 `version_protected`) | The current or a pinned version cannot be deleted; the note says which to change first |
| Gone (404 on a skill) | The skill was deleted elsewhere; the draft stays visible for copying; a "Back to library" action reloads the catalog |
| Rate limited (429) | "Too many requests; wait a minute and try again." |
| Too large (413) / invalid (400) | Fixed sentences; the draft stays |
| Unavailable (503) | "Private skills are unavailable right now." |
| Offline (network error) | "Couldn't reach skillar." plus retry |
| No JavaScript | The page explains the library needs JavaScript; sign-in and sign-out forms still work |

Not used: optimistic updates, spinners, skeletons, toasts, disabled primary
actions without an adjacent reason, color-only status, HTML rendering of any
skill content.

### P10 accessibility and debt

Every control is at least 44x44 CSS px and actions are 48px; all text uses the
token pairs above, so 4.5:1 holds in both themes. The document field keeps
the 3px ink focus ring. Live regions are `role="status"` paragraphs; problems
use `role="alert"` lists. Accepted debt: resources other than `SKILL.md` are
listed but not previewed; the search field depends on the server outcome and is
hidden when the catalog is unavailable; a 404 from a disabled flag and from an
undeployed route are indistinguishable to the browser and share one honest
sentence; the library needs JavaScript.

## P9 durable live connection increment

This supersedes P8's snapshot-only transport restriction, not its consent or
data-freshness rules. The embedded views reuse the existing connecting/live/
offline text and dot; no new color, animation or component is introduced.
Live means an authenticated update connection is available. It never claims
the device is running, the uploaded snapshot is current, or a report is complete.
Capture/receipt times, pending reports and stale results remain independently
visible. Background invalidations refresh REST-backed views without moving
focus, changing the selected source or resetting scroll.
The embedded connection dot stays static while idle; its text distinguishes
connecting, live and offline states. A failed background report refresh keeps
the last valid report and its disclosures visible with an inline error.

WebSocket is primary, SSE is the compatibility path, and reconnect/visibility
return replays durable changes. Expired cursors refresh the current snapshot.
Idle WebSockets use Durable Object Hibernation and native ping autoresponses.
SSE is not an always-awake substitute: all streams in one account share a
five-second window, followed by at least 120 seconds without another SSE
window. Renewals cannot extend that deadline. The browser closes native
EventSource reconnects and owns cursor-based reconnect after the cooldown;
visibility changes cannot bypass it. REST replay every 15 seconds during the
gap keeps reports recoverable without holding a Durable Object awake.
The existing connecting label applies while that event transport is absent;
report/capture freshness remains independent. Before merge, compare actual
GB*s for two idle fixture accounts before/after and project 30 days, with a
conservative target below ten percent of the shared 400k GB*s allowance.
Session expiry clears private activity and stops connections. MCP remains a
preview until P11; device upload still requires separate explicit consent.

## P8 connected dashboard increment

This section supersedes the dashboard-only preview restrictions below. Google
sign-in and the workshop visual system stay unchanged. MCP remains an explicitly
labeled preview until P11.

The hosted dashboard reuses the local Preact Sessions, Workspaces, Flow and
Heatmap views, including trace/workspace details, filters, reports and eval-case
creation. The site shell supplies account navigation, theme, source selection,
connection instructions and consent controls; there is one main landmark and
one document scroll owner. Keep the existing palette, system type, 44px targets,
48px actions and 4.5:1 minimum for every text size.

Signed-out people see a Google sign-in link, never activity. Signed-in people
start local-only. Device grant creation connects a device but does not grant
upload consent. Consent is a separate deliberate submission: show the seven
content categories, server-readable processing, default 30-day retention,
backup maximum 30 days, and optional historical snapshot identity/cut/range.
No checkbox is preselected to authorize content. Explain the private grant-file
CLI steps without exposing bearer credentials in URLs or persistent browser
storage. Consent withdrawal and device revocation have separate actions.

Source profiles state local-only, metadata-only, partial coverage, awaiting
runtime, ready or revoked. Unavailable content has an explanation and next
action, not fabricated zero counts. P8 displays snapshots, not live transport:
show source capture/receipt time, report revision, pending work and stale
results separately. Queued/running work uses plain status text; failure offers
an explicit retry. Offline, expired-session and logout states clear protected
content and explain recovery. Profile changes must not retain another profile's
results. Private activity and credentials never enter localStorage or caches;
only the existing theme preference persists.

Acceptance includes a keyboard-only user connecting a fixture device and making
an informed opt-in; a phone user switching all four views and opening details;
and a returning user distinguishing pending/stale data from empty data. Verify
light/dark at phone and desktop sizes, text zoom/reflow, visible focus, signed
out, consent, pending, failure, populated and empty states. No accessibility
debt is accepted by this increment.

### P8 embedded primitives

The source/device card, snapshot status list, text field and native choice row
reuse the workshop surface, square corners, ink focus ring and 48px actions.
Choice rows include both the checkbox/radio and its visible explanation.
Historical upload remains unchecked by default. Once explicitly enabled, offer
either all available history in that exact prepared snapshot or a custom local
date range; saved all-history consent preserves the exact full range.

The embedded views inherit background/surface/ink/accent. Additional light/dark
text tokens are ink-3 #5f615a/#a2a79a, accent-2 #8f2917/#ffb3a0, success
#176333/#5fd38a, warning #74430a/#e9b65c and error #9c2416/#ff8c7a. Derived ink
washes are 5%/10%, lines 14%/30%, and accent wash 14% light/20% dark. Embedded
type uses 18px titles, 16px body, 15px secondary and 14px captions; on phones,
body text is at least 17px. Existing chart metadata may use 13px but not controls.
Popover shadow is 0 4px 16px black at 18% light/50% dark. Feedback transitions
use 120ms ease-out; no decorative animation is added.

Embedded detail titles are h2 beneath the page h1. Heatmap date targets remain
44px with a chart-owned horizontal scroller instead of widening the document.
Inline help tooltips render above sticky navigation. Chart values also remain
available through keyboard focus and each cell's accessible label.
Changing an embedded activity route brings its content below the sticky tabs
and focuses the named activity region. Background refreshes retain scroll;
the standalone local dashboard keeps its existing navigation behavior.
Tooltips use measured viewport coordinates outside chart scroll clips, keep a
24px edge inset and 8px anchor gap, and disappear when their anchor leaves view.
Their fade is interruptible; reduced motion keeps the fade without translation.
Focused content controls clear the measured sticky toolbar.
Opaque consent identifiers wrap without truncating or changing their value.

## 0. Research log

- Product: root README, local CLI/MCP, server registry and Worker distribution. The local CLI ships today; managed provisioning, signup and pricing do not.
- Taste: [tasteskill v2](https://github.com/leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md). Adopt subject-derived composition, full-ink copy, large type, a working example, and no invented proof. The subject's actual `SKILL.md` becomes the page's central artifact.
- Spatial contract: StyleGallery `sg:layout/webpage-generation-workflow`, use-cases section and homepage recipe. One document scroll owner; hook, explain, prove, compare, convert. No nested vertical scrollers.
- Reference shortlist: Vercel, Warp, Claude. Vercel selected for precise developer typography and readable code; its brand colors and logo are not copied.
- Direction: the approved Prompt brand made literal. A static terminal command, a Markdown file and an MCP handoff explain how skills reach an agent. Vermilion belongs to the prompt and transfer arrow; paper, ink and system monospace carry the illustration. Hosted capability stays distinct from working local tooling.
- Hero revision: native HTML/CSS replaces the cropped workshop raster. No stock or generated raster art, invented metrics, customer marks or simulated hosted dashboard.
- Google sign-in increment (owner brief, supersedes the earlier no-backend rule): `GET /auth/google` starts a code + PKCE OIDC flow, `GET /auth/session` returns `{user:null}` or the stored profile as no-store JSON, same-origin `POST /auth/logout` ends the session and redirects to `/login/`, and the callback lands on `/login/`, `/login/?error=cancelled` or `/login/?error=failed`. Sign-in is real and stores a minimal profile; MCP endpoint provisioning and dashboard activity remain previews.
- Owner-authorized domain launch: `https://skillar.sh` is canonical. The exact production Pages alias remains usable with its own host-bound callback, signed cookies and logout Origin; branch previews remain unauthorized. Both hosts retain the same visual design.

## 1. Audience and argument

Developers using multiple coding agents need portable instructions. Hook: one place to serve skills. Explain: write, serve, connect. Prove: actual Markdown and MCP resource flow. Compare: local/self-host today versus hosted coming soon. The SaaS-informed revision leads with deployment choice and Google account sign-in, alongside the working local path. No marketing signup form; Google profile storage is disclosed beside sign-in.

Account routes: `/login/` is the account page. Signed out, it offers a working "Continue with Google" link to `/auth/google`, a privacy note naming exactly what is stored, and a separate "Explore without signing in" link. Signed in, it shows the stored profile (name, email, picture, first and latest sign-in), a sign-out form and the onward preview link. `/connect/` shows a fixed MCP configuration on a reserved `.example` host, labeled as a non-working example, and reports sign-in status in its status list. `/dashboard/` has four empty views: Sessions, Workspaces, Flow, Heatmap, in the local dashboard's order, with sign-in status in the connection help. Only `/auth/session` is read, only on these three routes; nothing provisions an endpoint, connects or records activity. The audit behind the preview increment is `docs/design/web-ui-audit.md`.

## 2. Color

Approved brand: round-1 **07 Prompt**, not round-2 Slab, with **Vermilion Refined**.
The chevron and optically spaced lettering are outlined vectors, with no runtime
font. Header wordmarks render at 120px wide inside the existing 44px minimum
home-link target. Theme selection switches both ink and chevron colors; the
chevron alone is the small-size mark. Keep at least one chevron height of clear
space (52/500 of the wordmark width) around the visible artwork. Minimum sizes
are 96px for the wordmark and 16px for the icon. Never stretch, recolor, or add a
shadow to the artwork.

Light: background #F5F4EF, surface #FFFFFF, ink #1F201D, muted #5F615B, accent #B4321C, on-accent #FFFFFF.
Dark: background #171916, surface #212420, ink #F0F1E9, muted #A9ABA2, accent #FF8F70, on-accent #1F0E09.
Code: background #F2F1EB / #0F100E, ink #1F201D / #E7E8E0,
muted #5F615B / #A9ABA2, syntax #B4321C / #FF8F70 (light / dark).
Semantic tokens: success #1F6F3C / #76D48C, warn #8A5300 / #F4BE55,
error #B0123F / #FF7E9A, border #878983 / #6E716A. Error is crimson,
distinct from the vermilion brand accent; status still requires a text label.
These values map directly to the approved palette, including light code fields.
The complete bilingual usage guide, ANSI mapping, chart ramps, and export sizes
ship with the brand source package.
Focus uses current ink; no status conveyed by color alone.

## 3. Typography

System sans (`Arial`, sans-serif), code (`ui-monospace`, monospace). No external requests or font shifts.
Hero 80px desktop / 44px phone, line height 1.02, tracking -0.055em.
Section 48px / 32px, line height 1.08, tracking -0.04em.
Subhead 24px, body 18px, notes/code 15px. Weights 400, 500, 600.

## 4. Layout and spacing

Base 4px; spacing 8, 12, 16, 24, 32, 48, 64, 96, 128.
Max width 1280px; symmetric 48px gutters desktop, 24px phone.
Hero text and illustration share an asymmetric 1.15/1 grid with zero-minimum tracks. The illustration keeps a 24px safe area, a maximum width of 576px and intrinsic height; no fixed-height crop, transforms, hidden overflow or cover fitting. Its file and MCP handoff remain readable at 360/390/768/1024/1440/1920px. Workflow is an ordered editorial list. Skill example is split text/code. Comparison is a real table. FAQ uses native details.
At 760px all splits stack. Navigation wraps rather than disappearing. The document owns vertical scrolling. Code wraps long text rather than widening the page.

## 5. Primitives and states

- Remote command and publication facts, immutable pending requests, explicit
  recovery and private-pack catalog rows follow the P12 increment above.
- Action: square, 48px minimum target, primary accent fill / secondary ink wash. Hover underline, active inset ring without fading text, focus-visible 3px outline. A disabled CTA, if one returns, uses native disabled semantics with an adjacent explanation.
- Theme select: system/light/dark near the main navigation on every route, one shared state and storage key; visible label, native keyboard behavior. System is the default when nothing is saved. Source order always matches visual order.
- Code panel: theme-specific code field, readable tokens, filename header. Links use code-ink focus rings in both themes. Copy action reports success/failure through a live region.
- Disclosure: native summary, 48px minimum target; native triangle indicator, visible focus.
- Shell, cluster, split: reusable layout classes; paragraph measures provide content limiting and normal flow provides stacking. No bespoke per-section grids.
- Compatibility list: real agent names, not endorsement logos.
- Example switch: native select chooses an actual host configuration example; no invented remote URL.
- Wordmark: outlined 07 Prompt at 120px wide; its home link keeps a hit area of at least 44x44px. Light/dark exports follow the saved theme and system fallback without changing layout.
- Prompt illustration: noninteractive, informative `role="img"` with one accessible description; its internal terminal/file/agent labels are hidden from assistive technology to avoid duplicate narration. Uses only existing surface, code, ink, muted, border and accent tokens, 15px notes/mono, 24px command (18px below 1000px), and the 8/12/16/24/32px spacing scale. A neutral dotted field and inset file panel provide depth without shadows or new colors. No motion or network requests. The caption distinguishes local availability from planned hosted service.

### 5a. Account primitives

These use the tokens above. No new colors, fonts or radii.

- Availability notice: a bordered surface band at the top of every account route, before any action. Text in ink: "Google sign-in is live. MCP setup and the dashboard are still screen-only previews: no endpoint is assigned and no activity is recorded." Plus a link back to the landing page. It never collapses or dismisses.
- Account shell: same shell and gutters as the landing page. Header holds wordmark, a route nav (Account, Connect MCP, Dashboard) and the theme select. Nav wraps at narrow widths; it never hides. Each page has a unique title and one h1.
- Sign-in action: an accent-filled action link "Continue with Google" to `/auth/google`. A plain link, so it works without JavaScript; no popup, no script-driven redirect, no Google logo (same no-logo rule as the agent list). The privacy note sits directly after it and names what is stored: Google ID, email, name, picture, first and latest sign-in times; the session is a signed, secure cookie; Google tokens are not retained.
- Preview link: an action-styled link whose label names the outcome. Signed out it is the secondary "Explore without signing in"; signed in it is the primary "Preview MCP setup". One accent action per visible state.
- Session status line: a `.note` paragraph with `role="status"` under the lead. Text only: "Checking your account…", then "Not signed in." or a failure sentence; cleared when the signed-in card appears. Empty it has no height or margin but stays in the accessibility tree, so the change is announced.
- Callback message: a second status paragraph filled from `?error=`: "Sign-in was cancelled. Nothing was stored." or "Sign-in didn't complete. You can try again." Unknown codes get the second sentence; the query value itself is never rendered.
- Signed-in card: picture (48px square, `object-fit: contain` to preserve the complete source, `alt=""`, no-referrer, only for `https:` URLs, hidden on load error) beside "Signed in as", the name at subhead size and the email in muted small text (the email takes the name slot when Google sent no name). Below it a two-row status list for first and latest sign-in: `<time>` with an ISO `datetime` and locale-formatted text. The shared account schema validates the server response before rendering. Every value is set through `textContent`; never `innerHTML`.
- Sign-out form: a plain `<form method="post" action="/auth/logout">` with a secondary action button "Sign out", followed by a note that it ends the browser session and does not delete the stored profile. No fetch and no script, so the browser sends the same-origin `Origin` header the service requires.
- Account line: `data-account-line` text inside the connect status list and the dashboard connection help. Default "See the Account page for sign-in status." is true without JavaScript; the session check replaces it with "Checking your account…", "Signed in as {email}.", "Not signed in." or a sentence saying the status is unknown.
- Status line: text first, e.g. "Not connected — preview". A neutral square marker may precede it; color never carries the meaning. No green. "Signed in" appears only after `/auth/session` returned a user; "connected", "live" and "synced" stay banned for MCP and dashboard.
- Example config panel: the code panel with header "Example only, won't connect" shown before the copy button. Content is fixed client-specific JSON or a CLI example using an `.example` host; it's selectable and wraps rather than widening the page. No editable endpoint, token or secret.
- Copy feedback: a polite live region next to the button. Success: "Example copied." Failure: "Couldn't copy. Select the text and copy it manually." and the text gets selected. Messages stay until the next action; nothing times out.
- Agent selector: native select switching among fixed example configs. Changing it updates the panel and announces nothing beyond the new panel label.
- Step list: an ordered list labeled "Account journey" (Account, Connect MCP, Dashboard) with `aria-current="step"` on the current one. Display only, not a wizard and not a progress indicator.
- View nav: four links, Sessions, Workspaces, Flow, Heatmap, each at least 44px tall, with `aria-current="page"` on exactly one. Current view uses an ink underline plus bold weight, not color alone. No tab roles.
- Empty state: per view, an h2, one sentence on what would appear, one sentence on why it's empty in the preview, and one link onward (setup, or local `skillar open` instructions). No charts, zero-filled grids, counts, timestamps, skeletons or spinners.

### 5b. States

| State | Where | Rule |
| --- | --- | --- |
| Rest, hover, active, focus | all controls | Existing rules: underline on hover, contrast-preserving inset ring on action press, 3px focus outline in current ink (code-ink on code panels) |
| Checking | session status line, account lines | Plain text "Checking your account…" while `/auth/session` is in flight. No spinner, skeleton or dimming; the sign-in and exploration links stay usable |
| Signed out | login | Status "Not signed in."; sign-in action, privacy note and exploration link visible |
| Signed in | login, account lines | The card, sign-out form and onward preview link replace the sign-in action; connect and dashboard lines read "Signed in as {email}." |
| Session check failed | login, account lines | Unreachable: "Couldn't reach the account service…"; bad or non-OK answer: "The account service didn't answer as expected…". Signed-out actions stay visible; never a raw server string |
| Callback cancelled / failed | login `?error=` | Fixed sentences from 5a; the session check still runs |
| Current | route nav, view nav, step list | `aria-current` plus underline and weight |
| Empty | four dashboard views | Explanation and next link, never a loading look |
| Copy success / failure | example config | Live region text as above |
| Unknown view | dashboard hash | Falls back to Sessions and says so in the view heading area; never blank |
| No JavaScript | all routes | All content and links visible; theme falls back to system; copy shows selectable text. The sign-in link works; the login page says it cannot show sign-in status; account lines keep their neutral default |
| Storage blocked | theme | Choice applies for the page; nothing breaks |

Not used: disabled sign-in, connected, synced, spinners, skeletons, progress bars. MCP setup and the dashboard have no live state to show, so they have no styles for one.

## 6. Motion

No decorative animation. Control hover is an immediate underline; a pressed action gains an inset ring without reducing text contrast. All content visible without JavaScript. Reduced motion needs no separate reveal behavior. Route and view changes swap content instantly, and so does the swap from the sign-in action to the signed-in card; focus moves only in response to the person's action (to the new view heading). No spinners, progress bars or fake transitions.

## 7. Accessibility constraints

Visible skip link, semantic landmarks, one h1 per page, visible labels, keyboard-operable disclosures, no color-only status. Personal data is collected only by the Google consent flow that `/auth/google` starts, and the login page names what is stored before that link. No page pretends to provision a server.

- Targets: every interactive element is at least 44x44 CSS px at every width, including the wordmark and view nav. Action buttons stay at 48px.
- Contrast: ALL text is at least 4.5:1, including bold, large, labels, notes, disabled text and code. There's no 3:1 large-text exception on this site. Focus rings and control borders are at least 3:1.
- Token pairs, computed with the WCAG formula from the hex values above (rendered states still need checking):

| Pair | Light | Dark |
| --- | ---: | ---: |
| ink / background | 14.87 | 15.55 |
| ink / surface | 16.37 | 13.80 |
| muted / background | 5.70 | 7.61 |
| muted / surface | 6.27 | 6.75 |
| accent text / background | 5.59 | 7.93 |
| accent text / surface | 6.15 | 7.04 |
| on-accent / accent | 6.15 | 8.37 |
| code ink / code background | 14.47 | 15.46 |
| code muted / code background | 5.54 | 8.21 |
| syntax / code background | 5.44 | 8.55 |
| success / background | 5.61 | 9.74 |
| warn / background | 5.75 | 10.40 |
| error / background | 6.35 | 7.33 |
| border / background | 3.21 | 3.57 |
| border / surface | 3.54 | 3.16 |

- Syntax on the light code field (5.44) is the tightest text pair. Do not apply alpha to text tokens or use chart ramp colors as small text.
- Text reflows at 200% enlargement and at 320px width with no page-level horizontal scroll. Long example URLs break inside the code panel.
- Keyboard: tab order follows reading order; the sign-in link, exploration link and sign-out button are ordinary controls in that order; Back and reload keep the current route and view.
- Forced colors: borders, focus and current markers stay visible.

## 8. Accepted debt and boundaries

Hosted MCP provisioning, account dashboards, billing and prices are coming soon, not implemented. Google sign-in is implemented behind `/auth/*` (code + PKCE OIDC, owner brief). Stored: Google ID, email, name, picture, first and latest sign-in times; the session is a signed, secure, HttpOnly cookie; Google tokens are not retained. The browser additionally stores only the theme choice. Not available yet, so no copy promises them: account deletion, profile export, a retry control for a failed session check (the page says to reload). A no-JavaScript sign-out form remains available even though the page cannot display sign-in status without JavaScript. Timestamps from `/auth/session` are Unix seconds and are formatted in the reader's locale; a malformed account response shows a failed check instead of a partial profile. `/auth/*` answers 403 on any origin other than the configured production origin, its exact production Pages alias, or the configured localhost origin, which the pages report as the failed check rather than hiding it. Whether a future hosted service captures any local activity is undecided, and no copy may imply it does today. RTL isn't supported; new CSS should still prefer logical properties so it isn't harder later. Dashboard views use hash links inside one page, so a hosting change would need a recheck of deep links. English only; Korean toggle optional and omitted. Native system typography avoids CDN dependencies.

## 9. SaaS-informed information architecture

The owner's analogous-billing reference pass is recorded in
[`docs/design/saas-ia-comparison.md`](../docs/design/saas-ia-comparison.md).
Preserve this visual system; transfer the observed task sequence, not vendor
branding, prices, organizational complexity or authenticated sample data.

- Landing order: hero, deployment choice, hosted account journey, agent
  compatibility, how skills work, skill format, local setup, FAQ, footer.
  Hosting choice comes before installation detail. The install/migration block
  belongs with the working local setup, not the hosted prospect's first view.
- Navigation names the user tasks: Hosting, Hosted flow, Local setup, Docs.
  Before account pages ship, the hosted action truthfully reaches the on-page
  flow. The account increment replaced it with the account page entry, which
  the sign-in increment made a real sign-in.
- Login has one purpose and explains the next step. The working Google sign-in
  is distinct from an enabled, explicitly non-authenticating exploration link;
  signed-in people see exactly what is stored and how to sign out.
- Connect MCP keeps account scope, unassigned endpoint/credentials and
  client-specific example configuration separate. Copy labels say example.
  No Verify action, completed step or connected badge can imply a real service.
- Dashboard keeps connection help next to four empty activity views. Account
  context is informational and real: sign-in status from `/auth/session`,
  endpoint not provisioned, hosted pricing not announced. No fake user,
  organization, project, seat, trial meter, upgrade action or billing page is
  introduced.
- Reference access limits remain explicit: public sign-in was viewed; private
  onboarding/empty/settings were gated or supplemented by identified official
  documentation. A loading frame is not an empty dashboard.
