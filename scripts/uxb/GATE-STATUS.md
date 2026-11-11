# PR-7 interaction paint correction

PR: https://github.com/changeroa/skillar/pull/106

Current correction checkpoint:

- 264 normal interaction cases pass 7,920 source-field comparisons and field corruptions, 808 fixed painted descendants and 6,216 rejected descendant corruptions.
- All 16 Tree/Timeline hover cases reject hidden child paths while the row stays hovered and every computed parent field remains unchanged.
- Four real Demo disabled-outline references replace the four MIT state exceptions. Both native renderers pass all 8 cases and 240 style comparisons; the owner's 32/44px target remains absolute.
- All 84 ready source contexts pass 63,360 field comparisons. Newly exposed native differences include the actual selected tab-indicator shadow and Oklab selected-interval ring ink.
- Ready fixed paint passes 32,980 measurements and 119,250 corruptions across 84 cases. Source-proven updates preserve all 336 fixed case memberships, 224 templates and every part/channel.
- All 252 non-ready source cases pass 13,824 comparisons and 12,960 corruptions. The preserved PR-5 validator passes 520 cases, 40,860 assertions and 21,372 corruptions with `bootstrap: false`.
- Site tests pass 506/506; both production builds and local typecheck pass. Release scanning finds zero forbidden fixture/reference bytes or imports, with equal NOTICE copies.
- Final non-ready fixed-paint/frame refresh and final-head publication remain in progress. The older receipts below are historical, not approval of this correction.

## Historical takeover verification after the 6bf20ff review

Rebased onto merged PR-6 `b8b1d62100b7fcdf552494bb97ca5910f9475a18`.
Verified corrections were pushed at each milestone through `82a5ca4`.
The exact final HEAD and its CI check URLs are recorded in `pr-7/final-ci.json`.
The historical ledgers below are preserved; their old PR-7 counts are not current approvals.

Completed machine evidence:

- Ready source fields: 84 cases, 46,464 exact field comparisons and 46,464 rejected field corruptions, with every visible required target counted.
- Interaction source fields: 264 cases, 5,808 comparisons and 5,808 rejected field corruptions; 264 actual target removals fail; eight fractional-origin/DPR/scroll focus corruptions fail.
- Ready fixed paint/source comparisons: 84 cases, 32,980 normal measurements and 119,250 rejected real DOM paint/type corruptions.
- Loading/error/empty: 504 before/after cases; 252 after cases provide 10,368 source-style comparisons, 9,504 rejected style corruptions, 6,720 fixed painted parts and 46,150 rejected paint corruptions. All 1,008 state frames contain visible native text.
- Local typecheck and both production builds pass. Site tests pass 497/497. Local tests pass 997/998 with the unchanged pre-existing `/tmp/h` ENOTDIR; standalone performance passes 1/1.
- Release scan: local dist 134 files, hosted dist 52, dry-run pack 174; 94 local and 290 hosted contributing modules, zero forbidden fixture/gallery/reference imports, equal NOTICE copies.

| Gate | Result | Final evidence |
| --- | --- | --- |
| G1 source/style/paint | PASS | Above source and fixed-membership matrices; JSON adds 8 contexts, 32 visible leaves, 736 field/color comparisons and 736 rejected corruptions. Required properties, targets and cases fail closed. |
| G2 actual screens | PASS | 252 ready and 504 state before/after contexts; 1,512 visible top/end PNGs, 756 regenerated source/before/after boards with original-input hashes and unmasked diagnostic pixel diffs. All 14 mobile MIT references were recaptured at 390x844, DPR 3 and scale 1. |
| G3 keyboard/ARIA/owner size/focus | PASS | 4 functional keyboard cases, 88 desktop and 56 phone trace targets, 4 phone closure paths; 252 non-ready contexts with 1,292 painted-focus targets and 1,096 rejected 60px size corruptions. Eight fractional-origin/DPR/scroll corruptions reject 1px or white indicators. |
| G4 original structure | PASS | 8 home/empty width/theme probes retain the original assertions. Home R4 remains N.A.; actual native peek/modal behavior is covered separately by G3. The merged Card wrapper selector was updated without weakening the expected 5 connection rows. |
| G5 tests/build | EXPLAINED | Site 497/497; local 997/998 with the unchanged `/tmp/h` ENOTDIR; standalone performance 1/1; local typecheck and both builds pass. Exact final-head CI is a separate publication receipt. |
| G6 license/package/release exclusion | PASS | Dist/pack counts above; zero forbidden contributors/content and equal NOTICE copies. The new trace specimen stays in development HTML and the existing separate dashboard TypeScript project. |
| G7 deployment | NOT RUN | Owner-gated. No deployment or merge was requested or performed. |

