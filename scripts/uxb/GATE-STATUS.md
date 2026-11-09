# PR-0 completion checkpoint

PR #99 remains a draft because the local test suite still has one reproduced
baseline filesystem failure. The four requested diagnoses and scoped fixes
are complete; no unrelated test or `/tmp/h` file was modified.

| Gate | Result | Evidence |
| --- | --- | --- |
| 1. Upstream visual parity | PASS | Raw pinned CSS rendered independently. All 336 measured specimens pass; 224/224 image comparisons pass with the explicit corner-only raster policy below. Raw zero-tolerance differences remain visible and recorded. |
| 2. Three-way screen matrix | PASS | Main `d7e907e` was built independently. All 64 cases have fresh before/after documents, provided demo references, triptychs, and diffs at 1440x900 and 390x844, both themes. Reference inventory lists no missing required file. |
| 3. Trusted keyboard / ARIA | PASS | Both apps, both themes: trusted Tab/Shift+Tab, focus rings, Enter/Space activation, native typeahead/change, AX semantics, system/light/dark wiring. Phone DPR3 and desktop-coarse controls are 44px with 13px/20px text. |
| 4. Structure | PASS | Existing eight-case responsive structure evidence remains valid; no structure code changed. |
| 5. Build / tests | FAIL (baseline environment) | Site 343/343, harness 5/5, both builds, local typecheck, performance 1/1 pass. Local 984/985 fails only at `cli-init.test.mjs:159`: existing regular file `/tmp/h` causes ENOTDIR. Independently built main reproduces the identical failure (10/11). TMPDIR, file, and test remain unchanged. |
| 6. License / package | PASS | Existing notice and package-isolation evidence remains valid. |
| 7. Non-production preview | PASS | Actual Pages project `skillar-site` production branch was verified as `main`. Only branch `uxb-pr-0` was deployed. Home and NOTICE return 200; development gallery returns 404. |

Preview: https://33ede3e3.skillar-site.pages.dev

The original 243/247-pixel differences were border pixels, not text/icons or
animation (zero animations). Fractional CSS translate interpolated the bottom
edge. Relative layout alignment plus two paint frames removes that artifact.
The full source run retains 96 sparse corner pixels across eight comparisons:
control corners max RGB delta 8; sidebar corners max 2. No interior or alpha
differences are accepted. Text and icons remain exact.

The explicit comparison CLI argument `8` permits at most eight RGB steps only
in the four measured-radius corner boxes around the 4px crop inset, scaled by
DPR. Default tolerance stays zero; alpha stays exact everywhere. All raw
pixels, per-channel maxima, policy bounds, and diff images remain available.
For a 250x40 control with radius 6, boxes are x=3..9 or 240..246 and y=3..9 or
30..36. The regression test rejects center-pixel and alpha drift.
Cross-app comparisons pass 112/112 with the same corner-only policy: 20 raw
corner pixels, max RGBA deltas [2,2,2,0], no interior differences.

Landing's settle counter collided with the mock's `__qaPending` function and
became NaN. The new namespaced counter observes fetch-body/DOM/paint signals.
Hash navigation also reused the old document; blank navigation now ensures
both build cookies actually load their own document and assets.

The six nonzero full-screen diffs are five expected dark status replacements
and one hosted light command-trigger corner pixel (1279,9), max delta 10,
at its fractional x=1151.765625. No layout/content change is inferred from it.
The live demo redirected to `/auth/sign-in`; provided captures were used.
Legacy fixture error/feature-gated/empty states remain labelled as such.

Authoritative private evidence is under
`pr-0/completion/{verified-upstream,accepted-upstream-diffs,accepted-cross-app,final-keyboard,final-screens}`.
The complete reference file list is in `final-screens/summary.json`; detailed
diagnoses are in `completion/diagnoses.md`. Earlier failed runs are preserved.
Provided demo images stay private. No production deployment, Worker deployment,
account-setting change, merge, or self-approval occurred.

## PR-0 scope

PR-1 reusable controls and badges, PR-2 custom overlays, PR-3 shell/command
palette/tabs, PR-4 tables, PR-5 widgets, PR-6 hosted screen migrations,
PR-7 local tree/timeline/JSON keyboard models, PR-8 remaining controls/viewers,
and PR-9 landing migration are N/A here. Native foundation probes are tested;
they are not implementations of those later components.

The runtime's `max_depth 1` prevents child reviewers at depth 2. It does not
prevent this lane's browser or CLI checks. Independent review is arranged by
the owner and is not counted as a failing PR-0 gate.

## Exact pinned dark status pairs

The earlier handwritten gate report had incorrect yellow/red values and
omitted fill alpha. The implementation uses the pinned raw declarations:

| Status | Fill | Foreground |
| --- | --- | --- |
| Green | `oklch(37.8% 0.077 168.94 / 0.7)` | `oklch(76.5% 0.177 163.223)` |
| Yellow | `oklch(55.4% 0.135 66.442 / 0.4)` | `oklch(79.5% 0.184 86.047)` |
| Red | `oklch(39.6% 0.141 25.723 / 0.7)` | `oklch(76.5% 0.177 27.325)` |

No wireframe approximation was substituted.
