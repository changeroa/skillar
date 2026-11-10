# PR-2 overlay gate ledger

PR: https://github.com/changeroa/skillar/pull/101 (draft; no merge or production deployment).
Base: origin/main 46bc344. This follow-up supersedes the fce3b28 parity claims.
Evidence root E: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-2/`.
Current review-fix evidence is under E/followup; older E/parity scratch artifacts are historical and excluded.
Final published SHA and exact-head CI receipts belong to E/followup/publication.json and final-head-ci.json.

| Gate | Status | Current evidence |
| --- | --- | --- |
| 1. Component visual parity | **FAIL: 20 missing source state/theme references** | 74 real Demo references, 10 actual pinned MIT Confirm references, 20 unavailable. 208 actual site/local state renders; 168 available-reference comparisons pass 55,220 assertions with zero unexplained mismatches. The 40 corresponding app cases without references remain FAIL. E/followup/parity/{sources,products,comparisons,measured-validation,unavailable}.json. |
| 2. Screen comparison | Prior closed-screen evidence retained | Original 12/12 closed-screen and 24/24 product-panel before/after cases remain E/screens and E/product-panels; not recaptured or claimed pixel-identical. Current real Peek screenshots and sizing checks are E/followup/real-peek/final. |
| 3. Keyboard/ARIA and actual Peek sizing | PASS | Shared overlays: 336 assertions, 12/12 site/local cases at 390/1440/1920 in both themes, 132 captures. Actual hosted Peek: 729 assertions, 6/6 light/dark mouse/touch cases at 1440/390, including 24 native dirty-draft confirm decisions. Controls measure 32px with mouse, 44px with touch. E/followup/keyboard-final/results.json and real-peek/final/results.json. |
| 4. R1-R7 structure | PASS | Unchanged PR-0 assertions: 8/8 actual fixture-backed production-page cases. R4 remains N.A. in that probe; the actual Peek tests separately check URL, focus, and dirty-draft navigation. E/structure/qa-structure.json. |
| 5. Build/tests | PASS except recorded pre-existing host failure | Site 368/368; site build, local typecheck/build and package dry-run pass. Local 984/985: unchanged cli-init.test.mjs:159 fails ENOTDIR at existing host file /tmp/h. No host file or failing test modified. E/checks.json and logs. Final-head CI is reported separately, not inferred from local results. |
| 6. Licensing | PASS | Three matching notices include actual pinned ConfirmDialog and Alert sources. Built packages include NOTICE; no React/Radix/cmdk runtime dependency or lockfile changes. E/license-pack.log. |
| 7. Deployment policy | PASS | No merge, production deployment, project mutation, or account-setting change. Existing preview receipts refer to the previous head, not this follow-up. |

## Measured coverage and explicit native differences

Each reference below is one state/theme; each available reference has separate site/local measurements.

| Family | States | Real Demo | Actual MIT Confirm | Missing references | Available app comparisons |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dialog | 11 | 10 | 0 | 12 | 20 |
| Confirm | 9 | 8 | 10 | 0 | 36 |
| Dropdown | 12 | 22 | 0 | 2 | 44 |
| Tooltip | 7 | 14 | 0 | 0 | 28 |
| Sheet/Peek | 13 | 20 | 0 | 6 | 40 |
| Total | 52 | 74 | 10 | 20 | 168 |

Every available state checks every captured primitive part plus its actual focused element:
font family/size/line-height/weight/spacing, foreground/background, four border widths/colors/styles,
four corner radii, four paddings, shadow, opacity, outline fields, smoothing and geometry.
Missing mandatory fields fail. Closed, disabled and Sheet cases have no whole-case bypass.
Source measurements and approved native replacements are separate assertions; source values are never rewritten.
Approved differences are 32/44px targets, retained standalone R1 control recipes, native top-layer ownership,
visible token focus rings, and documented caller-owned content/geometry. Invisible zero-width borders,
non-painted outlines and equivalent color serialization are canonicalized, not screenshot-masked.
Raw image diffs use zero tolerance and remain available; this is not a zero-different-pixel claim.

## Read-only route audit

Route prefix P = `https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646`.
Set R14 means all of: P, P/dashboards, P/traces, P/sessions, P/users, P/alerts,
P/skills, P/prompts, P/playground, P/scores, P/evals, P/annotation-queues,
P/datasets and P/experiments. Full URLs and observed controller/permission evidence are
E/followup/demo-route-audit.json and each missing row's routesChecked.
No account-settings route was entered. Only verified intermediate confirmation controllers were opened.
No final destructive confirmation was clicked.

## Confirm provenance, separately for every fallback state

Actual Demo P/evals supplies open, cancel-focus, confirm-hover and closed in both themes (8 references).
Its row Delete opens the intermediate controller; final Delete evaluators was never clicked.
All five fallback states below were unavailable after R14 and P/evals controller rechecks.
Each uses an **actual unmodified pinned MIT component render, not hosted Demo** in both themes.
Source SHA: `69181812b87169df157841fce1314ec96ecd2c5a`.
The external-only renderer imports actual ui/ConfirmDialog.tsx, its legacy Dialog,
design-system/Alert/Alert.tsx, LayerProvider and source CSS; official Tailwind scanning/compilation
preserves arbitrary variants. No primitive styling overrides or handwritten replacement component.
E/followup/actual-mit-confirm/{entry.tsx,serve.mjs,provenance.json,sources.json} records inputs and screenshots.

| Confirm state | Checked routes / why unavailable in Demo | Actual reference (light and dark) |
| --- | --- | --- |
| disabled | R14, especially P/evals: available intermediate Confirm has enabled action; disabled callers do not expose a disabled-action dialog. | MIT render /?state=disabled&theme=light or dark |
| loading | R14, P/evals: busy state requires the final mutation, which was not invoked. | MIT render /?state=loading&theme=light or dark |
| error | R14, P/evals: mutation failure is not a read-only state; no final mutation or induced failure. | MIT render /?state=error&theme=light or dark |
| empty | R14, P/evals: actual Confirm always has description; no safe empty-description caller. | MIT render /?state=empty&theme=light or dark |
| nested | R14, P/evals: verified controller opens from a row menu, not within a parent modal. | MIT render /?state=nested&theme=light or dark; actual parent Dialog mounted first |

## Remaining non-Confirm cases: individually FAIL, no fallback

Of the original 22 missing non-Confirm state/theme cases, disabled Dropdown trigger light/dark
was recovered from actual P/skills New skill. The remaining 20 references are below.
Both app counterparts fail coverage for each missing reference. All rows checked R14;
no scratch rendering or other component is substituted.

| Family/state | Light | Dark | Checked routes and concrete remaining gap |
| --- | --- | --- | --- |
| Dialog/default-open | FAIL | FAIL | R14, P/prompts/P/skills: available comparison/install variants are not the default 512px dialog. |
| Dialog/disabled-action | FAIL | FAIL | R14, P/prompts/P/skills: no safe default-dialog caller with disabled action; write entry controls disabled. |
| Dialog/loading-action | FAIL | FAIL | R14, P/prompts/P/skills: no read-only default-dialog loading action; no write initiated. |
| Dialog/error-body | FAIL | FAIL | R14, P/prompts/P/skills: no genuine default-dialog error body observed. |
| Dialog/empty-body | FAIL | FAIL | R14, P/prompts/P/skills: no genuine empty default-dialog body observed. |
| Dialog/nested-menu | FAIL | FAIL | R14, P/prompts/P/skills: no menu inside a safe default-dialog instance. |
| Dropdown/empty | FAIL | FAIL | R14, P/traces/P/sessions/P/prompts/P/skills: actual caller menus contain items, never zero items. |
| Sheet/peek-error | FAIL | FAIL | R14, P/traces/P/sessions: no genuine Peek error; none fabricated or induced. |
| Sheet/sheet-loading | FAIL | FAIL | R14, P/traces/P/sessions: no genuine filter-Sheet loading surface. |
| Sheet/sheet-error | FAIL | FAIL | R14, P/traces/P/sessions: no genuine filter-Sheet error surface. |

## Review-fix scope and test details

Actual hosted Peek legacy buttons/links/inputs/selects/summary use token 32/44px sizing,
13px/20px typography, token focus rings, and existing draft ownership. Tests use trusted events
and subscribe before actions; native confirm cancel preserves draft/URL, accept discards and restores
focus, full-page navigation is covered, and network requests are GET-only.
Shared Confirm uses actual source anatomy, disabled busy cancel and guarded dismissal;
its keyboard test asserts heading focus and non-dismissal while busy, then reloads before the next case.
Menu/Tooltip/Sheet parts, disabled New skill icon geometry, alert anatomy and focus rendering
were repaired from actual measurements. Relevant light/dark desktop/mobile captures were visually inspected.
No API/data/route/auth, server/worker, dependency or lockfile changes.

Independent review of the previous head failed and motivated this follow-up; no fresh independent
approval is claimed. This nested session cannot spawn reviewers. LSP was unavailable (Biome and workspace
tsserver missing); actual typecheck/builds ran. Full Lighthouse/contrast and forced-colors screenshot
audits remain unrun. Draft status and the 20 reference gaps must remain visible in the PR body.
