# PR-1 basic controls: FAIL / draft

PR: https://github.com/changeroa/skillar/pull/100 (base `main`, no merge).
Branch: `uxb/pr-1-controls`; baseline `9e833df612694156437ef5c725f1a818069bd8a6`.
All 13 controls are implemented in shared Preact and both dev galleries.
Product screen migration remains in its scheduled later PRs.

| Gate | Result | Measured evidence |
| --- | --- | --- |
| 1. Component parity | FAIL | 1,800/1,800 capture assertions pass. All original 1,200 comparison IDs retained: upstream 1,194/1,200 pass, cross-app 600/600 pass. Six remaining comparisons each differ by one SVG stroke pixel, max RGB delta 1, alpha delta 0; no metric differences or accepted corner pixels. |
| 2. Three-way screens | PASS | 64/64 fresh cases against untouched main, complete supplied reference inventory, no changed screen pixels. |
| 3. Keyboard / ARIA / touch | PASS | Final native-appearance run 12/12 control cases; global Tab/theme/AX 20/20. Original clipboard value read back; minimum real touch targets 44x44 at phone and desktop-coarse widths. |
| 4. R1-R7 structure | PASS | Eight production fixture scenarios; R4 N.A. for this control-only PR, existing home links remain unchanged. |
| 5. Builds / tests | PASS locally with allowed baseline exception | Site 359/359; six harness tests pass; both builds and local typecheck pass. Local 984/985: sole ENOTDIR from the existing `/tmp/h` regular file. Performance 1/1 separately passes. Exact publication SHA and clean-environment CI are recorded in the full receipt and linked PR checks. |
| 6. License / package | PASS | Pinned MIT source paths/SHA and Lucide licenses in notices. Shipped notices compare equal; dry-run package contains NOTICE and dist/dashboard/NOTICE. No product dependency changes, React, Radix or cmdk imports. |
| 7. Deploy | PASS: not deployed; deploy gated on owner | Only non-production Pages preview branch `uxb-pr-1`; no main/Worker/account changes. Preview home and NOTICE 200, dev gallery 404. |

Preview: https://uxb-pr-1.skillar-site.pages.dev
CI: https://github.com/changeroa/skillar/pull/100/checks
Full evidence:
`/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-1/gate.md`.

Reference origin is an actual pinned MIT component render in isolated scratch,
as explicitly authorized in the user's follow-up. Existing capture candidates
were inspected first. No sign-in, account or customer project was used.

The original 876 failures are grouped exhaustively by component, state,
theme and observed cause in the full receipt. Reference content, fonts,
44px touch geometry and static crop coordinates now match. Each render
uses a fresh native browser target; this removed 22 false native focus
and selection failures without modifying their colors or comparisons.

Remaining failures are `{site,local}-phone-dark-` followed by
`icon-ghost-focus`, `icon-destructive`, or `copy-default-focus`.
The six one-pixel differences remain unexplained renderer-level residue;
they are not waived as component-corner AA. No comparison ID was added
or dropped, no pixel mask was introduced, and the existing RGB<=8
component-corner allowance and zero alpha tolerance are unchanged.

Independent review is arranged by the lane lead. It is not self-certified.
The PR remains draft because Gate 1 fails; do not merge or mark ready.
