# PR-5 widgets and charts: rebased certification

Draft PR: https://github.com/changeroa/skillar/pull/104
Branch: `uxb/pr-5-widgets`. Merged PR-4 base: `431fb9b0351c6f82eaacb16e36b32f7c7c658f32`.
Evidence root: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-5/`.
Exact published head and terminal CI: `publication.json` and `ci-final.json` in that root.
This is implementer evidence, not independent approval. No merge or production deployment.
All current product receipts were regenerated after the rebase; immutable source captures were reused.
`combined-audit.json` verifies fresh receipt timestamps, complete membership and zero unexpected failures.
The historical PR-4 ledger is retained unchanged at the end, not presented as fresh certification.

## Seven gates

| Gate | Result | Fresh rebased evidence |
| --- | --- | --- |
| 1. Component parity | PASS, measured-part contract | 74 states / 296 paired cases; 10,028 assertions, zero failures. 4,992 painted, 4,056 geometry and 980 non-painted checks remain separate. All 296 geometry and 200 control-paint corruptions are rejected. |
| 2. Screen comparison | PASS | 30 before/after comparisons against merged main; 120 top/end captures, 36 retained genuine Demo screens and 60 refreshed triptychs. Zero overflow, wrong viewport or runtime errors. |
| 3. Keyboard and ARIA | PASS for tested matrix | 648 base captures, 1,860 assertions and 72 interaction checks. 708 gallery and 720 real-page painted focus targets pass ring-removal probes; 636 real-page SVG points receive native Tab. All 96 dismissed/restored states pass. |
| 4. R1-R7 structure | PASS | Eight populated/empty cases. Exact and painted R7 baselines and corruption probes pass. R3 still expects zero/five data rows; PR-4 status rows are excluded. R4 remains inherited N.A. |
| 5. Build and tests | FAIL: known local environment only | Site 417/417; both builds, local typecheck, performance, syntax and whitespace checks pass. Local 984/985 has only the known /tmp/h ENOTDIR. Clean-environment final-head CI is reported separately, without erasing this local result. |
| 6. License and package | PASS | Five byte-identical notices, 12,817 bytes; final dry-run package includes NOTICE among 177 files. 29 actual pinned-MIT renderer inputs; zero EE inputs. Both PR-4 and PR-5 attributions retained. |
| 7. Deployment verification | PASS: preview only | Production: "not deployed; deploy gated on owner". Preview e7d512fc-e6f0-4554-8a95-f6cd32c075ff: four desktop/phone and light/dark cases, 54 specimens, zero errors/overflow, 32/44px controls. Production unchanged. |

## Component and state membership

Eleven exports, 54 base specimens and 74 tested states in both apps and both themes.
The 20 derived states are 12 chart interactions and eight dismissed messages.
`widget-states.mjs` asserts exact membership, including equal-count omission detection.

| Component | States | Paired cases | Assertions | Failures |
| --- | ---: | ---: | ---: | ---: |
| Card | 2 | 8 | 288 | 0 |
| MetricStrip/Metric | 5 | 20 | 304 | 0 |
| Bar | 7 | 28 | 1,528 | 0 |
| Line | 7 | 28 | 1,528 | 0 |
| Histogram | 7 | 28 | 1,288 | 0 |
| Widget | 6 | 24 | 1,152 | 0 |
| EmptyState | 3 | 12 | 292 | 0 |
| Alert | 13 | 52 | 1,676 | 0 |
| StatusMessage | 10 | 40 | 560 | 0 |
| Callout | 14 | 56 | 1,412 | 0 |
| Total | 74 | 296 | 10,028 | 0 |

Conditional contracts cover minimal Cards, metric affixes/empty strips, chart empty/null/fallback
states, optional Alert title/icon/actions/dismissal, Callout absent actions/internal/external links/
disabled actions, Widget empty/error without actions, and explicit status/error announcements.
Every case retains source, product, original-size side-by-side and unmasked raw diff.
Caller strings, data, orientation and native composition differ visibly; no pixel-identity claim.

The assertion provenance is 3,564 real-Demo, 6,152 actual-pinned-MIT and 312 owner overrides.
The 24 equivalent CSS color spellings are a subset of painted matches, not additional evidence.
Geometry, transparent fills/shadows, zero-width border colors and unused SVG root fonts/colors
are not counted as painted visual matches. The supplementary legacy diagnostic has 60 root-only
comparisons and 32 non-painted serialization/unused-font deltas; it is not added to the matrix.

## Owner overrides and mutation evidence

Controls are exactly 32px with mouse, 44px with coarse pointers or width <=768px, tolerance 0.01px.
This absolute predicate takes precedence even when upstream and product both incorrectly measure 60px.
Eight real 60px mutations cover desktop/phone and fine/coarse pointer combinations in both themes.
Two invisible white offset shadows on white are rejected with zero contrasting pixels and 1:1 contrast.
Focus uses actual PNG pairs, a >=3:1 changed indicator band and a perimeter-sized pixel requirement.
The minimum observed gallery maximum contrast is 3.91075:1. All 708 gallery and 720 real-page
rings pass normally and fail after removal; the 96 restored controls are included in the 708.
Ten additional nominal pixel probes pass. SVG points retain native lowercase `tabindex`.
Trusted Tab reaches the real target from a temporary adjacent origin, removed before capture;
there is no reverse-Tab/document-boundary timing dependency. Disabled controls retain native semantics.

Held-catalog readiness is proved in both themes: a generic status row cannot satisfy the actual
interactive-row predicate. Subscriptions precede release. Two named signals cannot resolve each
other. There are no readiness sleeps. Tooltip focus/hover identities, Escape, native disclosures,
series filtering and complete named null-aware fallbacks pass the 72 interaction checks.
`visual-negative-probes.json`, `readiness-probes.json` and `widgets-qa.json` retain these receipts.
Earlier failing source-style and focus runs remain in `parity-regressions.json`,
`visual-negative-before.json`, `focus-review-regressions.json` and their cited PNG directories.

## Fresh merged PR-4 table validators

Table/facet implementation and all merged table validators are unchanged from the requested main.
Fresh isolated runners and output live in `rebased-pr4/`; original PR-4 evidence is untouched.
The actual merged CLI validates 108/108 cases with 6,872 assertions (6,440 measured plus 432 context).
All 108 fresh source/product pairs and unmasked raw differences are retained.
The 216 mouse/phone captures yield 864/864 painted focus targets, 432 per profile, including every
one of the 24 populated/empty/loading outer scroll regions and 40 conditional-clear observations.
All 24 scroll-ring PASS/FAIL/PASS sequences pass; the complete inventory preserves all 440 older
and 840 intermediate observations with zero drops. No table target or historical state is removed.

Fresh negative coverage: 40 conditional-clear ring removals, eight offset-only shadows, eight
native 60px controls, two coupled upstream/product 60px matrices and both disabled/enabled column
paint mutations. All corruptions fail and restore successfully. Additional profiles retain 22
conditional/white-shadow/native-coupled probes. Gallery, hosted skills and local sessions keyboard
workflows pass sort, mixed selection, column/density menus, URL reloads, row opening and Escape
focus restoration. All 18 real table-sizing cases pass exact 32/44px checks, including native hit areas.

## Conflict decisions and combined repairs

- Notices: union complete PR-4 table and PR-5 widget attribution under the same pinned MIT license.
- Gallery: retain default TablesGallery; add query-selected WidgetsGallery and WidgetsReference.
- Design and ledgers: preserve both component contracts and the complete historical table ledger.
- Shared tests: retain PR-4 DOM helpers/tests and namespace-sensitive SVG attributes from PR-5.
- Fresh combined tests exposed one stale `ui-chart` selector; use `lf-chart` while preserving
  measured-zero and exact-baseline assertions. No product behavior or expected value was weakened.
- Structural harness carries forward PR-4 data-cell-only row counting; empty status rows and chart
  fallback rows are not business records. All R3 expected counts remain unchanged.

The exact prior remote lease is `a4a10a9a154fce2dae707e845ebc15afe6141bb9`.
Backup: `backup/uxb-pr-5-pre-main-431fb9b-a4a10a9`. Full decisions: `rebase-decisions.json`.

## Reference provenance and permitted unavailable states

Retained references: `state-sources.json` (40 real Demo parts and 136 actual-MIT parts),
`real-sources.json` (recorded ERROR/compact takes priority) and `conditional-sources.json`
(52 actual pinned-MIT part records). Source SHA: `69181812b87169df157841fce1314ec96ecd2c5a`.
Actual source code runs only in the external reference renderer; no React, Radix, cmdk or EE is shipped.

Read-only Demo project: `https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646`.

| Checked route | Available / unreachable state |
| --- | --- |
| Root | Card, numbers, Bar, Line, pointer tooltip; loading/failure not induced. |
| /skills | Empty intro and four default/default Alerts; no other variant/size selector or Callout. |
| /traces | Histogram and observed 10px/80%-alpha tick labels. |
| /sessions/chat_3dc9c765-eeb5-4a52-88b4-6883df36e1a1 | Recorded tool ERROR/compact only; other levels/sizes cannot be selected. |
| /topics | Not found / unavailable; retained topics-read-only-unavailable.png. |

Standing-state actual MIT references cover Alert default/sm and non-default variants at both sizes;
StatusMessage DEFAULT/DEBUG/WARNING at both sizes and ERROR/default; default Topics-style Empty,
Skeleton and destructive-Alert parts in unavailable Widget/chart states. Available parts remain real
Demo. Conditional actual-MIT button, icon-only/no-title Alert and Callout parts retain explicit labels.
Zero/null data and native fallbacks are owner adaptations; null is never substituted with zero.

The lead's whole-component Callout Amendment permits actual pinned MIT renders, both variants,
themes, top/middle alignments and action parts. They are never called Demo captures. The permitted
catalog is empty, organization overview is outside the project and evaluator upgrade requires an edit.
No Demo errors, writes, creates, settings changes or new sign-in were induced.
`read-only-state-routes.json` retains route evidence; independent review must re-check the Amendment.

## Publication and remaining limits

Preview: https://uxb-pr-5.skillar-site.pages.dev/__gallery.html?widgets=1
Immutable: https://e7d512fc.skillar-site.pages.dev/__gallery.html?widgets=1
Only non-production branch `uxb-pr-5` was deployed. The artifact adds the existing development gallery;
normal production routes/build configuration are unchanged. Production remains
`a876d0f7-c6e4-441a-a05c-bacfafc3d1b4`, verified after preview publication.
NOTICE SHA256: `a75a39ae7250a764cb3cbe8b61babe293923e693699edb33e1ecd5258f18b57f`.

The sole executed failure remains `ENOTDIR: lstat /tmp/h/Library/LaunchAgents/dev.skillar.daemon.plist`
at `local/test/cli-init.test.mjs:159`, reproduced on the untouched earlier main baseline. Nothing at
`/tmp/h` was changed or deleted. `site-tests-rerun.log` retains the successful corrected 417-test
summary; the earlier failure log is retained separately. Exact-head CI must be terminal before handoff.

Independent review is lead-owned. Lighthouse, a full contrast audit, forced-colors screenshots and
preview authentication remain unverified and are not presented as passes. Keep the PR draft.
No merge or production deployment is authorized. Cited source/pair/diff evidence and baseline
worktrees remain; `cleanup.json` records prior removal of owned, superseded intermediates.

---

# Historical merged PR-4 ledger (unchanged)

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