The preserved PR-5 browser matrix passes all 520 cases and 40,860 assertions,
with 21,372 rejected real DOM corruptions, zero failures and `bootstrap: false`.
`local-paint-inventory.json` fixes all 336 required case memberships in 224
templates; the normal gate never regenerates or discovers its required set.

Stricter gates exposed and fixed complete font/spacing/frame recipes, mobile
workspace-title wrapping/overlap, widget retry indicators erased by an overly
broad outline reset, and dark numeric/boolean/null JSON ink. The latter updates
only 8 fixed native paint references from the real pinned source color. The final
84-case paint run and affected real JSON screen captures were repeated after it.
Failure receipts are retained as `widget-focus-failure-proof.json` and
`json-scalar-failure-proof.json`; independent review remains lead-owned.

Evidence root:
`/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-7`.
`final-audit.json` verifies exact membership, all acceptance/mutation verdicts,
PNG dimensions, source/code hashes, board-input freshness, package contents and
NOTICE equality. `final-ci.json` pins publication to the exact final HEAD.

## Conflict decisions

- `api.ts`: retain the merged `configureApi` disposal contract and guard fixture imports themselves against production emission; exactly one exported API binding.
- `focus-paint.mjs`: retain native Select wrapper ownership and the real checkbox proxy only when present; preserve merged sizing/focus contracts. Fractional-pixel capture is corrected using document clip coordinates, actual viewport capture and CSS-pixel centres. The unchanged predicate rejects 1px and white rings at DPR 1/3 and scroll 0/53.
- `GATE-STATUS.md`: preserve the complete merged PR-6 ledger and historical PR-7 evidence; the takeover section supersedes failed old counts.

## Individually bounded pinned-MIT states

Source: `69181812b87169df157841fce1314ec96ecd2c5a`. All entries are actual pinned MIT renders, not Demo captures or hand-built substitutes. Read-only route evidence is in `source-state-reachability.md`, `cert-source.json`, `state-references.json` and `source-loading.json`. Available Demo components remain the primary reference. The unused ghost-capture exploration is not included in passing evidence.

| Exact state ID | Checked read-only routes | Reason for isolated reference |
| --- | --- | --- |
| `mit-Alert-error-1440-light` | /traces; trace peek; project Home | Successful read-only routes expose no matching error Alert. Inducing a failure was not permitted. |
| `mit-StatusMessage-loading-1440-light` | /traces; trace peek; project Home | Observed loading is Skeleton/spinner, not the native text-status recipe. |
| `mit-Empty-empty-1440-light` | /skills; /traces; trace peek; project Home | /skills shows an empty context; populated matched routes expose no TopicsEmptyState recipe. |
| `mit-Skeleton-loading-1440-light` | /traces; trace peek; project Home | Real loading frames are retained; the isolated pinned primitive supplements their transient geometry. |
| `mit-Json-mixed-primitives-1440-light` | trace Metadata/Raw desktop; trace Data phone | The matched record has strings/objects, not the mixed number/boolean/null specimen; native disclosure geometry is explicitly adapted. |
| `mit-Json-collapsed-1440-light` | trace Metadata/Raw desktop; trace Data phone | Collapsed JSON is reachable and uses actual Demo captures. This isolated pinned primitive is supplementary, not an unavailable-state replacement. |
| `mit-Alert-error-1440-dark` | /traces; trace peek; project Home | Successful read-only routes expose no matching error Alert. Inducing a failure was not permitted. |
| `mit-StatusMessage-loading-1440-dark` | /traces; trace peek; project Home | Observed loading is Skeleton/spinner, not the native text-status recipe. |
| `mit-Empty-empty-1440-dark` | /skills; /traces; trace peek; project Home | /skills shows an empty context; populated matched routes expose no TopicsEmptyState recipe. |
| `mit-Skeleton-loading-1440-dark` | /traces; trace peek; project Home | Real loading frames are retained; the isolated pinned primitive supplements their transient geometry. |
| `mit-Json-mixed-primitives-1440-dark` | trace Metadata/Raw desktop; trace Data phone | The matched record has strings/objects, not the mixed number/boolean/null specimen; native disclosure geometry is explicitly adapted. |
| `mit-Json-collapsed-1440-dark` | trace Metadata/Raw desktop; trace Data phone | Collapsed JSON is reachable and uses actual Demo captures. This isolated pinned primitive is supplementary, not an unavailable-state replacement. |
| `mit-Alert-error-390-light` | /traces; trace peek; project Home | Successful read-only routes expose no matching error Alert. Inducing a failure was not permitted. |
| `mit-StatusMessage-loading-390-light` | /traces; trace peek; project Home | Observed loading is Skeleton/spinner, not the native text-status recipe. |
| `mit-Empty-empty-390-light` | /skills; /traces; trace peek; project Home | /skills shows an empty context; populated matched routes expose no TopicsEmptyState recipe. |
| `mit-Skeleton-loading-390-light` | /traces; trace peek; project Home | Real loading frames are retained; the isolated pinned primitive supplements their transient geometry. |
| `mit-Json-mixed-primitives-390-light` | trace Metadata/Raw desktop; trace Data phone | The matched record has strings/objects, not the mixed number/boolean/null specimen; native disclosure geometry is explicitly adapted. |
| `mit-Json-collapsed-390-light` | trace Metadata/Raw desktop; trace Data phone | Collapsed JSON is reachable and uses actual Demo captures. This isolated pinned primitive is supplementary, not an unavailable-state replacement. |
| `mit-Alert-error-390-dark` | /traces; trace peek; project Home | Successful read-only routes expose no matching error Alert. Inducing a failure was not permitted. |
| `mit-StatusMessage-loading-390-dark` | /traces; trace peek; project Home | Observed loading is Skeleton/spinner, not the native text-status recipe. |
| `mit-Empty-empty-390-dark` | /skills; /traces; trace peek; project Home | /skills shows an empty context; populated matched routes expose no TopicsEmptyState recipe. |
| `mit-Skeleton-loading-390-dark` | /traces; trace peek; project Home | Real loading frames are retained; the isolated pinned primitive supplements their transient geometry. |
| `mit-Json-mixed-primitives-390-dark` | trace Metadata/Raw desktop; trace Data phone | The matched record has strings/objects, not the mixed number/boolean/null specimen; native disclosure geometry is explicitly adapted. |
| `mit-Json-collapsed-390-dark` | trace Metadata/Raw desktop; trace Data phone | Collapsed JSON is reachable and uses actual Demo captures. This isolated pinned primitive is supplementary, not an unavailable-state replacement. |

