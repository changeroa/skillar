# PR-1 basic controls: actual Demo evidence delivered; parity FAIL / draft

Skillar's 13 shared Preact controls are exercised in both development galleries.
PR: https://github.com/changeroa/skillar/pull/100, base `main`.
Product-screen migration remains in later PRs. No merge or production deploy.

Evidence root E:
`/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-1`.
Exact publication head and final-head CI are recorded in `E/publication.json`.
Independent review is arranged by the lane lead, not self-certified here.

| Gate | Result | Evidence |
| --- | --- | --- |
| 1. Component parity | FAIL | Actual public Demo: 86 source PNGs, 172 site/local pairs, 60 computed-style PASS, 104 FAIL, 8 explicit native-popup adaptations. Only 4 raw pixel-identical pairs; 168 DIFFERENT. Supplemental scratch: 1,230/1,248 upstream, 624/624 cross-app. All original 1,200 IDs retained; their 1,194 PASS and six one-pixel FAIL remain. The new 48 comparisons contain 36 CopyButton-state PASS and 12 selected-Button color differences, retained as FAIL. |
| 2. Three-way screens | PASS under existing screen gate | `blocker-final-screens/summary.json`: 64/64, fresh documents, no missing reference. One local desktop/dark peek case has one changed pixel, max delta 2; this is not byte identity. Captions now read baseline/current. |
| 3. Keyboard / ARIA / touch | PASS for exercised behavior | Fresh `blocker-final-keyboard` 12/12 and `blocker-foundation-keyboard` 20/20; trusted keys, AX names, clipboard readback, minimum 44x44 touch targets. Original OS clipboard restored and verified byte-for-byte. No real assistive-technology session or OS-popup dismissal certification is claimed. |
| 4. R1-R7 structure | PASS, retained scope evidence | Existing `structure/qa-structure.json`: 8/8; R4 N.A. for this controls-only PR. New fixtures are development-only; no production screen, route or API migration. |
| 5. Tests / builds | PASS with authorized local baseline exception | Site 361/361, including 16 control and 7 harness tests. Site/local production builds and local typecheck exit 0. Local 984/985 retains the pre-existing `/tmp/h` ENOTDIR; separate performance test 1/1. Exact-head CI is recorded at publication rather than inferred from a prior head. |
| 6. License / package | PASS | Pinned MIT/Lucide notices retained; built notices compare equal. Fresh dry-run package has 171 entries including NOTICE and dist/dashboard/NOTICE. No product dependencies or lockfiles changed. |
| 7. Deployment | Not deployed; deploy gated on owner | No new deployment in this correction. Prior non-production preview: https://uxb-pr-1.skillar-site.pages.dev. It is not presented as this head's preview. No merge, production deploy or account change. |

## Primary actual Demo coverage

Both themes use the explicitly permitted view-only public project:
https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646.
The live Demo reports v4.77.0; supplied historical captures are v4.76.0.
No new sign-in, create/edit/settings action or customer project was used.
Account footer is hidden. Exact URLs, original markup, bounds, styles, tokens,
methods, data changes and missing states are in `E/captures.md` and
`E/demo-captures/records.json`.

| Control | Source PNGs, light + dark | Site + local comparisons | Style PASS / FAIL / native |
| --- | --- | --- | --- |
| Button | 12 | 24 | 12 / 12 / 0 |
| IconButton | 6 | 12 | 8 / 4 / 0 |
| Badge | 4 | 8 | 0 / 8 / 0 |
| StatusBadge | 2 | 4 | 0 / 4 / 0 |
| Tag | 4 | 8 | 0 / 8 / 0 |
| Input | 6 | 12 | 0 / 12 / 0 |
| SearchInput | 6 | 12 | 0 / 12 / 0 |
| Select | 18 | 36 | 12 / 16 / 8 |
| Checkbox | 8 | 16 | 12 / 4 / 0 |
| Link | 6 | 12 | 0 / 12 / 0 |
| KeyboardShortcut | 2 | 4 | 0 / 4 / 0 |
| Skeleton | 4 | 8 | 8 / 0 / 0 |
| CopyButton | 8 | 16 | 8 / 8 / 0 |

`E/demo-final-comparisons/` contains every real reference/product side-by-side,
raw diff and computed assertion. Geometry tolerance is +/-1 CSS px; computed
token colors are exact. Raw image comparison is zero-tolerance, including
alpha, with no mask or corner allowance. Native outlines and box shadows are
both measured. Literal font-family aliases remain visible mismatches, not
proof by themselves of different font bytes.

Deployed legacy/contextual compositions differ from pinned primitives:
inset versus outset focus rings, contextual Input adornments and padding,
Badge palettes, status anatomy, Tag icons, Link weight/color and native popup
rendering. Surrounding surfaces and live Skeleton animation also affect raw
pixels. These results are not waived or relabeled pixel-identical.
`E/review-blocker-results.md` lists every pair and remaining property mismatch.

## Complete supplementary states, unchanged thresholds

`E/make-manifest.mjs` no longer excludes `copy-copied`. Its 104 states include
selected Button and CopyButton copying, copied and error, yielding 1,872 capture
records, 1,248 upstream pairs and 624 cross-app pairs. All original IDs remain.
The real async handlers drive clipboard states through a localhost-only
transport seam, never a fabricated hosted-Demo error or pasted check icon.

No selected basic Button or copying/error Demo instance was found on the
checked read-only routes; provenance explicitly says "no demo instance".
The pinned Button has no selected wash, while the product retains its documented
selected wash. All 12 resulting supplementary differences remain FAIL.
The original six one-pixel raster cases are non-blocking under the review
direction, but still raw FAIL; no threshold or mask was changed.

A full-batch local copy-focus capture had four extra raster pixels. A fresh
isolated rerun reproduced only the original one-pixel residue on both products.
`blocker-final-combined.json` and `blocker-verified-{upstream,cross-app}` retain
every ID, identify the six refreshed capture records and their source receipts,
and preserve the initial batch alongside the rerun. No code change was needed.
