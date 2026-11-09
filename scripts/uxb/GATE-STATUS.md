# PR-1: real Demo computed styles pass; raw differences reported separately

Skillar's 13 shared Preact controls now use actual public Demo defaults,
not contradictory pinned-primitive defaults. All 104 prior computed-style
failures are closed in the product components.
PR: https://github.com/changeroa/skillar/pull/100, base `main`.
Keep draft for the lead's independent re-review; no merge or production deploy.

Evidence root E:
`/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-1`.
Exact final publication head, all CI conclusions and cleanup are recorded
in `E/publication.json`, not inferred from a previous head.

| Gate | Result and evidence |
| --- | --- |
| 1. Actual Demo controls | 172/172 computed-style comparisons PASS, zero remaining computed failures. Eight owner-approved native-popup states remain NATIVE-ADAPTATION; their closed triggers also PASS. Every pair retains an unmasked, zero-tolerance raw diff and side-by-side. Pixel identity is not asserted. `demo-defaults-summary.json` and `demo-defaults-results.md` contain final-head per-control/raw counts and every remaining raw case. |
| 2. Changed visual surfaces | Current gallery QA: 16 logical captures across site/local, light/dark, desktop 1440x900 @1x and phone 390x844 @3x; no page overflow, overlap or clipped actionable content observed. Desktop receipts: `rendering-visual`; corrected 3x phone receipts: `rendering-visual-phone3x`. Prior 64 legacy production-screen comparisons remain historical; no production screen is migrated in this PR. |
| 3. Keyboard / ARIA / touch | Fresh controls 12/12 and foundation 20/20. Trusted Tab/Shift+Tab/Enter/Space, AX names, native form/checkbox semantics, original clipboard value and >=44px touch targets pass. Original OS clipboard restored and byte-verified. Real screen-reader sessions and OS-native popup screenshots are not claimed. |
| 4. R1-R7 scope | Existing 8/8 structure evidence retained; R4 N.A. No production routes, APIs or screen composition are migrated. Comparison hosts select public variants; they never override primitive paint to manufacture a match. |
| 5. Tests / builds | Site 365/365, including 20 control and 7 harness tests; site/local builds and local typecheck exit 0. Unchanged backend suite is left to exact-head CI. The last full local run's authorized pre-existing `/tmp/h` ENOTDIR (984/985) remains a historical exception, not a newly hidden failure. TSX LSP freshness is unreliable; CLI checks are clean. MJS TypeScript and CSS Biome services are unavailable in this environment. |
| 6. Licensing / package | Actual Demo Plex Mono Regular is embedded unmodified, with IBM's SIL OFL 1.1 added to all three notices. Built notices and source notices compare equal; 171-entry package dry-run includes NOTICE and dist/dashboard/NOTICE. Existing MIT/Lucide notices retained. No dependency or lockfile changes. |
| 7. Deploy | Not deployed; deploy gated on owner. No new preview, production deploy, merge or account change. Prior preview is not presented as this head. |

## Per-control computed styles

Source counts include both themes; comparisons include both applications.

| Control | Source PNGs | Computed PASS / total | Native states included |
| --- | --- | --- | --- |
| Button | 12 | 24 / 24 | 0 |
| IconButton | 6 | 12 / 12 | 0 |
| Badge | 4 | 8 / 8 | 0 |
| StatusBadge | 2 | 4 / 4 | 0 |
| Tag | 4 | 8 / 8 | 0 |
| Input | 6 | 12 / 12 | 0 |
| SearchInput | 6 | 12 / 12 | 0 |
| Select | 18 | 36 / 36 | 8 |
| Checkbox | 8 | 16 / 16 | Native form/indicator approach retained |
| Link | 6 | 12 / 12 | 0 |
| KeyboardShortcut | 2 | 4 / 4 | 0 |
| Skeleton | 4 | 8 / 8 | 0 |
| CopyButton | 8 | 16 / 16 | 0 |

Actual source is the explicitly permitted view-only public Demo, v4.77.0:
https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646.
`captures.md` retains exact URLs, original markup, bounds, styles, tokens,
missing states and unchanged source PNGs. Supplied v4.76.0 images are historical.
No new sign-in, create/edit/settings action or customer project was used.

## Decisions and remaining cases

Button/IconButton/compact Select use observed inset rings; regular Select and
Checkbox retain the observed outset ring. Mono fields, actual adornments and
padding, Beta palette, 17/21px pills, inactive-status composition, Tag glyph,
header variant, regular muted inline Link and transparent Copy hover now
match the corresponding Demo sources. Added tokens cite named captures.
The mono-font gate checks a genuinely loaded FontFace, not just a family alias.

No selected basic Button instance was found in the checked Demo routes.
The unsupported selected wash is removed; aria-pressed and the check remain.
DESIGN.md now records this choice. Selected/copying/copied/error comparisons
are 48/48 upstream and 24/24 cross-app, with zero raw differing pixels.

Owner-approved differences remain default 32px desktop / 44px touch geometry,
native Select popup and native Checkbox/WAI-ARIA behavior. The options-panel
case explicitly compares computed styles to the observed closed trigger;
its original custom-popup PNG and raw diff remain visible.

Matching-content raw differences are fully enumerated, not converted into
identity claims or excused as live data. Four options-panel pairs have
different native/custom popup content. Transparent surrounding surfaces,
native indicators and pulse/caret phase can affect raw images; no blanket
unverified raster-only explanation is asserted. Thresholds and masks are unchanged.

All original 1,200 supplementary scratch comparison IDs and receipts remain.
They are not relabeled as real Demo captures or asserted to describe current
defaults after the reference authority changed. Only affected state specimens
were refreshed; the full matrix was not rerun against superseded pinned defaults.
