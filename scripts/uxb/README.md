# Component visual evidence

PR-4 table receipts and limits are in `GATE-STATUS.md`. `table-keyboard.mjs`
exercises sorting, selection, paging, menus and caller keyboard behavior.
`table-sizing.mjs` checks actual native hit areas on skills, sessions and the
mounted hosted embed; wrapper-only measurements miss inherited Select sizing.
Component capture, raw comparison and 20-screen matrix runners live in the
PR-4 evidence directory named by the ledger.

For the table correction, Gate 1 uses the PR-1 accepted rule: compare painted
parts and meaningful geometry against real Demo measurements when business
content differs. `table-parts.mjs` observes real DOM parts rather than cloning
them. `table-states.mjs` defines required state/theme/renderer membership;
`validate-table-parity.mjs` asserts all 108 product cases against
54 actual Demo states, including matching viewport/theme/DPR/pointer context,
header and cell fonts, row hover/selection, glyph geometry, density menu,
facet labels, empty results, conditional clear actions and enabled/disabled
column rows. Missing required parts or states fail closed. Colors use exact
Chrome-decoded RGBA bytes; comparable geometry tolerance is 1px. Control heights
are absolute owner values (32px mouse, 44px touch), within 0.01px, not a maximum
of owner and upstream sizes. Paired 60px source/product mutations must fail.

`tableContentExclusions` enumerates content/model-driven dimensions and owner
native-control differences. Whole-table pixels, labels and record counts are
not structural proxies for style parity. Original source/actual PNGs, all
side-by-sides and raw unmasked diffs remain separate diagnostics.

```sh
node scripts/uxb/validate-table-parity.mjs \
  /absolute/evidence/review-table-input.json \
  /absolute/evidence/review-table-results.json
```

The input contains `cases`, `references` and the Chrome-decoded `colors` map
recorded by the real capture runner. The report contains every assertion,
failure and per-component count. `table-focus.mjs` separately drives keyboard
focus on native controls and roving menu items, measuring actual painted pixels
and both target dimensions at 32px mouse and 44px touch. Tab intentionally
dismisses a menu, so menu auditing uses its arrow-key focus contract.
Use `tableFocusSelector(specimenSelector)` for capture scope: an inner table
also includes its enclosing keyboard-scroll region. Populated, empty and loading
regions remain focus targets in both renderers/themes/profiles. The current
216-case/profile receipt contains 864 targets, including 24 scroll regions;
all 24 ring-removal probes must fail and pass after restoration. Diff the full
target lists, preserving multiplicity, against both historical matrices:
440 observations at `106b8aa` and 840 at `9e71ad6`. See `review-scroll-inventory.json`.
`focus-paint.mjs` compares unfocused/focused PNGs, requiring two adjacent CSS
pixels with at least 3:1 contrast. Nonempty or background-colored shadows are
not proof of visible focus. Passing an output prefix retains both PNGs.
Ring-only removal, conditional-clear removal and 60px control mutations must
fail before restoring. The hosted keyboard harness waits for an interactive
`tr[tabindex="0"]`, never the loading/empty status row. Register the ready
signal before releasing a held request or activating the loaded row; no sleeps.
Pin the actual viewport after navigation and assert `innerWidth`; labels
alone do not prove a phone capture.

Skillar is a Preact application. This harness captures live DOM specimens,
computed geometry, real hover/focus/held-pointer states and optional Langfuse
references without introducing a second renderer or a browser dependency.

Run `npm ci` in site and local, then:

```sh
cd site && npm run dev -- --port 5177
# another terminal, from local:
npm run dev:dashboard
# use its printed port for the local gallery URL
```

Both serve `/__gallery.html?theme=light` (also dark/system). The gallery is not
included in either production build. Restart local dev after CSS asset changes.

```sh
OMOWRIGHT_HELPER=/path/to/browser/scripts/omowright.mjs \
  node scripts/uxb/capture.mjs manifest.json /absolute/evidence/directory
```

The supplied browser adapter attaches to Chrome on port 9333. It creates one
owned tab, never opens a second browser, and closes only that tab on exit.
Stop the run if Chrome freezes. Runs stop below 8 GiB free on `/`.

Manifest shape (paths are relative to the manifest):

```json
{
  "requireReferences": true,
  "profiles": [
    { "id": "desktop", "width": 1440, "height": 900 },
    { "id": "phone", "width": 390, "height": 844, "touch": true, "deviceScaleFactor": 3 }
  ],
  "pages": [{
    "id": "site",
    "url": "http://127.0.0.1:5177/__gallery.html",
    "ready": "#gallery[data-ready=true]",
    "states": [{
      "name": "control-hover",
      "selector": "[data-component=control] [data-state=hover]",
      "action": "hover",
      "expected": { "height": 32, "fontSize": 13, "lineHeight": 20, "hovered": true },
      "touchExpected": { "height": 44 },
      "reference": { "light": "langfuse-light.png", "dark": "langfuse-dark.png" }
    }]
  }]
}
```