## Environment findings

The four disabled-outline cases now use real read-only Demo pagination buttons
(`Go to previous page`) at `/traces?viewId=cmo6yrbti0006ad07v1r1xyva&orderBy=order-DESC_column-startTime`.
`disabled-outline-demo/records.json` contains all four width/theme records,
hidden-footer assertions, disabled-state assertions and nonblank original crops.
`state-references.json` names them `demo-Button-disabled-*`; none is an
unavailable-state MIT exception. Source border, background and opacity are
primary. The padded text-button content/padding remains an explicitly bounded
pinned-MIT supplement; the product keeps the owner's absolute 32/44px target.
The source phone pagination button is 32px and does not override that target.

The local suite has one pre-existing ENOTDIR because `/tmp/h` is a regular file. Neither that file nor the failing test was changed. The standalone performance test passes separately.

The evidence proxy previously left upstream SSE fetches open after page navigation. Its 256-request fetch pool became saturated (518 TCP descriptors including both sides), while a direct internal backend still returned HTTP 200. Propagating the downstream request abort signal cancels abandoned upstream streams. This was a fixture-server failure, not a frozen Chrome session or a product failure.

Independent gate review remains lead-owned; this lane provides implementer evidence and does not self-approve the PR.


---
# PR-6 hosted screens

