# PR-1 basic controls: FAIL / draft

PR: https://github.com/changeroa/skillar/pull/100 (base `main`, no merge).
Branch: `uxb/pr-1-controls`; baseline `9e833df612694156437ef5c725f1a818069bd8a6`.
All 13 controls are implemented in shared Preact and both dev galleries.
Product screen migration remains in its scheduled later PRs.

| Gate | Result | Measured evidence |
| --- | --- | --- |
| 1. Component parity | FAIL | 1,800 fresh captures, 100 states, three profiles, both themes. Strict upstream comparison: 324/1,200 pass. Cross-app comparison: 596/600 pass; four primary-button cases differ by 60 pixels beyond the permitted corner allowance, max RGB delta 18, alpha delta 0. |
| 2. Three-way screens | PASS | 64/64 fresh cases against untouched main, complete supplied reference inventory, no changed screen pixels. |
| 3. Keyboard / ARIA / touch | PASS | 12/12 control cases and 20/20 global Tab/theme/AX cases; original clipboard value read back; minimum real touch targets 44x44 at phone and desktop-coarse widths. |
| 4. R1-R7 structure | PASS | Eight production fixture scenarios; R4 N.A. for this control-only PR, existing home links remain unchanged. |
| 5. Builds / tests | PASS locally with allowed baseline exception | Site 357/357; both builds and local typecheck pass. Local 984/985: sole ENOTDIR from the existing `/tmp/h` regular file. Performance 1/1 separately passes. Clean-environment CI is the PR check decision; see the linked checks and full gate receipt. |
| 6. License / package | PASS | Pinned MIT source paths/SHA and Lucide licenses in notices. Shipped notices compare equal; dry-run package contains NOTICE and dist/dashboard/NOTICE. No product dependency changes, React, Radix or cmdk imports. |
| 7. Deploy | PASS: not deployed; deploy gated on owner | Only non-production Pages preview branch `uxb-pr-1`; no main/Worker/account changes. Preview home and NOTICE 200, dev gallery 404. |

Preview: https://uxb-pr-1.skillar-site.pages.dev
CI: https://github.com/changeroa/skillar/pull/100/checks
Full evidence:
`/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-1/gate.md`.

Reference origin is an actual pinned MIT component render in isolated scratch,
as explicitly authorized in the user's follow-up. Existing capture candidates
were inspected first. No sign-in, account or customer project was used.

Parity differences are not waived: required 44px touch boxes versus 32px
upstream, native Select/Checkbox semantics, additional ARIA validation,
readable status text, focus-outline metadata and rounded-corner rasterization
remain visible in raw data and side-by-side/diff PNGs. No global tolerance,
alpha tolerance or corner tolerance above RGB 8 was introduced.

Independent review is arranged by the lane lead. It is not self-certified.
The PR remains draft because Gate 1 fails; do not merge or mark ready.