Phone captures use mobile layout, touch/coarse pointer and DPR 3; the harness
asserts the real CSS viewport, DPR and pointer mode rather than trusting labels.
For isolated component parity, `isolateSpecimens: true` places each live
`[data-specimen]` card at the same integer origin with a 242px sample column,
before layout and interaction. It restores both inline styles afterward.
This avoids comparing fractional descendant positions from different gallery
rows. The real components are neither cloned nor raster-resized. Input
spellcheck is disabled in this synthetic fixture on both sides, and previous
focus/selection is cleared before each state. Full-page captures still show
the normal gallery. `focusSelector` can target an inner input while `selector`
continues to capture the complete search shell and its ring.

Clipboard actions `copying`, `copied` and `copy-error` capture the whole
feedback region, not just the icon. `actionSelector` optionally names its
button. The localhost-only transport supplies a pending, resolved or rejected
clipboard promise; the real component handler drives the visual state.
An observer is armed before trusted activation and asserts busy/disabled,
check or visible error feedback. The clipboard seam is restored afterwards.
Infinite animation effects use the component's static underlying CSS during
capture. A paused transform/opacity animation keeps a resampled compositor
texture, producing false SVG and rounded-fill differences even at time zero.
Finite interaction transitions still finish through their exact promises;
loading, status and skeleton cases remain in the matrix.
Each profile runs light and dark, top/end viewport captures plus every named
specimen. Crop padding is 4px for rings. Actions: none, hover, focus (trusted
Shift+Tab/Tab), active (pointer held until after capture). Specimen geometry
is cropped from the full composited viewport on integer device pixels, rather
than asking Chrome to repaint a fractional CSS clip. Temporary relative layout
offsets align its origin; two animation frames observe the resulting paint.
CSS `translate` is deliberately avoided because it interpolates border pixels.
The specimen must fit
the viewport; use a larger profile for taller specimens.
Specimen geometry
must match within 1px; strings, booleans, colors and ARIA values match exactly.
Provide computed upstream properties through `expected`; the harness never
guesses them from an image.
Use `themeExpected: { "light": {...}, "dark": {...} }` for exact theme colors,
and `profileReferences: { "phone": { "light": "...", "dark": "..." } }` when
responsive states need different reference crops.

Reference images are never resized. The side-by-side canvas preserves each
input's pixels; dimension mismatch fails. The diff includes alpha differences,
with changed pixels in magenta. Results record original dimensions and ratios.
The default RGB channel tolerance is zero. `pixelChannelTolerance: 2` is an
explicit opt-in for demonstrated rounded-edge rasterization noise, not a color
token tolerance. Raw differing pixels and maximum channel delta are always
recorded and highlighted, including within-tolerance pixels; alpha differences
always fail. Computed color and geometry checks remain exact/1px respectively.
For the separately rendered raw-CSS reference, `compare.mjs` also accepts an
explicit final argument `8`: RGB deltas up to 8 only in the four rounded-corner
boxes (4px crop inset, measured radius, scaled by DPR). Interior pixels remain
zero-tolerance and alpha always remains exact. The default is still zero.
Results retain every raw pixel difference, per-channel maxima, accepted corner
counts, and the policy coordinates. Use this only with a recorded edge-raster
diagnosis; it cannot accept text/icon or flat-color drift.

## Actual public Demo comparisons

The owner's real-Demo amendment makes this the Gate 1 reference. Pinned
primitive comparisons remain supplementary; their conflicting defaults do
not override the deployed Demo. Geometry remains +/-1 CSS px and token colors
exact, with no image masks or tolerance changes. Matching-content raw diffs
are reported explicitly, not renamed identical.

```sh
OMOWRIGHT_HELPER=/path/to/browser/scripts/omowright.mjs \
  node scripts/uxb/demo-compare.mjs /absolute/demo-captures/records.json /absolute/demo-comparisons
```

This separate runner consumes actual source PNGs and recorded styles from
the explicitly permitted public Demo project. It opens only localhost
product fixtures, with one capture tab and one composition tab on Chrome
9333. Do not run another keyboard-driving harness concurrently.
The development-only `?demoControl=Button` host selects real shared Preact
controls and their ordinary public props. It never overrides primitive
padding, fonts, colors, radii or focus styling. Host placement preserves
the source crop's fractional device-pixel phase; raw source PNGs are untouched.