Draft PR: https://github.com/changeroa/skillar/pull/105
Branch: `uxb/pr-6-hosted`, based on merged PR-0 through PR-5 at `ba64d91`.
Evidence: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-6/`.
The strict-control revision's exact published head and terminal CI are recorded
in that directory's `publication-strict-controls.json` and
`ci-strict-controls.json`. Older publication receipts remain historical.
This is implementer evidence, not approval.

## Reference-blocker correction after d63716e

The reference audit at
`.omo/evidence/skillar-pr-105-d63716e-reference-gate-review.md` rejected 68
unsupported pinned-only references. All 56 previously unproved variant/state
cases are reachable read-only and now have real captures at both widths/themes.
No new unreachable exception was needed. The verified inventory is 128 real
references and four labelled pinned-MIT Alert/sm exceptions.
`pr-6/hosted-controls-real-demo-verified/results.json` passes 132/132 cases,
4,092 field comparisons, 264 rejected style mutations and 36 rejected
focus-removal mutations. The first real-reference run rejected 14 cases;
its failures are retained separately in `hosted-controls-real-demo/`.
Card inherited type is now 16px/24px, Skeleton type is 12px/18px with exact
recorded ink, and StatusMessage retains its 20px line box.

Fresh site validation passes 458/458 tests and the production build. Local
typecheck/build pass; its full suite remains 986/987 because of the documented
pre-existing `/tmp/h/Library/LaunchAgents/dev.skillar.daemon.plist` ENOTDIR
failure. No test or `/tmp/h` was edited. LSP diagnostics were unavailable
(workspace TypeScript initialization and missing Biome); actual typechecks
and builds are the executed compiler checks.

Fresh source evidence:
`pr-6/demo-reference-correction/records.json` and its 80 PNGs. Every capture
records all 31 style fields, expected hover/held-active/trusted-Tab state,
nonblank pixel acceptance and a hidden account footer. Two PR-1 Skeleton
captures supply the remaining four width/theme cases; the 60 already-live
outline/select/checkbox cases now use real fields and PNGs as the
primary reference, rather than a concordant local render.

All routes below are under
`https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646`.
The fresh Demo is v4.78.0; retained PR-1/PR-5 captures are v4.77.0.

| Cases | Exact route and read-only method |
| --- | --- |
| primary default/hover/active/focus-visible, 16 cases | `/evals`: enabled New evaluator button, never activated. Phone: More actions reveals the same button. |
| danger default/hover/active/focus-visible, 16 cases | `/evals`: first Evaluator actions menu, Delete opens the confirmation only; enabled Delete evaluators button is measured but never clicked. Source `EvaluatorsPage.tsx` sets `deleteIds` on opening; only `onConfirm` calls the mutation. |
| input default/hover/focus-visible, 12 cases | `/skills`: Use skill menu, Install with CLI, Configure install command, Tag. The genuine plain `input[placeholder="my-tag"]` only controls displayed command text. No typing, copy, install or network write. |
| summary default/hover/focus-visible, 12 cases | `/skills`: actual secondary Use skill button; phone More actions reveals it. |
| disabled, 4 cases | `/skills`: actual disabled primary New skill button, not a fabricated disabled state. Existing PR-1 disabled ghost remains historical; this real primary caller matches the shipped primary-disabled case. |
| ready panel, 4 cases | Root: ready Traces Card plus CardHeader insets, refreshed from the same real composition already recorded by PR-5. No source DOM/content/style substitution. |
| skeleton, 4 cases | `/sessions`: existing PR-1 `34-skeleton-row` real 96x16 primitive, pulse paused at recorded 0ms. |
| outline and quiet-danger, 32 cases | Root: actual Filters button at desktop; phone More actions reveals it. Fresh width-specific states replace historical desktop hover/active paint, which must not define coarse-pointer paint. Quiet-danger keeps only its existing approved destructive-ink adaptation. |

Additional checked routes: `/datasets` has disabled row-delete buttons;
`/traces` with local row selection opens Delete Traces with a disabled Confirm;
`/experiments`, `/annotation-queues`, `/prompts`, `/dashboards` have
permission-disabled creation actions. `/evals` is the reachable destructive
confirmation counterexample, so none of these observations is used to claim
destructive unreachability. Active captures hold the pointer and release
outside; keyboard captures use trusted Tab. No confirm, sign-in, create, edit,
settings, execution or data mutation was performed.

### Remaining pinned-MIT cases, individually enumerated

These are the four pre-existing approved standing-rule exceptions, not new
exceptions inferred from missing captures. Pinned source:
`69181812b87169df157841fce1314ec96ecd2c5a`, actual `Alert/default/sm`.

| Exact case | Exact checked routes | Why real read-only capture is unavailable |
| --- | --- | --- |
| status-default-light-1440 | `/skills`; root; `/traces`; `/sessions/chat_3dc9c765-eeb5-4a52-88b4-6883df36e1a1`; `/topics` | Retained PR-5 route proof: `/skills` exposes only default/default Alerts, with no size selector. Root/traces expose no small Alert; recorded session exposes a different StatusMessage/ERROR/compact; `/topics` is unavailable. No read-only control selects Alert/sm. |
| status-default-dark-1440 | `/skills`; root; `/traces`; `/sessions/chat_3dc9c765-eeb5-4a52-88b4-6883df36e1a1`; `/topics` | Same checked-route proof for dark Alert/default/sm: only default-size Alerts are exposed; other routes do not offer this component/size. Theme changes do not expose a size selector. |
| status-default-light-390 | `/skills`; root; `/traces`; `/sessions/chat_3dc9c765-eeb5-4a52-88b4-6883df36e1a1`; `/topics` | Same checked-route proof for phone light Alert/default/sm: responsive layout does not expose the small size; no read-only size selector exists. |
| status-default-dark-390 | `/skills`; root; `/traces`; `/sessions/chat_3dc9c765-eeb5-4a52-88b4-6883df36e1a1`; `/topics` | Same checked-route proof for phone dark Alert/default/sm: responsive/theme changes do not expose the small size; other checked routes supply different components or are unavailable. |

Retained proof: `pr-5/read-only-state-routes.json` and
`pr-5/state-sources.json`; accepted explicitly by the d63716e reference audit.
Every other missing source now fails before product comparison. The old
strict-control provenance explanation below is historical and superseded here.

| Gate | Result | Evidence |
| --- | --- | --- |
| 1 Component visual/style comparisons | PASS | `hosted-controls-real-demo-verified/results.json`: 132/132 native cases, 128 real Demo references and four documented MIT Alert/sm exceptions; 4,092 exact field comparisons, 264 rejected style mutations and 36 rejected focus-removal mutations. The prior 86 shared-control comparisons are historical. Every padding, typography, corner, border, height and focus field is asserted. |
| 2 Complete screen/state comparison | PASS (prior verified coverage) | The reviewed b38461e run contains 176 default captures plus 376 before/after state captures. 47 route/state cases produce 188 paired boards: 44 reachable cases and three explicitly N/A static-404 cases, each at both widths/themes. Those 552 captures were not rerun or relabelled as the strict-control revision. Source references distinguish live Demo primitives from pinned MIT loading references. |
| 3 Keyboard/ARIA and real-page measurements | PASS | The checked-in `pr6-runtime.mjs` fails on every bad baseline and invokes the real 32/44px predicate for all 142 size mutations. 36/36 scenarios, 146 passing painted-focus measurements and 146 rejected focus-removal mutations; four native publisher-checkbox crops each contain 64 contrasting pairs. Native checkboxes are not falsely counted as 32/44px inputs. Six fresh peek profiles pass 819 assertions and 24 native confirmations. |
| 4 R1–R7 | PASS | Real grouped shell, sidebar identity/logout, command palette, URL state, peak/full navigation, dirty drafts, default list rows (15 desktop / 7 phone), empty states and common chart baseline preserved. Native pagehide/pageshow and listener cleanup passed; this Chrome run did not restore bfcache, so an actual cache hit remains unverified. |
| 5 Builds, tests and release contents | PASS with existing local exception | Reference correction: site build and 458/458 tests, local typecheck/build and 986/987 local tests. The sole local failure is the unchanged `/tmp/h` ENOTDIR exception. Source-eligibility and Card-content-height regressions are added; the release-content gate remains in the site suite. Exact-head CI is recorded separately. |
| 6 License/NOTICE | PASS | No new dependencies, upstream source copies or EE reads. Existing MIT NOTICE remains in the clean production output. The earlier package NOTICE inspection is historical, not a rerun claimed by these fixes. |
| 7 Deployment boundary | PASS | No production deployment, merge or self-approval. The existing `uxb-pr-6` Pages preview predates the strict-control revision and is not final-head evidence. |

The full per-screen wireframe deviations, source-route mappings, evidence
pipeline corrections and residual review gaps are in `pr-6/gate.md`.
The preview's `/__qa/pr6/` contains only synthetic/public-Demo PNG evidence;
source account footers are hidden and asserted absent from every capture.

## Strict hosted-control gate after re-review at b38461e

The earlier `hosted-controls/` 128-capture run was not a style gate: padding was
absent and recorded differences did not fail it. Its G1 claim is superseded.
The evidence entry point `pr-6/hosted-controls.mjs` now invokes the checked-in
`scripts/uxb/hosted-controls.mjs`, backed by `hosted-control-style.mjs`.
Any missing, invalid or differing required metric throws; source disagreement,
incomplete inventory, a surviving mutation or a failed painted-focus baseline
also exits nonzero. Capture count alone cannot pass.

The inventory preserves all 128 previous cases and adds checked-checkbox focus
at four profiles: 33 cases at 1440px/390px, light/dark = 132. Every case asserts
31 fields: height; four paddings; font size, line height and weight; four corner
radii; four border widths and RGBA colours; background/foreground RGBA; opacity;
focus-visible, outline width/style/offset/RGBA and painted shadows; disabled and
checked state. Shadow normalization removes only zero-alpha/zero-extent paint.
No typography, padding, radius or border-colour differences are whitelisted.

Every passing case is mutated in the real browser and restored, then rechecked:
132 padding-left +4px probes, 112 font-size +2px probes and 20 corner-radius +2px
probes must fail the same baseline comparator. All 36 keyboard-focus cases must
paint contrasting focus and reject removal of the ring. These are deliberate
failures caught by assertions, not counts of attempted screenshots.

References are rendered from actual MIT components at
`69181812b87169df157841fce1314ec96ecd2c5a`, not hand-painted target clones:
Button primary/outline/destructive/secondary/disabled, plain Input, SelectInput,
Checkbox/sm, Card+CardHeader, Alert/sm and Skeleton/h-4. Sixty cases additionally
require concordance with the available live Demo records for padding, type,
radii, border widths/colours, opacity and height before the source can define
expected values. The live input has prefix/icon padding and is not the plain
input caller; the live primary link is not a primary button. Those cases use
the genuine pinned variant and are explicitly not labelled live screenshots.
The live focused checkbox is checked. Both checked and unchecked focus are now
tested; unchecked focus combines live unchecked metrics with genuine pinned
keyboard focus. Card padding belongs to CardHeader; identical one-line content
makes its natural height comparable without imposing a fixture-only height.

The exact owner adaptations are 32px mouse/44px touch control height, existing
24px native checkbox paint inside its 44px named choice, semantic destructive
ink for the existing quiet-danger button, and a 2px primary-accent outline with
2px offset replacing the source neutral shadow. Expected accent/destructive
RGBA comes from source tokens, never from the measured target. Caller text,
width, disclosure marker and native-select caret remain native; this is not a
claim of pixel-identical content or browser affordances.

The first strict run failed 104/128 actual cases. Real fixes retain variant
paint at disabled opacity .5, remove incorrect primary/destructive borders and
pointer-active outlines, correct input/select padding and type, align native
disclosure metrics, paint native checkbox border/check states, add Card shadow,
use 16px skeleton bars and limit hover to hover-capable pointers. Shared
selects, chart disclosures and shell breadcrumbs keep their component styles.

Reproduce with the actual pinned reference server and QA browser running:

```sh
OMOWRIGHT_HELPER=/absolute/path/to/omowright.mjs \
node scripts/uxb/hosted-controls.mjs \
  http://localhost:5182 http://127.0.0.1:57588 /absolute/output \
  /absolute/path/to/pr-1/demo-captures/records.json \
  /absolute/path/to/pr-6/demo-reference-correction/records.json
