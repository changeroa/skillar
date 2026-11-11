# PR-8 viewers and P1 controls

Draft PR: https://github.com/changeroa/skillar/pull/108
Branch: `uxb/pr-8-viewers`; baseline `b8b1d62` (merged PR-0 through PR-6).
Evidence: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-8/`.
Exact final head, CI and preview receipts: `publication.json`, `ci.json`, `preview.json` in that directory. These receipts are written after publication; this ledger does not claim self-approval.

## Gate verdicts

| Gate | Verdict | Executed evidence and remaining cases |
| --- | --- | --- |
| 1 Component visual parity | FAIL | `p1-final.json`: 480/632 strict style comparisons pass, 152 fail; 632 captures and side/raw pixel diffs. Toast passes 48/48. Native/compound control references and viewer wrapping are not equivalent; see details below. |
| 2 Screen comparison | FAIL | 48 before/after frames, 12 genuine Demo frames and 24 labelled Demo/before/after context boards; 24 local/real-hosted-embed consumer checks pass. Different product/data contexts are labelled, not passed off as same-data parity. Independent visual review and complete consumer-state comparison remain unverified. |
| 3 Keyboard/ARIA | FAIL | 14 trusted-key interaction checks and 72 painted-focus checks pass, including eight rejected missing-ring controls. Real-page focus/size regression passes 35/36; the one failure addresses an excluded dev-gallery URL on the production fixture server. Full state/part coverage, including every date and selection popup part, is not certified. |
| 4 R1-R7 structure | PASS | `runtime/runtime.json`: 28 real page/profile rows assert heading, active navigation, identity, breadcrumb/palette, no page overflow, row density and zero baseline; 24 local/real-embed consumer checks have no page overflow. |
| 5 Tests and builds | PASS with existing local exception | Site 479/479; local typecheck/build pass; local full suite 986/987, separate sync performance 1/1, changed trace regressions 15/15. The sole local ENOTDIR also reproduces on immutable baseline. Final-head CI is recorded separately. |
| 6 License/release safety | PASS | `release.json`: matching root/site/local NOTICE, NOTICE in npm pack, 52 built artifacts and 181 package files without dev gallery/QA modules. |
| 7 Deployment | PASS (preview only) | Not deployed; deploy gated on owner. Only `uxb-pr-8` Pages preview is authorized. Its verified URL and exact deployment receipt are in `preview.json`. No production deployment or merge. |

G1-G3 remain FAIL: this is a draft, not merge-ready or an independent approval.
PR-7 (#106) was still open during final checks; reconcile after it merges. No PR-7/PR-9 worktree was modified.

## Implemented scope and behavior

Shared Preact Markdown/Code/Diff viewers, KST DateRangeFields/DateRangeInput/TimePeriodSelect, Textarea, Combobox/MultiSelect, Switch, Radio, Spinner, Toast and Avatar. Existing hosted document/search/editor, command forms, consent modes/backfill dates, connection CLI commands, account, local sessions/analysis periods and trace argument/attribute consumers use the primitives.

Markdown retains the existing structural subset and escaped text behavior. Highlighting uses Prism token trees as escaped Preact spans, with automatic DOM highlighting disabled. No raw HTML insertion, React/Radix/cmdk runtime, API, auth, consent-save or diff-algorithm change. Consent keeps the original exact-millisecond text fallback.

Late real-screen QA removed the legacy Markdown class that overrode shared typography, excluded shared CodeBlock pre elements from the old trace margin rule, and corrected small Avatar line height to 18px. Those surfaces were recaptured. Gallery-only CSS and reference renderers are absent from production output.

## Strict visual failures are not waived

The final 152 failing comparisons are Textarea/code (8 font-family fallback-stack differences), Combobox (32), MultiSelect (24), MarkdownViewer (24), CodeBlock (24), DiffViewer (16), DateRangeInput (16) and TimePeriodSelect (8). All Switch 128, Radio 40, Spinner 128, Avatar 104 and Toast 48 comparisons pass.

The primary Demo selection reference is a composed disabled dashboard trigger, while the product uses an editable native input. Source viewer captures have different available line widths, so equal text wraps differently. DateRangeInput adapts the source calendar to native KST fields; TimePeriodSelect uses a transparent native select over a painted trigger. These are measured differences, not blanket parity exemptions. Several compound paint parts and same-state source matches still need a corrected reference/measurement audit. Existing genuine Switch captures were not independently reconciled with every pinned-MIT variant.

The 32px mouse/44px touch owner policy, WAI-ARIA behavior and visible painted focus override upstream. Root viewport, coarse-pointer state, overflow and Prism manual mode pass all eight gallery profiles. Toast touch/action height adaptations are explicit numeric policies; no general color/style tolerance hides differences.

## Toast amendment and source provenance

Pinned source SHA: `69181812b87169df157841fce1314ec96ecd2c5a`.
`mit-entry.tsx`, `build-mit.mjs`, `mit-provenance.json` render actual MIT components, not product components. The 3,088-input build excludes enterprise paths. Sonner 2.0.7 supplies the actual Toaster runtime; product code contains only attributed status SVG/loading mechanisms and a Preact implementation. Reference font bytes are original retained IBM Plex Mono, with provenance/hash in the reference metadata, not product CSS used as expected values.

The owner-approved PR-8 amendment replaces the former whole-component stop. Textarea, Radio and Toast have no whole-family read-only capture in the inspected routes; actual pinned-MIT renders are labelled. Fresh mobile contexts show a profile avatar, and the loaded Home context includes a chart loading glyph. Their equivalence to the pinned Avatar/Spinner components has not been audited, so those families are not certified as unreachable and their reference reconciliation remains part of G1 FAIL. No error, write, create/edit, settings or account action was induced on the Demo. A copy-success check glyph was not relabelled as Toast.

Routes inspected under `https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646`:

- A: root dashboard, loaded tables and its period/date popover, including Select from calendar.
- B: `/traces`, the public trace concerning how Langfuse computes model cost, and its read-only Formatted detail.
- C: `/prompts/answer%20question`, including enabled Compare with selected prompt (read-only comparison, never edit).

The account footer was hidden and checked before every fresh Demo context capture. `demo-records.json` has 14 genuine atomic references; `demo-context.json` has 12 settled full frames at 1440x900/390x844 in light/dark.

### Individually enumerated pinned-MIT variants

Every row below was captured for site/local, 1440 mouse/390 coarse and light/dark (eight comparisons). A/B/C identify exact checked routes above. A missing read-only variant control is not a claim that no other Demo route can expose it; the incomplete reconciliation is retained as G1 FAIL. The Toast whole-component exception is explicitly authorized.

| Component | Variant/state | Checked routes | Reference |
| --- | --- | --- | --- |
| Textarea | `default` | A, B, C | Actual pinned MIT, labelled |
| Textarea | `empty` | A, B, C | Actual pinned MIT, labelled |
| Textarea | `disabled` | A, B, C | Actual pinned MIT, labelled |
| Textarea | `error` | A, B, C | Actual pinned MIT, labelled |
| Textarea | `code` | A, B, C | Actual pinned MIT, labelled |
| Switch | `default-default-unchecked-enabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `default-default-unchecked-disabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `default-default-checked-enabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `default-default-checked-disabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `default-green-unchecked-enabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `default-green-unchecked-disabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `default-green-checked-enabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `default-green-checked-disabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `sm-default-unchecked-enabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `sm-default-unchecked-disabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `sm-default-checked-enabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `sm-default-checked-disabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `sm-green-unchecked-enabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `sm-green-unchecked-disabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `sm-green-checked-enabled` | A, B, C | Actual pinned MIT, labelled |
| Switch | `sm-green-checked-disabled` | A, B, C | Actual pinned MIT, labelled |
| Radio | `unchecked-enabled` | A, B, C | Actual pinned MIT, labelled |
| Radio | `unchecked-disabled` | A, B, C | Actual pinned MIT, labelled |
| Radio | `checked-enabled` | A, B, C | Actual pinned MIT, labelled |
| Radio | `checked-disabled` | A, B, C | Actual pinned MIT, labelled |
| Radio | `group` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `xxs-primary` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `xxs-muted` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `xs-primary` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `xs-muted` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `sm-primary` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `sm-muted` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `md-primary` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `md-muted` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `lg-primary` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `lg-muted` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `xl-primary` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `xl-muted` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `xxl-primary` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `xxl-muted` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `full-primary` | A, B, C | Actual pinned MIT, labelled |
| Spinner | `full-muted` | A, B, C | Actual pinned MIT, labelled |
| Toast | `default` | A, B, C | Actual pinned MIT, labelled |
| Toast | `success` | A, B, C | Actual pinned MIT, labelled |
| Toast | `info` | A, B, C | Actual pinned MIT, labelled |
| Toast | `warning` | A, B, C | Actual pinned MIT, labelled |
| Toast | `error` | A, B, C | Actual pinned MIT, labelled |
| Toast | `loading` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `sm-circle-muted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `sm-circle-tinted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `sm-rounded-muted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `sm-rounded-tinted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `md-circle-muted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `md-circle-tinted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `md-rounded-muted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `md-rounded-tinted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `lg-circle-muted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `lg-circle-tinted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `lg-rounded-muted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `lg-rounded-tinted` | A, B, C | Actual pinned MIT, labelled |
| Avatar | `image` | A, B, C | Actual pinned MIT, labelled |

## Validation commands and exceptions

- `cd site && npm test && npm run build` passes (479 tests). Standalone Site CI resolves shared UI dependencies from site/node_modules; test bundlers share the renderer's Preact instance.
- `cd local && npm run typecheck && npm test && npm run build`: typecheck/build pass. Full tests are 986/987 on this workstation only: `the planned LaunchAgent plist runs absolute paths that exist` fails with `ENOTDIR: /tmp/h/Library/LaunchAgents/dev.skillar.daemon.plist`. The same test fails on the immutable b8b1d62 baseline. Neither the test nor /tmp/h was changed.
- `node --test test/sync-performance.mjs`: 1/1; changed trace regression pair: 15/15.
- `node scripts/uxb/p1-release.mjs <repo> <evidence>`: pass.
- LSP was unavailable (workspace TypeScript initialization/missing Biome); executed project typechecks and production builds are the compiler evidence.

Independent review belongs to the lane lead. No reviewer approval is claimed. Preview authentication, forced-colors and a full contrast audit remain unverified.
