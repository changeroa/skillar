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

---

# PR-5 widgets and charts gate ledger

Draft PR: https://github.com/changeroa/skillar/pull/104
Branch: `uxb/pr-5-widgets`. Baseline: `abee112ac78e3ebc97dc0b0fcb401b15539be7f2`.
Evidence root: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-5/`.
Exact pushed head and terminal CI results are recorded in `publication.json`
under that evidence root after publication. This is an implementer verdict,
not independent approval. No merge or production deployment is authorized.

## Seven gates

| Gate | Verdict | Measured evidence |
| --- | --- | --- |
| 1. Component parity | PASS for the declared style/state contract | 204 paired cases: 51 states, both apps, light/dark. 5,524 assertions pass: 3,332 painted-style, 1,716 geometry, 476 non-painted checks. Every case retains source, product, side-by-side and unmasked raw diff. |
| 2. Screen comparison | PASS | 30 real before/after comparisons, 120 top/end captures, 36 retained genuine Demo screens, 60 refreshed triptychs. Zero viewport, overflow, sizing, glyph, focus or fallback failures. |
| 3. Keyboard and accessibility | PASS for tested matrix | 468 component captures; 1,224 matrix assertions and 72 interaction assertions pass. 528 gallery and 720 real-page focus-removal probes reject missing rings, including 636 native SVG point Tab checks. |
| 4. R1-R7 structure | PASS | Eight home/empty cases pass. R4 is N.A. in this inherited probe. R7 also passes exact SVG and painted zero-baseline checks across 12 app/width/theme contexts. |
| 5. Build and tests | FAIL: pre-existing local environment only | Site 404/404; both builds, local typecheck, performance and harness syntax checks pass. Local 984/985: the unchanged baseline also fails `cli-init.test.mjs:159` with `/tmp/h` ENOTDIR. Final-head clean CI is recorded separately in `publication.json`. |
| 6. License and package | PASS | Five source/build notices are byte-identical. Final dry-run package includes NOTICE, 12,226 bytes, among 177 files. Actual pinned MIT renderer has 27 inputs and zero EE inputs. |
| 7. Deployment verification | PASS: preview only | `not deployed; deploy gated on owner` for production. Preview `156e7543-7e57-4319-ad74-0b2edf578c7e` passes four desktop/touch and light/dark browser cases: 39 specimens, zero runtime errors or overflow, 32/44px targets. Production ID is unchanged. |

Totals: six PASS, one FAIL limited to the documented local baseline.
Independent review, Lighthouse, full contrast and forced-colors visual
certification remain unverified; none is represented as an implementer pass.

## Per-component state coverage

Each state below runs in both applications and both themes. A case includes
computed-style assertions with an explicit source record, original-size
side-by-side/raw diff, and a geometry corruption/restoration probe.
`state-parity.json` contains each field, actual/reference value and provenance;
`state-evidence-summary.json` contains the table and strict evidence taxonomy.

| Component | States | Paired cases | Assertions | Failures |
| --- | ---: | ---: | ---: | ---: |
| Card | 1 | 4 | 132 | 0 |
| Widget | 4 | 16 | 596 | 0 |
| MetricStrip / Metric | 3 | 12 | 244 | 0 |
| Bar | 7 | 28 | 848 | 0 |
| Line | 7 | 28 | 848 | 0 |
| Histogram | 7 | 28 | 848 | 0 |
| EmptyState | 2 | 8 | 168 | 0 |
| Alert | 8 | 32 | 832 | 0 |
| StatusMessage | 8 | 32 | 480 | 0 |
| Callout | 4 | 16 | 528 | 0 |
| Total | 51 | 204 | 5,524 | 0 |

- Card: header, title, description, content, footer and action-bearing shell.
- Widget: ready, loading, empty and error; Card and state-content parts are
  separately paired with their genuine Demo or permitted MIT references.
- Metric: three-value strip, measured zero and unmeasured. Number typography
  uses real Demo measurements; muted unmeasured ink uses the Demo note ink.
  Strip gap uses the measured 16px dashboard content spacing.
- Every chart: default, hover tooltip, keyboard tooltip, hidden series,
  expanded data table, entirely unmeasured and empty data. The gallery has
  all three chart families' empty/unmeasured states, not just one proxy.
- EmptyState: default and intro.
- Alert: default/info/warning/destructive at default/sm sizes.
- StatusMessage: DEFAULT/DEBUG/WARNING/ERROR at default/compact sizes.
- Callout: info/warning with top/middle alignment, including actual action
  and dismiss controls. Dismissal and restoration are additionally exercised
  in all eight app/width/theme interaction cases.

The gallery contains 39 base specimens; 12 additional chart interaction
states make the 51-state parity matrix. There are 11 component exports.
Card/Widget and MetricStrip are native compositions: their constituent paint
and spacing are measured separately, not relabelled as a Demo composite.
Caller strings, chart data, chart orientation and native fallback layout can
differ in raw pixels. No pixel-identical claim, threshold, mask, corner
exclusion or invisible-paint match is used.

## Reference provenance and standing-rule states

`state-sources.json` retains 40 fresh real Demo part records and 136 labelled
actual-MIT part records, with images. Two retained real recorded ERROR/compact
StatusMessage records in `real-sources.json` take precedence over MIT.
Of the 5,524 assertions, 3,048 use real Demo measurements and 2,476 use
permitted actual-pinned-MIT measurements.

All live routes are under
`https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646`:

| Checked route | Observed / unavailable state |
| --- | --- |
| Project root | Ready Card, number, Bar, Line and real pointer tooltip. Loading/failure were not induced. |
| `/skills` | Empty intro and four default/default Alerts. No other Alert variant/size selector and no Callout. |
| `/traces` | Real Histogram and 10px tick-label paint, including muted ink at 80% alpha. |
| `/sessions/chat_3dc9c765-eeb5-4a52-88b4-6883df36e1a1` | Recorded tool ERROR/compact only; other levels and sizes cannot be selected. |
| `/topics` | "Not found. This page is not available." Retained `topics-read-only-unavailable.png`. |

Standing-state references execute actual MIT files at
`69181812b87169df157841fce1314ec96ecd2c5a`:

- Alert default/sm and info/warning/destructive at both sizes use actual Alert.
  Default/default stays on real `/skills` measurements.
- DEFAULT, DEBUG and WARNING at both sizes, and ERROR/default, use actual
  StatusMessage. ERROR/compact stays on the real recorded message.
- Default EmptyState and chart/Widget empty/unmeasured compositions use actual
  TopicsEmptyState parts because `/topics` is unavailable. Intro stays real.
- Widget loading uses actual Skeleton fill/radius; error uses the actual
  destructive Alert. Common Card parts remain real Demo in every state.
- Zero/null chart and metric data are owner R7 adaptations. Null is never
  substituted with a measured zero.

### Callout-only lead Amendment

The lead explicitly permits labelled renders of the actual pinned MIT
Callout, both variants and themes; top/middle alignments and action parts
are also measured. These are never called Demo captures. The permitted
catalog is empty; organization overview is outside the allowed project;
the evaluator upgrade path requires an edit. The migration status bar is
not a Callout. No errors, writes, creates, settings or new sign-in were induced.
`read-only-state-routes.json` records every unavailable-state decision.
The reviewer must re-check the Amendment before merge.

## Mutation probes and repaired failures

The expanded baseline exposed 196 style failures, retained as assertion data
in `parity-regressions.json`. Fixes cover chart caption typography,
Histogram tick alpha, empty-state heading/gap, metric null typography, and
Callout action paint, padding and alignment. Real tooltip measurements also
now govern its surface, border, radius, spacing, type and shadow.

A real accessibility failure was also found: camel-case SVG `tabIndex`
produced a case-sensitive XML attribute that Chrome ignored. Points now emit
native lowercase `tabindex`. The test DOM preserves SVG attribute case; the
new regression failed before the fix and passes for Bar, Line and Histogram.
Native forward/reverse Tab, not only `.focus()`, now reaches every tested point.

All 204 state geometry corruptions are rejected by the same reference
predicate used before mutation and restored afterward. Twelve baseline-height
and twelve owner-target-height mutations are also rejected. Focus predicates
ignore transparent/zero-size bookkeeping shadows and reject actual ring removal
in all 528 gallery and 720 real-page probes.

Painted evidence is counted separately from 1,716 layout checks and 476
non-painted checks. Sixteen different CSS color spellings paint identical RGBA
bytes; these are a subset of painted matches. The retained legacy root
diagnostic has 116 comparisons, zero painted failures, 48 non-painted
equivalences and 12 color-syntax equivalences; it is not added to the new
matrix totals. Its 24 raw string-difference cases are not visual failures.

Charts have accessible group/point names, complete named data-table fallbacks,
stable scales when hiding series, a real zero baseline and distinct missing
measurements. Empty/unmeasured charts still retain their fallback tables.

## Publication, disk and residual limits

Preview: https://uxb-pr-5.skillar-site.pages.dev/__gallery.html?widgets=1
Immutable preview: https://156e7543.skillar-site.pages.dev/__gallery.html?widgets=1
The preview-only artifact exposes the existing development gallery; normal
production route/build configuration is unchanged. Production remains
`a876d0f7-c6e4-441a-a05c-bacfafc3d1b4` on `main`.

421 superseded owned files (10,548,352 bytes) and three obsolete preview builds
were deleted. Cited pairs, source crops, matrix/screens, triptychs and the
baseline archive remain. Free disk is about 19 GiB; an active guard enforces
the 8 GiB stop threshold until delivery. `cleanup.json` lists deleted paths.

The sole remaining executed failure is the pre-existing
`ENOTDIR: lstat /tmp/h/Library/LaunchAgents/dev.skillar.daemon.plist` in
`local/test/cli-init.test.mjs:159`, reproduced on untouched `abee112`.
Nothing at `/tmp/h` was changed or deleted. Final clean-environment CI cannot
erase this local result; both are reported.

This PR remains draft. PR-4 must land first; rebase before merge. Independent
review belongs to the lead. No table/facet implementation was changed.