node --test site/test/hosted-control-style.test.mjs
```

## Independent review corrections

Review at `6259817` found fixture leakage, ignored checkbox focus failures,
tautological height probes and missing hosted state comparisons. These findings
supersede the original PR-6 evidence claims. Full corrected inventories and
state/deviation explanations are in `pr-6/review-fixes/`.

Production fixture selection is compile-time gated. Hosted users still start
with HTTP and configure the existing cloud adapter on source selection; the
real API paths and response contracts are unchanged. Development fixture mode
is separately exercised. Gallery output is built outside production dist.

The native publisher checkbox already paints a contrasting outline on its
input. The old harness cropped its prose sibling. It now crops a sibling only
for the actual shared `.lf-checkbox__box`, and requires a passing baseline
before accepting any removal probe. The audit also corrected empty-library
readiness and checks returned gate verdicts and active navigation.

State capture exposed a real cold-library defect: the table displayed an
empty-result message while the first catalog request was pending or failed.
Loading now propagates busy to the shared table; a failed first read keeps its
table mounted but hidden. Two integration regressions cover those states.

At 390px, version/status labels no longer fragment: columns reserve 128px/96px
with nowrap. The named horizontal table region retains dates, full digest and
all actions. The remaining tall detail/peek preamble preserves the five-field
R5 summary and identifier/head facts; all controls retain 44px touch targets.
The existing shell's wrapping breadcrumb/version controls remain unchanged.

## Explicit owner overrides

- Absolute 32px mouse / 44px phone/coarse controls.
- Contrasting visible keyboard focus and accessible labels override Demo parity.
  Hosted controls use `--lf-primary-accent`; the peek validator checks that token
  and retains every existing target, geometry, native-dialog and lifecycle check.
- Dashboard B, no read-history column, actual reads only, KST everywhere.
- Account v3 intentionally shows its own profile email; the general R1 prohibition
  on duplicating account information in unrelated main views remains intact.

## Historical PR-5 record (not the current PR's gate verdict)
# PR-7 local screens — current implementer status

Draft PR: https://github.com/changeroa/skillar/pull/106
Branch: `uxb/pr-7-local`; base: `ba64d91bfd000add5553aadf2640be077678e2f1`.
Evidence: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-7/`.
Exact published head and terminal CI: `publication.json` and `final-ci.json`.
This is implementer evidence, not independent approval. No merge or production deployment.

