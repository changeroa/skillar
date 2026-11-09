# PR-2 overlay gate ledger

PR: https://github.com/changeroa/skillar/pull/101 (draft; do not merge).
Base: origin/main 46bc344, containing PR-0 and PR-1.
Evidence root E:
`/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-2/`.
Final head and exact-head CI receipts are in E/publication.json.

| Gate | Status | Evidence and remaining cases |
| --- | --- | --- |
| 1. Component visual parity | PASS | All 52 shipped states in both themes: 64 real view-only Demo cases plus 40 explicitly documented "no demo instance" cases with labelled supplementary MIT renders. Both apps: 208 computed-style, side-by-side and raw zero-tolerance comparisons; 4,072 measured assertions pass. Native/WAI and caller-content/geometry differences remain explicit, not masked or claimed pixel-identical. E/parity/README.md, coverage.json, measured-validation.json and comparisons.json. |
| 2. Screen comparison | PASS | 12/12 Langfuse/before/after closed-screen comparisons at 1440/390, both themes, fresh documents and end shots. Product Peek/ConsoleSheet before/after additionally cover 24/24 route/theme/width/build cases. Existing screen compositions are retained for later screen PRs, not claimed pixel-identical to Langfuse. E/screens/, E/product-panels/. |
| 3. Keyboard/ARIA | PASS | 416 assertions, 16/16 cases, 176 captures in both apps/themes at 390/1440/1920, including phone touch/DPR 3. Trusted-key menu entry, disabled skip, cyclic arrows, Home/End, typeahead, selection, Tab exit, modal wrap, nested one-layer Escape and opener restoration pass. Real product URL/focus and mobile ConsoleSheet wrap/Escape pass in 24/24 before/after cases. E/keyboard/, E/iphone/ and E/product-panels/. |
| 4. R1-R7 structure | PASS | Reused existing PR-0 assertions unchanged: 8/8 production-fixture cases pass. Probe marks R4 N.A.; product-panel evidence separately exercises Peek URL/focus. E/structure/qa-structure.json. |
| 5. Build/tests | PASS | Site 368/368, site build, local typecheck and local build pass. Local 984/985: the only failure is unchanged cli-init.test.mjs:159, ENOTDIR at the existing host file /tmp/h, explicitly permitted by the contract. No test or host file changed. Exact final-head CI receipts are in E/final-head-ci.json and E/publication.json. |
| 6. Licensing | PASS | MIT SHA/files documented in all three matching notices; site/dist/NOTICE and local/dist/dashboard/NOTICE ship. npm pack --dry-run --json includes NOTICE among 171 files. E/license-pack.log. No React/Radix/cmdk dependencies or excluded ee sources. |
| 7. Deployment policy | PASS | Production: not deployed; deploy gated on owner. Authorized Pages preview only on uxb-pr-2; URL and deployment receipt in E/preview.log and E/publication.json. No account settings or production branch changed. |

## Scope and review

New primitives are shared Preact DOM components in foundation/overlays.
Dialog/Confirm/Sheet use native top-layer modality; menus/tooltips use native
popovers inside their owner's DOM subtree. Existing PeekPanel and ConsoleSheet
focus/URL/dirty-state handlers are unchanged; SessionPeek changes CSS only.
Controls retain 32px desktop / 44px phone/coarse visual height. Selected
controls within changed panels use neutral wash and a Lucide check, not an
accent edge. No dependency/lockfile, API/data/route/auth or worker/server edits.

Independent visual/code review is arranged by the lane lead. This child
session cannot spawn nested reviewers (harness depth limit), so no independent
visual-QA PASS is claimed. A full contrast/Lighthouse audit and independent
approval remain unverified. Gate 1 records measured component skin/state
coverage, not independent approval or a zero-pixel-difference assertion.

## Per-family state coverage

Counts below are state/theme cases; each has separate site/local comparisons.

| Family | States | Real Demo | No Demo instance | Comparisons |
| --- | ---: | ---: | ---: | ---: |
| Dialog | 11 | 10 | 12 | 44 |
| AlertDialog/Confirm | 9 | 0 | 18 | 36 |
| Dropdown | 12 | 20 | 4 | 48 |
| Tooltip | 7 | 14 | 0 | 28 |
| Sheet/Side panel/Peek | 13 | 20 | 6 | 52 |
| Total | 52 | 64 | 40 | 208 |

`E/parity/no-demo-instances.json` lists the checked public routes and exact
reason for every missing instance. No create/edit/settings/delete controller
was opened. Real Dialog captures use the read-only prompt comparison. Confirm
is inaccessible in the public view-only project; its disabled destructive
actions were not invoked. Supplementary scratch frames visibly identify
themselves and are never counted as real Demo captures.

Measured repairs include comparison geometry and typography, menu widths/
icons/checked state, tooltip width variants and native-title suppression,
bottom-sheet anatomy, error panels, Peek elevation, physical-pixel popup
positioning, inherited Demo antialiasing, and gallery footer
selector isolation. The source drawer selection wash/check repair is retained.
Source trace/diff/filter content and persisted resizable pane widths are
caller-owned context; existing product pane geometry and lifecycle remain.

The legacy `15-dialog-langfuse-*.png` references are command palettes, not
generic Dialog/Confirm instances; they are not passed off as those references.
Real source captures preserve their pixels and hide the account footer.
An initial local-gallery failure came from crossing the site's separate
Preact module identity; the gallery no longer imports the site's Peek hooks.
Product routes, rather than a second renderer, exercise existing panels.
