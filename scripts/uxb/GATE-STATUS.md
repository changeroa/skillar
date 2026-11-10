# PR-4 data table gate ledger

Base: `origin/main` at `abee112`. Branch: `uxb/pr-4-table`.
Evidence root: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-4/`.
Draft PR: https://github.com/changeroa/skillar/pull/103.
This is not an independent approval. No merge or production deployment.

| Gate | Status | Evidence and limits |
| --- | --- | --- |
| 1. Component visual parity | PASS for the requested computed-part criterion | 48 real read-only Demo states; 96/96 product cases and 5,596 computed-part/context assertions pass. All contexts match 1440x900/DPR1/mouse. All 96 side-by-sides and unmasked raw diffs are retained: 0/96 pixel identities, 4,938,434 differing pixels. Live records and content widths are not the acceptance criterion. |
| 2. Page comparison | PASS, rerun for the correction | 120/120 before/after/reference cases: 20 screens, 1440/390/1920, both themes. Fresh final-build documents, no document overflow or uncaught page errors. Raw differences remain visible. |
| 3. Keyboard and accessibility | PASS for tested matrix | Existing trusted-key behavior probes retained. The correction verifies 440/440 real focus and width/height targets, including roving menu items, across site/local, light/dark and 1440/390px. Targets are 32px mouse and 44px touch. Removing focus paint fails; changing a 33px row to 80px fails; restoring each passes. |
| 4. Structural R1-R7 | PASS | 8/8 production-fixture cases. All assertions retained. R3 counts data cells, not the new empty-status row; its expected counts are unchanged. R4 remains N.A. in the inherited probe. |
| 5. Build and tests | PASS for affected checks; exact-head CI required | Current site 393/393, both builds, local typecheck, QA-script syntax and 96-case CLI exit 0. Historical local 984/985 has only the known `/tmp/h` ENOTDIR in cli-init; that unrelated suite was not rerun or changed. Final-head CI is mandatory before handoff. |
| 6. License and provenance | PASS | Five notices byte-identical; full MIT pin/license and font licenses retained and packaged. 205 renderer inputs; zero EE inputs. |
| 7. Deployment verification | Historical preview; not republished by this correction | Production not deployed; deploy gated on owner. The existing non-production preview is https://uxb-pr-4.skillar-site.pages.dev. Its earlier receipt is not a final-correction deployment claim. Current head and completed CI belong in `publication.json`. |

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
| Toolbar | 4/4 |
| FacetPanel | 16/16 |
| Pagination | 20/20 |
| Density | 16/16 |
| ColumnVisibility | 4/4 |

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

Current receipts: `actual-demo-parts.json`, `table-parity-input.json`,
`table-parity-results.json`, `focus-matrix-final.json`,
`negative-part-proofs.json`, `comparisons-final/` and `viewport-final/`.
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
