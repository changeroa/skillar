# PR-4 data table gate ledger

Base: `origin/main` at `abee112`. Branch: `uxb/pr-4-table`.
Evidence root: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-4/`.
Draft PR: https://github.com/changeroa/skillar/pull/103.
This is not an independent approval. No merge or production deployment.
The independent rejection of `106b8aa` is addressed by the review correction
below; its earlier 96-case and shadow-presence receipts are superseded.
The subsequent `9e71ad6` rejection found 24 omitted outer scroll regions.
The scroll-scope correction below supersedes that head's 840-target G3 receipt;
other gates retain their explicitly recorded runs, with no production changes.

| Gate | Status | Evidence and limits |
| --- | --- | --- |
| 1. Component visual parity | PASS for the requested computed-part criterion | 54 real read-only Demo states; 108/108 product cases, 6,440 painted-style/geometry assertions and 432 context assertions pass. All contexts match 1440x900/DPR1/mouse. All 108 side-by-sides and unmasked raw diffs are retained: 0/108 pixel identities, 5,918,028 differing pixels. Live records and content widths are not the acceptance criterion. |
| 2. Page comparison | PASS, rerun for the correction | 120/120 before/after/reference cases: 20 screens, 1440/390/1920, both themes. Fresh final-build documents, no document overflow or uncaught page errors. Raw differences remain visible. |
| 3. Keyboard and accessibility | PASS for corrected tested matrix | Fresh full capture: all 108 cases in both mouse and 390px/coarse profiles, 432+432 = 864 passing painted-focus targets. Includes all 24 populated/empty/loading scroll regions and all 40 conditional-clear observations. All 24 scroll-ring removals fail with zero contrasting pairs and pass after restoration. Inventory comparison preserves all 440 historical observations from `106b8aa` and all 840 state-specific observations from `9e71ad6`, with zero drops. Disabled-only pagination remains separately N.A. Prior offset-shadow, conditional-clear, 60px, keyboard/readiness and real-page sizing receipts remain retained, not newly rerun. |
| 4. Structural R1-R7 | PASS | 8/8 production-fixture cases. All assertions retained. R3 counts data cells, not the new empty-status row; its expected counts are unchanged. R4 remains N.A. in the inherited probe. |
| 5. Build and tests | PASS for affected checks; exact-head CI required | Scroll correction: four affected regressions, changed-script syntax and whitespace checks exit 0. Retained `9e71ad6` receipts: site 397/397, both builds, local typecheck and 108-case CLI. Historical local 984/985 has only the known `/tmp/h` ENOTDIR in cli-init; that unrelated suite was not rerun or changed. Final-head CI is mandatory before handoff. |
| 6. License and provenance | PASS | Five notices byte-identical; full MIT pin/license and font licenses retained and packaged. 205 renderer inputs; zero EE inputs. |
| 7. Deployment verification | Historical preview; not republished by this correction | Production not deployed; deploy gated on owner. The existing non-production preview is https://uxb-pr-4.skillar-site.pages.dev. Its earlier receipt is not a final-correction deployment claim. Current head and completed CI belong in `publication.json`. |

## Owner overrides

Absolute 32px mouse controls, 44px coarse-pointer or <=768px controls; visible focus;
correct WAI-ARIA semantics; native links and dialogs. The validator gives
owner sizing precedence even if the upstream and product share a wrong size.
Control height tolerance is 0.01px, independent of upstream height. Table rows
retain their separate density/content rules. Focus evidence compares actual
before/focused PNG pixels: two consecutive CSS pixels must change with at
least 3:1 contrast against the unfocused background. A white offset shadow
on white cannot pass. The stronger ring color is scoped to tables and their
menus, not shared tokens or PR-5 components.
Zero-width border colours are non-painted, not visual mismatches.

## Reference and verification limits

All eight inventory components have actual read-only Demo evidence, including
reachable text/collapsed facets, unsorted headers and cold-loading pagination.
Loading uses network latency, never a forced error. No source settings,
saved views or account data were written. No translated HTML stands in for
an actual component, and no reference image is changed or masked.

Gate 1 follows the PR-1 reviewed rule: where content differs, compare actual
painted-part computed styles and comparable geometry. Typography, effective
opacity, painted borders, colors, shadows, padding, indicator geometry and
row/control heights are asserted against the real Demo. Geometry tolerance
is 1px; colors compare exact RGBA bytes after Chrome color decoding.
No image or stylesheet is normalized, masked or resized by this comparator.
Raw pixel identity is diagnostic and is not claimed.

| Component | Passing cases |
| --- | --- |
| DataTable | 12/12 |
| SortableHeader | 12/12 |
| Row | 12/12 |
| Toolbar | 8/8 |
| FacetPanel | 20/20 |
| Pagination | 20/20 |
| Density | 16/16 |
| ColumnVisibility | 8/8 |

`table-states.mjs` enumerates required membership rather than trusting a total.
New states cover empty facets, nonempty toolbar search and an unchecked column.
Conditional facet clears are measured whenever present, including collapsed,
text and empty states. Both disabled and enabled column rows assert background,
padding and radius; enabled checkbox paint, geometry and opacity are asserted.
The real Demo shows these states read-only, so no pinned-MIT exception is used.
Facet references use the traces route; search-clear references use `/datasets`.
The source's nested clear `role=button` becomes a native button; the search
clear is keyboard reachable instead of the source's `tabindex=-1`.

Non-comparable content is enumerated by `tableContentExclusions` in
`validate-table-parity.mjs`: records and labels, row/column/option counts,
optional captions, text/model-driven widths, outer placement and list heights.
Source sticky-column backing surfaces are not non-sticky caller cells.
Unpainted wrapper fonts and zero-width border colors are excluded; actual
header, body-cell, field, mode and menu-label styles are not.
Caller-supplied toolbar content and large-column-list auxiliary controls
are not reconstructed; the rendered trigger and checkbox rows are measured.
The Demo represents no facet filter as all values checked; the facade uses
an empty selection. Checked/unchecked and disabled paint is matched by actual
DOM state, not by an invented equivalent screenshot. Known-total first/last
actions and busy disabling use the matching observed navigation paint.
Native semantics, 32/44px hit areas and visible 2px focus take owner precedence.

Current receipts: `review-demo-parts.json`, `review-table-input.json`,
`review-table-results.json`, `review-touch-parts.json`, `review-focus-pixels/`,
`review-negative-proofs.json`, `review-clear-negative-proofs.json`,
`review-native-60-proofs.json`, `review-keyboard.json`,
`review-real-sizing.json` and `review-comparisons/`.
Current G3 supersedes the focus fields in those older receipts:
`review-scroll-captures.json` contains all 216 case/profile captures;
`review-scroll-mutations.json` and `review-scroll-pixels/` retain all 24
PASS/FAIL/PASS sequences and paired PNGs. Complete prior/current lists,
multiset differences and zero-drop results are in `review-scroll-inventory.json`;
`review-scroll-summary.json` records 864/864 and 432 per profile.
The private `capture.mjs` uses `tableFocusSelector` from `table-focus.mjs`,
including the enclosing `.lf-table-scroll` when capturing an inner table.
The historical diff uses renderer/theme/viewport/tag/label with multiplicity;
only changing row timestamp/text suffixes are normalized to stable `example-N`
selection IDs. The 840-target intermediate diff additionally retains family/state.
The rerunnable entry is `review-scroll.mjs` in the evidence directory.
The held-catalog probe records the old status-row match with zero interactive
rows, subscribes before release, then verifies trusted Space on the loaded row.
Previous raw receipts remain available and are not rewritten as pixel passes.
The capture profile explicitly resets coarse-pointer emulation so mouse
comparisons cannot accidentally use 44px touch controls.

The real embed exposed a global `select { min-height: 44px }` enlarging the
transparent native Select beyond its 32px wrapper. The primitive now resets
that inherited minimum. The failing measurement is retained separately;
all 18 current real-page cases pass. `table-sizing.mjs` measures native hit
areas as well as visible controls.

Independent review is lead-owned, not an implementer approval. See the
evidence root's `gate.md`, `review-handoff.md` and `publication.json`.
The structural, license and preview receipts above are historical checks,
not new final-head executions. Current component, 120-screen, focus, build/test,
cleanup and exact-head CI receipts are required in the correction handoff.
Lighthouse, a full contrast audit, forced-colors screenshots and preview
authentication remain unverified.

## PR-5 widgets and charts (2026-11-10)

Implemented 11 exports across the nine requested families: Card/Widget,
MetricStrip/Metric, Bar, Histogram, Line, EmptyState, Alert, StatusMessage and
Callout. The two applications expose 34 showcase states. Existing chart
consumers use thin adapters; no table or facet implementation was changed.
Chart disclosures own their native-element styles at the component boundary,
including the hosted embed, instead of inheriting legacy details padding.

| Gate | Result | Measured evidence |
| --- | --- | --- |
| 1. Component parity | FAIL | 116 root/part comparisons; zero measured painted-field deltas, but complete per-state/composite pixel pairing is unverified. This is partial coverage, not full parity. |
| 2. Screen comparison | PASS | 30 before/after cases; 36 real Demo screens and 60 triptychs; no overflow or wrong viewport widths. |
| 3. Keyboard/ARIA | PASS | 684 gallery assertions and 72 trusted interaction assertions; real-page target, glyph, focus and fallback checks pass. |
| 4. R1-R7 structure | PASS | Eight home/empty cases; R4 not applicable to this probe; group-spacing checks require measured bins. |
| 5. Build/tests | FAIL | Site 403/403 and both builds/typechecks pass; local 984/985, with the same LaunchAgent ENOTDIR on untouched abee112. Clean-environment CI is reported on the draft head. |
| 6. License/package | PASS | Three matching notices; NOTICE included by npm pack; pinned MIT attribution retained. |
| 7. Deploy | PASS | `not deployed; deploy gated on owner` (production). Preview-only gallery: four real browser cases pass, both themes at 390/1440px. |

The local failure is `test/cli-init.test.mjs:159`, lstat of
`/tmp/h/Library/LaunchAgents/dev.skillar.daemon.plist`. The stray `/tmp/h`
was not edited or deleted. No assertion or validator threshold was weakened.

Preview: `https://uxb-pr-5.skillar-site.pages.dev/__gallery.html?widgets=1`,
deployment URL `https://8d28af60.skillar-site.pages.dev`.
The artifact adds the existing development gallery only to the preview;
normal production build/routes are unchanged. Its 34 states render with zero
runtime errors and 32px mouse/44px touch targets. The production deployment
remains `a876d0f7-c6e4-441a-a05c-bacfafc3d1b4` on `main`.
The comparison ledger separately records 48 non-painted equivalences and
12 equivalent color strings; neither is presented as a pixel match.

