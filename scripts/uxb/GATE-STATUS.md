# PR-4 data table gate ledger

Base: `origin/main` at `abee112`. Branch: `uxb/pr-4-table`.
Evidence root: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-4/`.
Draft PR: https://github.com/changeroa/skillar/pull/103.
This is not an independent approval. No merge or production deployment.

| Gate | Status | Evidence and limits |
| --- | --- | --- |
| 1. Component visual parity | FAIL | 50 actual read-only Demo captures; 96 product states and 96 raw diff pairs. All contexts match 1440x900/DPR1/mouse; 12 measured-style cases match. Same-data and raw-pixel fidelity are not established: 0/96 strict approvals. No component has zero real references. |
| 2. Page comparison | PASS | 120/120 before/after/reference cases: 20 screens, 1440/390/1920, both themes. Fresh documents, no document overflow or uncaught page errors. Raw differences remain visible. |
| 3. Keyboard and accessibility | PASS for tested matrix | Trusted-key sort, selection, menu, pagination, skills and sessions probes; 204 painted-focus checks and 204 successful ring-removal negative probes. 470 real controls in 18 page/theme/pointer cases enforce 32px mouse and 44px touch/coarse height. |
| 4. Structural R1-R7 | PASS | 8/8 production-fixture cases. All assertions retained. R3 counts data cells, not the new empty-status row; its expected counts are unchanged. R4 remains N.A. in the inherited probe. |
| 5. Build and tests | PASS with baseline exception; exact-head CI in publication receipt | Site 393/393; both builds, local typecheck and pack exit 0. Local 984/985: only the known `/tmp/h` ENOTDIR in cli-init. Checkpoint CI passed; final-head CI is mandatory before handoff. The host file and test were not changed. |
| 6. License and provenance | PASS | Five notices byte-identical; full MIT pin/license and font licenses retained and packaged. 205 renderer inputs; zero EE inputs. |
| 7. Deployment verification | Publication receipt required | Production not deployed; deploy gated on owner. Only non-production `uxb-pr-4` is authorized. Preview: https://uxb-pr-4.skillar-site.pages.dev. Final preview smoke and completed exact-head CI belong in `publication.json`; absent receipts mean FAIL. |

## Owner overrides

32px mouse controls, 44px coarse-pointer or <=768px controls; visible focus;
correct WAI-ARIA semantics; native links and dialogs. The validator gives
owner sizing precedence even if the upstream and product share a wrong size.
Zero-width border colours are non-painted, not visual mismatches.

## Reference and verification limits

All eight inventory components have actual read-only Demo evidence, including
reachable text/collapsed facets, unsorted headers and cold-loading pagination.
Loading uses network latency, never a forced error. No source settings,
saved views or account data were written. No translated HTML stands in for
an actual component, and no reference image is changed or masked.

The strict visual gate remains FAIL: product fixtures contain different
records, labels, column counts and facet structures. Raw screenshots and
style differences are evidence, not a same-data visual approval.
Zero-width border colours are recorded separately as non-painted values.
The capture profile explicitly resets coarse-pointer emulation so mouse
comparisons cannot accidentally use 44px touch controls.

The real embed exposed a global `select { min-height: 44px }` enlarging the
transparent native Select beyond its 32px wrapper. The primitive now resets
that inherited minimum. The failing measurement is retained separately;
all 18 current real-page cases pass. `table-sizing.mjs` measures native hit
areas as well as visible controls.

Independent review is lead-owned, not an implementer approval. See the
evidence root's `gate.md`, `review-handoff.md` and `publication.json`.
Lighthouse, a full contrast audit, forced-colors screenshots and preview
authentication remain unverified.