| Gate | Verdict | Evidence / remaining cases |
|---|---|---|
| 1. Component visual diff | **PASS** | 84 real-page component cases: 22,430 normal measurements pass; 25,368 actually applied paint/type mutations are rejected. 252 non-ready cases add 2,692 source-style measurements, 2,692 rejected style mutations and 11,706 rejected paint-channel mutations. Live Demo references, labelled actual pinned MIT state exceptions and native/owner adaptations are separate. No raw raster difference is relabelled as pixel equality. |
| 2. Screen comparison | **PASS** | 252 default cases / 504 PNGs and 504 before/after loading/error/empty cases / 1,008 PNGs across all 21 supported standalone/real-embed contexts. Complete top/end Demo/before/after boards: 252 default and 504 state boards. Required 390/1440 light/dark plus 1920 default. Actual viewport, overflow, state visibility and exact 32/44px standard controls pass; all v3 composition differences are documented. |
| 3. Keyboard / ARIA | **PASS** | Four trusted tree/grid/identity cases; 88 desktop + 56 phone trace targets pass focus/size checks and four phone Escape restorations pass. Non-ready matrix adds 1,292 painted-focus/ring-removal checks and 1,116 actually applied 60px size rejections. Chart geometry remains N.A. for toolbar height, never for focus. Real hosted embed is mounted, not substituted. |
| 4. R1–R7 structure | **PASS** | Original eight-case full/empty desktop/phone light/dark assertions pass (R4 N.A. on home). Thirteen API/route/data/chart-geometry files are byte-identical. Keyed-body and JSON-disclosure regressions pass. |
| 5. Build / tests | **FAIL locally** | Site 450/450, both builds, local typecheck and strict measurement/paint regressions pass. Local full suite: 995 tests, 994 pass; known `cli-init.test.mjs:159` ENOTDIR from the pre-existing `/tmp/h` file. Nothing is skipped, weakened or deleted. Exact final-head site/runtime CI is recorded separately in `final-ci.json`; it does not erase this local failure. |
| 6. License | **PASS** | No new dependencies. npm dry-run pack includes NOTICE; all public/local/built NOTICE copies match. Source provenance and exact pinned MIT SHA are recorded. |
| 7. Deployment | **PASS** | **not deployed; deploy gated on owner** for production. Only authorized `uxb-pr-7` preview, recorded in `publication.json`; no local deployment. |