The first draft head failed clean-install Site CI because the development
reference host's `zod` import resolved through local dependencies. The site
TypeScript boundary now resolves it from the site's declared dependency,
matching Vite's existing dedupe rule. Four regressions also cover focus/hover
tooltip persistence, hover-only Escape dismissal, changed measurements and
measurements becoming absent. Tooltips resolve point identity against current
data rather than storing stale formatted strings.

### Callout-only reference decision

The parent's PR-5 amendment approves computed-style diffs against a labelled
render of the **actual MIT Langfuse Callout**, pinned at
`69181812b87169df157841fce1314ec96ecd2c5a`, for both variants and themes.
The reference is not a Demo capture. Both top/middle alignments were rendered
as well. Its actual component code is executed only by the retained reference
server; no Langfuse React component or screenshot is shipped in the product.
The independent reviewer must re-check this exception before merge.

The permitted Demo has no Callout: `/skills` is empty, organization overview
is outside the permitted project, and the evaluator upgrade path requires an
edit. The global migration status bar is not relabelled as Callout.

### Other absent states and checked routes

Real captures use the permitted project root, `/skills`, `/traces`, and recorded
session `chat_3dc9c765-eeb5-4a52-88b4-6883df36e1a1` under project
`cmmnj9e9n0006ad06nyz28646` at `https://jp.cloud.langfuse.com`.
No error, edit, create, setting change or new sign-in was induced.

