# PR-2 overlay gate ledger

PR: https://github.com/changeroa/skillar/pull/101 (draft; do not merge).
Base: origin/main 46bc344, containing PR-0 and PR-1.
Evidence root E:
`/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-2/`.
Final head and exact-head CI receipts are in E/publication.json.

| Gate | Status | Evidence and remaining cases |
| --- | --- | --- |
| 1. Component visual parity | FAIL | Eight actual view-only Demo menu/item/tooltip/Peek light/dark captures; 12 computed-style and raw side/diff comparisons for menu/item/tooltip. Geometry/type/color match apart from approved focus behavior and non-painting shadow/zero-border serialization, but raw crop dimensions/pixel phase differ. Dialog/Confirm and all reference states are not covered. E/demo-captures/records.json and E/demo-comparisons/results.json. |
| 2. Screen comparison | PASS | 12/12 Langfuse/before/after closed-screen comparisons at 1440/390, both themes, fresh documents and end shots. Product Peek/ConsoleSheet before/after additionally cover 24/24 route/theme/width/build cases. Existing screen compositions are retained for later screen PRs, not claimed pixel-identical to Langfuse. E/screens/, E/product-panels/. |
| 3. Keyboard/ARIA | PASS | 312 assertions, 12/12 shared-gallery cases, 132 captures at 390/1440/1920 in both apps/themes. Initial enabled item, disabled skip, cyclic arrows, Home/End, repeated-letter typeahead, selection, Tab exit, modal wrap, nested one-layer Escape and opener restoration pass with trusted keys. Existing product URL/focus and mobile ConsoleSheet wrap/Escape pass in 24/24 before/after cases. E/keyboard/results.json; E/product-panels/results.json. |
| 4. R1-R7 structure | PASS | Reused existing PR-0 assertions unchanged: 8/8 production-fixture cases pass. Probe marks R4 N.A.; product-panel evidence separately exercises Peek URL/focus. E/structure/qa-structure.json. |
| 5. Build/tests | FAIL | Site 368/368, site build, local typecheck and local build pass. Local 984/985: unchanged cli-init test fails on existing host file /tmp/h (ENOTDIR), as documented on main. No test or host file changed. Exact-head CI is recorded separately in E/publication.json. |
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
visual-QA PASS is claimed. A full contrast/Lighthouse audit and final
pixel-fidelity approval are unverified. Gate 1 remains FAIL.

The legacy `15-dialog-langfuse-*.png` references are command palettes, not
generic Dialog/Confirm instances; they are not passed off as those references.
Real source captures preserve their pixels and hide the account footer.
An initial local-gallery failure came from crossing the site's separate
Preact module identity; the gallery no longer imports the site's Peek hooks.
Product routes, rather than a second renderer, exercise existing panels.