Each site/local light/dark pair records height, padding, typography, radius,
border/color tokens, shadow and native outline assertions, plus side-by-side
and zero-tolerance raw pixel diffs. A completed run is not a parity PASS:
read each `styleStatus` and `pixelStatus`. OS-native expanded Select states
are explicitly `NATIVE-ADAPTATION`, never silently passed. Missing Demo states
belong in the provenance ledger as "no demo instance"; scratch evidence is
supplementary, not a substitute.

Each result also records `computedStyleStatus` and its `computedReference`.
Source crops are checked before comparison for nonblank pixels and, for checked
Checkboxes, contrasting fill/check pixels. A visual inventory review still checks
that labels, glyphs and states are correct; nonblank alone cannot establish that.
Input/SearchInput focus shadow mismatches are retained as
`OWNER-APPROVED-DIFFERENCE`, with the original expected/measured values: the owner
requires a painted ring, unlike the Demo's zero-spread shadow. Other mismatches
still fail. Skeleton opacity is compared exactly; its real Demo pulse is captured
at recorded time 0ms (opacity 1), matching the reduced-motion product frame.
The native options-panel case uses the actual closed Score trigger for those
assertions while retaining the original popup PNG/raw diff. Mono specimens
must have the actual `plexMono` FontFace loaded; a matching family string
alone is insufficient. Owner-approved 32/44px and native/WAI-ARIA differences
remain named separately. Product variants, not host CSS overrides, match
header/table Tag and compact/regular Select.

```sh
node scripts/uxb/compare.mjs captures/results.json upstream site,local diffs 8
node scripts/uxb/keyboard.mjs site-gallery-url local-gallery-url keyboard-evidence
node scripts/uxb/screens.mjs matrix-config.json screen-evidence
node scripts/uxb/screens.mjs matrix-config.json screen-evidence summary
```

These commands use the same `OMOWRIGHT_HELPER` environment variable. Screen
captures force a fresh document for each build cookie, record asset URLs and
document identities, and use a unique fetch counter plus exact DOM/paint signals.
Missing provided screen references produce a labelled `no reference` panel;
the summary lists provided and absent filenames without failing before/after
delivery.

Missing references fail by default. A foundation-only metrics run may set
`requireReferences: false`, but its PASS proves metrics, **not upstream parity**.
Review `results.json` and cite the side/diff files; a numeric pass does not
replace independent visual or accessibility review.

Fixtures carry no user data. The page owns its existing scroll and control
behavior. For async components, use a ready selector reflecting the settled
state; there are no sleeps or retry loops. Tests run with `site/npm test`.

## PR-7 complete-field certification

The committed `local-style-inventory.json` and
`local-state-style-inventory.json` name every required ready/non-ready target
and its visible count. Missing, hidden or removed targets fail; intentionally
collapsed descendants are represented by their own state, not discovered and
silently omitted during validation.

With the production local/hosted surface harness running on 5184:

```sh
node scripts/uxb/local-full-style.mjs "$PR7_EVIDENCE" "$PR6_DEMO_CONTROLS"
node scripts/uxb/local-nonready-style.mjs "$PR7_EVIDENCE"
node scripts/uxb/local-interaction-style.mjs "$PR7_EVIDENCE"
```

These commands require `OMOWRIGHT_HELPER` and the source records/real-surface
loader in the evidence directory. They compare all 22 required fields: height,
four paddings, font size/line height/weight, radius, four border colours/widths,
outline colour/style/width/offset and painted shadow. CSS Typed OM preserves
intrinsic `auto` height instead of comparing unrelated fixture content heights.
The owner 32/44px controls, native panel geometry and named source compositions
are explicit in `local/dashboard/DESIGN.md`; no observed value becomes its own
expected style. Transparent zero shadows and unpainted outlines are canonical
non-paint, not tolerated painted differences.

Tree, Timeline, JSON disclosure and view-tab states are driven through real
hover, keyboard focus, pointer press, selection, disablement and collapse/expand.
Loading/error/empty use the real product API boundary. Every field has a
corruption probe, and removal uses the same missing-observation predicate.
Focus raster probes cover fractional origins at DPR 1 and 3 and reject both
1px and white indicators.

`local-paint-inventory.json` separately freezes DOM counts, part indices/classes,
channels and exact paint values (including ancestor opacity, channel opacities
and dash). It preserves owner-native plot paint as well as shared components;
source colour/icon/primitive comparisons remain separate source-parity checks.
The normal audit never regenerates this inventory. An intentional source or
owner-contract correction requires review of its inventory diff and a complete
mutation rerun, not accepting a smaller discovered set.

With the development galleries on site 5183/local 5184, run
`node scripts/uxb/local-json-primitives.mjs "$PR7_EVIDENCE"` for all four JSON
primitive types. Its fixture uses the actual `JsonViewer`; release-build tests
must continue proving gallery fixtures are absent from shipped artifacts.
