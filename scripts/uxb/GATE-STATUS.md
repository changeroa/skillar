# PR-0 completion checkpoint

PR #99 remains a draft. Gates 1, 2, 3, and the latest local regression run
are not green. This checkpoint preserves the runnable capture tooling and
its failures; it does not claim review readiness.

| Gate | Result | Evidence |
| --- | --- | --- |
| 1. Upstream visual parity | FAIL | Pinned raw Langfuse CSS rendered independently. All 336 measured specimens pass. 220/224 zero-tolerance upstream image comparisons pass; desktop/light loading and error fail in both apps (243 and 247 pixels). |
| 2. Three-way screen matrix | FAIL | Actual main `d7e907e` was built separately. Provided demo references and 16 screen mappings were prepared. Both first landing cases timed out waiting for settled content; the run was stopped instead of repeatedly retrying. The complete matrix is not delivered. |
| 3. Trusted keyboard / ARIA | FAIL | Site light/dark Tab, Shift+Tab, 32px boxes, focus rings, Enter/Space button activation, toggle activation, and named AX controls pass. Native theme-select changes time out; phone line-height assertion receives `normal` (parsed as null), not 20. Local cases were not reached. |
| 4. Structure | PASS | Existing eight-case responsive structure evidence remains valid; no structure code changed. |
| 5. Build / tests | FAIL | Latest site 342/342 and both builds pass; local typecheck passes. Latest local suite is 984/985: `cli-init.test.mjs:159` encounters an existing regular file `/tmp/h`, causing ENOTDIR. That file and the unrelated test were not modified. The earlier full run was 985/985 plus performance 1/1. |
| 6. License / package | PASS | Existing notice and package-isolation evidence remains valid. |
| 7. Non-production preview | PASS | Actual Pages project `skillar-site` production branch was verified as `main`. Only branch `uxb-pr-0` was deployed. Home and NOTICE return 200; development gallery returns 404. |

Preview: https://33ede3e3.skillar-site.pages.dev

Cross-app parity is now 112/112 at zero tolerance, including the three
previously failing cases. Capture uses composited viewport pixels and
records device-pixel alignment; it does not replace the upstream oracle.
The four remaining upstream image failures have zero measured-style
differences and remain failures, not accepted antialiasing exceptions.

Authoritative private evidence is under
`pr-0/completion/{upstream-captures,upstream-diffs,cross-app-diffs,keyboard,screens}`.
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
