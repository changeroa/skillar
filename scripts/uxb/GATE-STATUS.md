# PR-3 shell gate ledger

Base: `origin/main` at `7bc3da9`. Branch: `uxb/pr-3-shell`.
Evidence root: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-3/`.
Draft PR: https://github.com/changeroa/skillar/pull/102.
This is not an independent approval. No merge or production deployment.

| Gate | Status | Evidence and limits |
| --- | --- | --- |
| 1. Component visual parity | PASS | 3,840/3,840 computed assertions; zero missing sources or failures. All 192 product crops retained, with 42 real Demo and 6 actual pinned MIT references. Raw pixel differences remain unmasked and are not claimed identical. |
| 2. Page comparison | PASS | 64/64 before/after/reference cases, 16 routes at 1440/390 in both themes; distinct fresh documents, no document overflow or uncaught page errors. |
| 3. Keyboard and accessibility | PASS for tested matrix | 16 trusted-key contexts; 12 genuine 390x844 DPR3/touch captures; 210 real-page states and 2,006 controls enforce 32/44px with zero failures. |
| 4. Structural R1-R7 | PASS | 8/8 production-fixture cases. Original assertions retained; closed-palette lookup accommodates unmounting. R4 remains N.A. in the inherited probe. |
| 5. Build and tests | PASS with baseline exception; exact-head CI in publication receipt | Site 382/382; both builds, local typecheck and pack exit 0. Local 984/985: solely the known pre-existing `/tmp/h` ENOTDIR in cli-init; never changed or deleted. |
| 6. License and provenance | PASS | Five source/build notices are byte-identical, full MIT license/pin retained, NOTICE included in package; 126 actual pinned MIT renderer inputs, zero EE inputs. |
| 7. Deployment verification | Publication receipt required | Production not deployed; deploy gated on owner. Only non-production `uxb-pr-3` is authorized. Final preview smoke and completed exact-head CI must be recorded in `publication.json` before handoff; absent receipts mean FAIL. |

## Owner overrides

32px mouse controls, 44px coarse-pointer or <=768px controls; visible focus;
correct WAI-ARIA semantics; native links and dialogs. The validator gives
owner sizing precedence even if the upstream and product share a wrong size.
Zero-width border colours are non-painted, not visual mismatches.

## Standing-rule supplementary references

The read-only Demo routes `/traces`, `/sessions`, `/prompts` and
`/prompts/answer%20question` expose no disabled Tabs or navigation controls.
The components themselves have live captures. Only unreachable disabled states
may use the labelled actual pinned MIT renderer in `/tmp/uxb/pr3-reference`;
it imports the original components, not translated HTML or product CSS.
Default, hover, focus-visible, collapsed, filtered, empty and underline states
that Demo exposes remain live-Demo comparisons. No settings, writes or errors
were induced. Independent review is arranged by the lane lead.

## Parity correction and verification limits

All 24 former failures are resolved without validator, threshold, mask or
case exclusions. Sixteen Sidebar height failures were harness setup:
the source fills a fixed parent below a 29px banner, while the gallery parent
was content-sized. `shell-context.mjs` reproduces that measured parent on a
matching 900px-high viewport; it never assigns a size to the component.
The 390px-wide captures still enforce 44px controls; separate real-phone
captures remain 390x844 at DPR3. Eight Topbar failures were product-layer
paint: the header now owns the background and its chrome row is transparent,
matching the real Demo. Three regressions preserve these contracts and prove
the validator still rejects short Sidebars and incorrectly painted rows.
`parity-diagnosis.json` lists every original case by app, width, state, theme
and cause. None of the 24 is classified as unreachable read-only.
The supplemental disabled states remain separately listed with checked routes.
No raw pixel-identical claim is made.
Page reference reuse for local flow/workspaces/heatmap and hosted files is
shell-only; caller content is outside this PR's parity claim.

Independent review has no verdict: the harness refused a nested child, and
the implementer contract assigns it to the lead. `review-handoff.md` maps
the evidence and remaining issues. Lighthouse, a full contrast audit,
forced-colors screenshots and preview authentication are unverified.