The standing absent-state amendment covers these individually listed states:

- Alert: default/sm; info/default and sm; warning/default and sm;
  destructive/default and sm. The four real `/skills` Alerts are
  default/default, not these variant/size combinations.
- StatusMessage: DEFAULT, DEBUG and WARNING at default and compact;
  ERROR/default. The checked recorded tool status exposes ERROR/compact.
  There is no read-only control for changing its recorded level or size.

These references execute the actual pinned MIT components and are labelled
`ACTUAL-PINNED-MIT`, never Demo captures. Source inputs and raw reference
images remain separate from product images.

### Measurement scope and retained evidence

Computed comparisons cover the measured roots/parts. Widget composition and
MetricStrip layout are exercised in both galleries, not claimed as separately
pixel-paired Demo composites. Raw pixel diffs are retained without masks or
corner exclusions; caller content/layout and the owner's 32px mouse/44px
touch rule can differ from upstream. No full pixel-identical claim is made.
Zero-width borders, style-none outlines, zero-alpha shadows and equivalent
color syntax are reported separately and do not count as visual matches.

The live StatusMessage is compared over its observed 8px popover backing,
using the existing popover token in the development reference host. This
does not override primitive paint. All actions reuse PR-1 controls.
Real keyboard focus was inspected; the focus-removal mutation guard remains
active. Chart fallback tables remain complete after series filtering.

Retained lane artifacts include `widgets-qa.json`, `missing-state-results.json`,
`screen-results.json`, `source-full-screens.json`, `interaction-results.json`,
`structure/qa-structure.json`, `checks.json` and unmasked image comparisons.
Independent review, Lighthouse, a full contrast audit and forced-colors visual
certification remain outside the implementer's verdict. This is a draft-only
handoff; PR-4 must land first and production deployment stays gated.