Full ledger and strict accounting: `gate.md`, `final-audit.json` and `validator-audit.md` in the evidence root.
Source reachability and all v3 differences: `source-state-reachability.md` and `wireframe-deviations.md`.
Release audit: 134 local dist files, 51 hosted dist files, 174 package entries,
94 local and 289 hosted contributing modules; zero development/fixture/gallery/QA hits.
Standalone analysis has no hosted embed tab; the real embed's four supported tabs
and their detail/peek states were exercised. KST, zero baselines, APIs, data,
routes, hosted screens, server and worker implementations are unchanged.

All three new inventory components have read-only Demo captures. No whole-component
zero-capture exception was used. Account footers are hidden and asserted hidden.
State-only source exceptions render actual pinned MIT code and are explicitly labelled
as such; ready Demo context is never counted as a Demo error. No Demo writes,
settings changes or induced failures were performed.
Independent review is lead-owned; nested reviewers are disabled in this lane.
These are implementer verdicts. The PR remains draft; no merge or production deployment.

## Historical PR-5 ledger (not current PR-7 certification)

### PR-5 widgets and charts: paint-review correction

Draft PR: https://github.com/changeroa/skillar/pull/104
Branch: `uxb/pr-5-widgets`. Merged PR-4 base: `431fb9b0351c6f82eaacb16e36b32f7c7c658f32`.
Evidence root: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-5/`.
Exact published head and terminal CI: `publication.json` and `ci-final.json` in that root.
This is implementer evidence, not independent approval. No merge or production deployment.
All current product receipts were regenerated after the rebase; immutable source captures were reused.
`combined-audit.json` verifies fresh receipt timestamps, complete membership and zero unexpected failures.
The historical PR-4 ledger is retained unchanged at the end, not presented as fresh certification.

## Correction of independent review at 9f09a38

That head failed B1/B2. Its 10,028 frame/type assertions were real but did not establish
plot or conditional-icon paint parity. They remain a separate, limited contract below.
`widgets-state-qa.mjs` now also requires the fixed-inventory paint gate; it cannot certify
using the original matrix alone.

Final normal mode: 520 app/theme/pose cases, 40,860 assertions, zero failures; all 21,372
mutations rejected. The committed inventory has 130 views and 59 deduplicated templates.
The 2,496 plot observations include explicitly unpainted hit areas and null-slot metadata;
they are not claimed as 2,496 visible painted marks. All 480 icon observations are checked.
Thirty-six non-interactive icon focus views are explicitly N.A., not synthetic focus passes.

Live read-only Demo measurements cover series, grid, axis, bars, paths, points, bins,
tick/value labels and legend palette. Comparisons include fill, stroke, stroke width,
both channel opacities, effective ancestor opacity and dash. Active point paint is measured
separately. Caller data/orientation remain owner adaptations; palette ordinals use the
actual computed Demo palette, not invented source geometry.

Actual pinned MIT references cover every Alert icon, Check/Minus and dismiss glyph plus
interactive default/hover/native-focus states, including conditional hidden-series Minus.
Callout now uses its reference's inherited 39/39/42 and 179/179/179 foreground, 14px X,
black/5 and white/10 hover paint, retaining exact 32/44px targets and contrasting focus.

The fixed part inventory also requires conditional text, skeletons, legend swatches,
expanded fallback cells, all four border sides, shadows and native disclosure markers.
It rejects missing parts, hidden icons and each declared channel independently:
7,736 whole-part removals, 480 hidden-icon probes, 204 native-marker removals and the
remaining per-channel/primitive corruptions. Empty metric strips must actually remain
unpainted; deselected series must have no paint. Existing null-slot behavior/tests are
preserved.

Receipts: `paint-review/sources.json`, `paint-review/results.json` and retained PNGs under
the evidence root. Portable source-derived fixtures and 33 paint regression tests live in
`site/test/widget-paint.test.mjs`. This is implementer evidence, not independent approval.

The takeover reran the normal paint gate and all mutation probes, then the mandatory
combined state/paint entry point. `takeover-audit.md` records the direct coverage audit;
no weakened thresholds or masks were found. All 60 triptychs were regenerated with the
verified `431fb9b` baseline label. All 2,368 current product PNG signatures and freshness
checks pass in `audit-final.mjs`. A new independent review was not run in this depth-limited lane;
the lead-owned re-review remains separate. `.debug-journal.md` is excluded from the commit.

## Seven gates

| Gate | Result | Correction evidence |
| --- | --- | --- |
| 1. Component parity | PASS, expanded measured-part contract | Original 296 cases / 10,028 frame/type assertions, plus mandatory 520 paint views / 40,860 assertions. Zero failures; 21,372 paint/part/channel mutations rejected, separately from 296 geometry and 200 original control-paint mutations. |
| 2. Screen comparison | PASS | 30 before/after comparisons against merged main; 120 top/end captures, 36 retained genuine Demo screens and 60 refreshed triptychs. Zero overflow, wrong viewport or runtime errors. |
| 3. Keyboard and ARIA | PASS for tested matrix | 648 base captures, 1,860 assertions and 72 interaction checks. 708 gallery and 720 real-page painted focus targets pass ring-removal probes; 636 real-page SVG points receive native Tab. All 96 dismissed/restored states pass. |
| 4. R1-R7 structure | PASS | Eight populated/empty cases. Exact and painted R7 baselines and corruption probes pass. R3 still expects zero/five data rows; PR-4 status rows are excluded. R4 remains inherited N.A. |
| 5. Build and tests | FAIL: known local environment only | Site 450/450; both builds, local typecheck, performance, syntax and whitespace checks pass. Local 984/985 has only the known /tmp/h ENOTDIR. Clean-environment final-head CI is reported separately, without erasing this local result. |
| 6. License and package | PASS | Five byte-identical notices, 12,817 bytes; final dry-run package includes NOTICE among 177 files. 29 actual pinned-MIT renderer inputs; zero EE inputs. Both PR-4 and PR-5 attributions retained. |
| 7. Deployment verification | Not deployed; deploy gated on owner | No deployment of this correction. The retained e7d512fc preview and its four passing browser cases belong to 9f09a38, not the corrected head. They are historical evidence only. |

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
Two invisible white offset shadows on white are rejected with zero qualifying indicator pixels.
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
