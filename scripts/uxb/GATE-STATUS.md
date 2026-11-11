# PR-8 viewers and P1 controls

Draft PR: https://github.com/changeroa/skillar/pull/108
Branch: `uxb/pr-8-viewers`; baseline `b8b1d62` (PR-0 through PR-6).
Evidence: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-8/`.
Exact publication head, final-head CI and preview receipts: `publication.json`, `ci.json`, `preview.json`. These external receipts are written after publication. Executed implementer gates are not independent approval.

## Reference eligibility follow-up (current)

Product and harness head: `85f7b1e`. The review of `d8eea9a` noted that closed Combobox/MultiSelect, Textarea, Switch, Radio and Spinner rows had been searched on routes A-C only. Those states were searched again on the view-only public Demo, project `cmmnj9e9n0006ad06nyz28646`. The search used Chrome 9333 in our own tabs, at most 3 CDP sessions, no sign-in, and the account footer hidden and asserted in every capture. Every non-read Demo request was failed client-side and logged. Only the `/project/<id>/visit` beacon was ever attempted, and it was blocked. `p1-demo-closed.mjs` asserts that no other non-read request occurred during any capture.

### Found live and switched to REAL-DEMO (`demo-records-closed.json`, 22 rows)

| Component / state | Demo source | Widths captured | Method |
| --- | --- | --- | --- |
| Switch `default-green-checked-disabled` | `/evals/rules`, evaluator-rule Enabled column (view-only user, so disabled) | 1440, 390 | Pointer states only; never toggled |
| Switch `default-green-unchecked-disabled` | same | 1440, 390 | same |
| Spinner `xxs-muted-inline` | `/sessions` table pagination "Page 1 of ..." count | 1440, 390 | Read-only tRPC GETs held until capture, then continued |
| Spinner `xxs-inherit` | `/prompts` Automations count (`AutomationButton`; hidden below `md` in the pinned source) | 1440 (also used for 390 rows) | Only the read-only `automations.count` GET held |
| MultiSelect `empty`, Combobox `default`, Combobox `empty` | `/traces` filter sidebar: Add filter, Categorical Scores, Add condition, then choose the draft key. The values `MultiSelectInput` is closed with no value ("Select"). | 1440 (also used for 390 rows) | No value chosen; the asserted URL has no score filter |
| MultiSelect `selected` | same row after choosing one value ("1 selected"), popup closed with Escape | 1440 (also used for 390 rows) | Applies only a client-side view filter (a read query); nothing is saved |

Caller-context handling is in `p1-gate.mjs`, and it changes no product code:
- **Inherited typography:** the product element's parent receives the Demo parent's inherited typography (font size, line height, weight).
- **Spinner display:** a Spinner also receives its parent display, because the pagination's `inline-flex` blockifies the svg.
- **Width:** the closed Combobox and MultiSelect probes take the Demo trigger width, as the existing live rows already do.
- **Caller copy:** the Demo's placeholder ("Select") and selected label ("1 selected") reach the dev gallery as example parameters, like the code and Markdown examples. Only the three Demo-referenced closed specimens and the selected specimen use them.

### Still ACTUAL-PINNED-MIT, with every route checked

Routes are under `https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646`. Each was inventoried for `textarea`, `[role=switch]`, `input[type=radio]`, `[role=combobox]` and `svg.animate-spin`:
- **Cold loads:** `/`, `/traces`, `/traces/<id>` (full page), the trace peek, `/observations`, `/sessions`, `/sessions/<id>`, `/scores`, `/scores/analytics`, `/users`, `/users/<id>`, `/prompts`, `/prompts/answer%20question`, `/datasets`, `/datasets/<id>/items`, `/evals`, `/evals/<id>`, `/evals/rules`, `/evals/templates`, `/experiments`, `/annotation-queues`, `/dashboards`, `/dashboards/<id>` and `/widgets`.
- **Held loading:** every list route above, at 1440 and 390.
- **Popups and panels:** the dashboard environment and date filters (route D); the traces "Add filter" popover; the Categorical Scores, Boolean Scores and Metadata facets with "Add condition"; the traces "Ask AI" panel; the observations and scores filter sidebars; and the evaluator-rule row.
- **Not opened, because the contract forbids them:** settings, playground, and create/edit dialogs.

| Component / state | Why it stays MIT |
| --- | --- |
| Textarea `default`, `empty`, `disabled`, `error`, `code` | No `textarea` renders on any route above. The pinned consumers are create/edit dialogs, annotation scoring, the AI-filter popover (whose wand trigger is absent on v4.77) and the in-app agent composer (which opened no textarea). `error` would also need an induced validation error. |
| Combobox `disabled`, `error` | The only disabled Demo `MultiSelectInput` is the values picker before a key is chosen, and it is empty. The product `disabled` state shows a chosen value, so the two are not equivalent. `error` needs an induced validation error. |
| MultiSelect `disabled` | Same as Combobox `disabled`: the product state carries a value, and the Demo disabled picker is empty. |
| Switch `default-default-*`, `sm-*`, and `default-green-*-enabled` | The only Switches on the routes above are the evaluator-rule Enabled switches: default size, green, disabled for the view-only user. The pinned `sm` consumers (IOSection toggle, header checkbox actions, session "Show corrections") render as menu items or only in edit mode. The default-colour "Edit Mode" switch is in the evaluator peek, which did not open from the rules table. |
| Radio (all 5) | No `input[type=radio]` on any route above. The only pinned `Radio` consumer is the evaluator test panel, a create/edit surface. |
| Spinner (all others) | Held loading on every list route at both widths showed only `xxs-muted-inline`, `xxs-inherit` and the already-real `md-inherit`. `sm-inherit` appeared once on `/experiments` during a cold load but did not reproduce with held reads, so it is not claimed. |
| Toast, Avatar sizes, CodeBlock `read-only`/`empty`, DiffViewer `empty`, DateRangeInput, MarkdownViewer `empty`/`literal-html` | Unchanged from the section below. These were not part of this follow-up's search scope. |

### Gates at product head `85f7b1e`

| Gate | Result | Evidence |
| --- | --- | --- |
| 1 Component visual parity | PASS | `p1-final.json`: 115 states, 2760/2760 comparisons, 2760 captures, 2760 side/raw diff pairs (`pixel-diffs.json`, 0 errors), 0 evidence errors, 1232 mutation probes rejected. 324 REAL-DEMO rows (was 132) and 2436 pinned-MIT rows (was 2628); 2736 painted, 24 empty non-painted. |
| 3 Keyboard/ARIA | PASS | Same G1 run: keyboard PASS on site and local, and every focus check passes. |
| 5 Tests and builds | PASS, known local exception | Site 557/557 and build; local typecheck and build; local 997/998, the unchanged `/tmp/h` ENOTDIR in `cli-init.test.mjs`; `git diff --check` clean (`pr7-validators/checks.json`). |
| 6 License/release safety | PASS | `release-85f7b1e`: 47 production artifacts and 176 npm-pack files, with NOTICE included and no gallery/QA modules. |
| 7 Deployment | Not deployed | Deploy is gated on the owner. No merge and no preview. |

Merged-validator regressions at `85f7b1e`:
- **PR-7:** full style 84/84, non-ready 252/252, interaction 264/264, disabled outline 8 cases / 240 comparisons, 0 failures.
- **PR-5 paint:** 520 cases, 40,860 assertions, 0 failures, 21,372 rejected mutations, `bootstrap: false`.

Product change revealed by the Demo: `.lf-switch__track` and `.lf-loading .lf-spinner` pinned `font-size`/`line-height` to 16px/24px. The pinned Switch and Spinner inherit caller typography (12-13px in the Demo table and pagination), so the pins were removed. The Radio ring keeps its pin, because no live Radio exists to show otherwise.

## Markdown hostile-input safety (current)

`markdown.tsx` renders Preact text nodes only. It creates no `a`, `img`, `script`, `style` or `iframe` element, and no `href`, `src` or `on*` attribute, so a link is never navigable and no protocol allowlist is needed. Raw HTML, `script`/`img onerror`, SVG `onload`, iframe `srcdoc`, `style`/`link` injection, entities, and `javascript:`, `data:` and `vbscript:` links all stay literal text. A real-browser probe of the dev gallery confirmed this: `window.__pwned` stayed 0, no handler, href, src or style attribute appeared, and the body background was unchanged.

Three problems were found and fixed:
- **Prototype-key fence crash:** ````__proto__``` threw during render (`pattern.exec is not a function`), and ````constructor``` blanked its label. Fence info strings now look up only own language entries and grammar objects.
- **Quadratic emphasis scan:** a 90 KB line of unclosed `_a` openers took 2.6 s. Content may now hold its delimiter only intraword, so 900 KB takes 7 ms.
- **Deep-list stack overflow:** 2000 nesting levels overflowed the stack. Nesting is capped at 16 levels, and every item is kept.

`site/test/markdown-safety.test.mjs` adds six tests; three of them fail on the old code.

## G1 blocker closure (previous head 9bed856)

Product and harness head for every gate below: `9bed856` (on merged PR-7 `03e76038`). It closes the three G1 findings from the `1bdf61f` review. The sections further down are historical.

| Gate | Result | Evidence |
| --- | --- | --- |
| 1 Component visual parity | PASS | `p1-final.json` (from `p1-final-9bed856.json`): 115 states, 2760/2760 raw-declaration comparisons (8 profiles x 345, rest/hover/active), 2760 captures, 2760 side/raw diff pairs (`pixel-diffs.json`, 0 errors), 0 evidence errors. 132 REAL-DEMO and 2628 labelled pinned-MIT rows; 2736 painted, 24 empty non-painted. No normalization, tolerance change or mask. 1232 browser mutation probes rejected, 0 failures. |
| 2 Screen comparison | PASS | Fresh full run: 37 surfaces, 296/296 before/after frames with asserted scrolled ends, 148 Demo / before / after rows, 12 Demo contexts (`g2-complete.json`). |
| 3 Keyboard/ARIA | PASS | 27/27 trusted-key checks per surface (site, local); `keyboard-activedescendant.json`: 48 Combobox/MultiSelect `aria-activedescendant` records, each equal to the one painted active option. 856/856 painted-focus checks. PR-6 real-page runtime 36/36; production `/__gallery.html` 404. |
| 4 R1-R7 structure | PASS | 8/8 profile structure checks; G2 real hosted embeds unchanged and passing. |
| 5 Tests and builds | PASS, known local exception | Site 551/551 and build; local typecheck and build; local 997/998, the unchanged `/tmp/h` ENOTDIR in `cli-init.test.mjs`. |
| 6 License/release safety | PASS | `release-9bed856/release.json`: 47 production artifacts, 176 npm-pack files incl. NOTICE, no gallery/QA modules. |
| 7 Deployment | Not deployed | Deploy gated on owner. No production deploy, no merge, no preview for this head. |

Merged-validator regressions at `9bed856`: PR-7 full style 84/84, non-ready 252/252, interaction 264/264, disabled outline 8 cases / 240 comparisons, 0 failures; PR-5 paint 520 cases, 40,860 assertions, 0 failures, 21,372 rejected mutations, `bootstrap: false`.

Findings closed:

- G1-TOAST-LOADING: the loading Toast keeps its action like the pinned Sonner toast, and the action is in the fixed Toast inventory for every variant, loading included.
- G1-PAINT-CHILD: Textarea, Combobox, MultiSelect, TimePeriodSelect and DateRangeInput inventories now name the inner native control (input/select/textarea), the value or placeholder text run, the select badge, the chevron glyph, the second KST field and the native date internals. For each control the gate compares shown, visibility, rendered, pointer events, effective opacity and text paint; the select overlay must stay transparent while the source trigger paints. 129 probes over every closed state hide, blank or expose a part and must fail the inventory itself (not only the separate native contract). A product difference surfaced: the pinned preflight zeroes native date edit-field insets and sets the value box and picker indicator; the date fields now carry the same declarations.
- G1-STATE-COVERAGE: open Combobox and MultiSelect (surface, list, active, selected, disabled and rest rows, marks), the range error (both fields invalid, alert) and structured Markdown (headings, lists, nested list, emphasis, two code blocks) are comparison targets. Structured Markdown is REAL-DEMO at both widths and themes; the other three are pinned MIT under the standing rule, with the routes below. Demo live captures now re-pin and assert width and pixel density per state.

## Rebased strict revalidation (superseded by the section above)

Rebased onto merged PR-7 `03e76038`. Product head for every gate below: `0a37221`.

| Gate | Result | Evidence |
| --- | --- | --- |
| 1 Component visual parity | PASS | `p1-strict-final.json` / `p1-final.json`: 111 states, 2664/2664 raw-declaration comparisons (8 profiles x 333; rest/hover/active), 2664 captures, 2664 side/raw diff pairs, 0 evidence errors; 108 REAL-DEMO and 2556 labelled pinned-MIT rows; 2640 painted, 24 empty non-painted. No RGBA8 normalization remains. |
| 2 Screen comparison | PASS | 37 real surfaces, 296/296 before/after frames, each with an asserted scrolled end; 148 Demo / before / after rows; 12 Demo contexts (`g2-complete.json`, `surface-review.html`). |
| 3 Keyboard/ARIA | PASS | 27/27 trusted-key checks per surface (site, local); 360 painted-focus positives and 368 rejected negatives; 200/200 browser mutations; PR-6 real-page runtime 36/36; production `/__gallery.html` 404. |
| 4 R1-R7 structure | PASS | 8/8 profile structure checks; real hosted embeds assert four tabs, one source, mounted panel, no standalone palette. |
| 5 Tests and builds | PASS, known local exception | Site 546/546 and build; local typecheck and build; local 997/998, the unchanged `/tmp/h` ENOTDIR in `cli-init.test.mjs:159`. |
| 6 License/release safety | PASS | `release-strict/release.json`: 47 production artifacts, 176 npm-pack files incl. NOTICE, no gallery/QA modules. |
| 7 Deployment | Not deployed | Deploy gated on owner. No production deploy, no merge, no new preview for this head. |

Merged-validator regressions at the same head:

- PR-7 certification (isolated harness copy on port 5182, own evidence folder): full style 84/84, non-ready 252/252, interaction 264/264, disabled outline 8 cases / 240 comparisons, 0 failures.
- Preserved PR-5 paint validator: 520 cases, 40,860 assertions, 0 failures, 21,372 rejected mutations, `bootstrap: false`.

Changes in this revalidation:

- Combobox/MultiSelect: ArrowUp/ArrowDown with no active option (pointer open or after filtering) start at the last/first enabled option. Trusted-key checks cover closed open-direction entry, Home/End, wrap both ways, disabled skipping and pointer/filter entry on both controls; a unit regression fails on the old code (activates Beta).
- G1 reads raw computed declarations. The scratch reference CSS is compiled with Lightning CSS 1.32.0, target Safari 15, outside the repository (see `REFERENCE-NORMALIZATION.md`). Three browser mutations per profile apply an oklab nudge that paints identical RGBA8 bytes; each is rejected at the root, a descendant and text paint (24/24).
- Raw comparison exposed oklch-vs-Lab serialization in four P1 inks. P1-scoped tokens now carry the Demo's exact Lab declarations (diff added, green Switch/Avatar, CodeBlock JSON number); shared tokens are unchanged, so PR-5/PR-7 paint is unchanged.
- Rebase conflicts: `analysis.tsx` keeps PR-7's Alert/Button/Select with PR-8's CodeBlock details and TimePeriodSelect; `focus-paint.mjs` keeps PR-7's `focusPaintOwner` with the radio ring and switch track added. The G2 driver now targets the merged refresh Button and Alert.

Held review observations at that head (closed at `9bed856`, see above): G1-PAINT-CHILD, G1-TOAST-LOADING and G1-STATE-COVERAGE.

## Historical gate verdicts (pre-rebase, superseded)

| Gate | Implementer result | Evidence |
| --- | --- | --- |
| 1 Component visual parity | PASS | 111 states, 888/888 strict comparisons, 888 captures and 888 side/raw pixel-diff pairs; zero evidence errors. 36 real-Demo primary rows and 852 labelled actual pinned-MIT rows. All original 79 states remain. |
| 2 Screen comparison | PASS; independent review pending | 37 real hosted/local/hosted-embed surfaces, 296 before/after frames plus 296 actual scrolled-end frames; 148 Demo / before / after review rows and 12 genuine Demo contexts. PNG dimensions, freshness, actual end offsets and component presence are asserted. |
| 3 Keyboard/ARIA | PASS | 14 trusted-key checks, 360 positive painted-focus checks plus 360 rejected missing-ring controls, 88 mutation/safety checks, and unchanged real-page runtime 36/36. Development gallery has its own origin; production gallery returns 404. |
| 4 R1-R7 structure | PASS | 28 real-page structure profiles in `final-runtime/runtime/runtime.json`; all 296 surface rows check viewport, overflow and SVG namespaces. Real embeds assert four actual tabs, one selected source, mounted panel and no standalone palette. |
| 5 Tests and builds | PASS with existing local exception | Site 489/489 and production build; local typecheck/build pass. Local suite 986/987: pre-existing immutable-baseline /tmp/h ENOTDIR only. Final-head clean CI is authoritative and recorded separately. |
| 6 License/release safety | PASS | `release-final/release.json`: matching root/site/local NOTICE, NOTICE in npm pack; 52 production artifacts and 181 package files exclude gallery/QA modules. |
| 7 Deployment | PASS, preview only | Not deployed; deploy gated on owner. Only the `uxb-pr-8` Pages preview is authorized; exact head/URL/QA receipt is `preview.json`. No production deployment or merge. |

The draft is not independently approved or merge-ready. Lane-lead review and reconciliation after PR-7 (#106) merges remain separate. No PR-7/PR-9 worktree was modified.

## Original 152 failures: preserved and resolved

`p1-baseline-632.json` preserves the original 632 comparisons with 152 strict failures. `failure-classification.json` enumerates every component/state/surface/viewport/theme and original field difference: Textarea 8, Combobox 32, MultiSelect 24, MarkdownViewer 24, CodeBlock 24, DiffViewer 16, DateRangeInput 16 and TimePeriodSelect 8. All 152 had setup mismatches; 124 also had real product differences. No mismatch is waived.

References now have equivalent props, content, closed-control anatomy and available widths. Product fixes include selection wrappers and states, native date typography, closed period indicator, copy toolbar/corner placement, escaped HTML flow, the actual empty-diff state and legacy viewer CSS leakage. Additional leaf-paint audit corrected Switch thumbs, Radio dots, Avatar fallback/image border tokens and loaded-image fallback removal. Spinner defaults inherit foreground, matching the actual omitted source variant; all eight sizes, three tones and both block/inline displays are covered (48 states).

Final real-screen review found standalone DateRangeFields missed the DateRangeInput wrapper's typography/inset rule: consent inherited generic 24px insets and 12px monospace, clipping the native time placeholder. The shared style is now attached to each date field's own marker, preserving the same 13px sans/12px insets both inside and outside DateRangeInput. Caller nesting, parsing, values and exact-millisecond fallback are unchanged; the actual backfill consumer asserts this style in all four profiles.

The style reader checks 27 independent fields, every edge border, root/SVG descendant paint, effective ancestor opacity, visibility and Switch/Radio/Avatar leaf style/relative geometry. Upstream geometry tolerance is unchanged; owner width/height policy is absolute to 0.01px. Raw pixel diffs have no masks or scaling. Transparent or zero-area shadows are normalized only when they paint nothing; nonzero shadow offsets remain failures.

## Actual Demo and permitted pinned-MIT references

Pinned MIT SHA: `69181812b87169df157841fce1314ec96ecd2c5a`.
`mit-entry.tsx`, `build-mit.mjs` and `mit-provenance.json` prove actual source components in an isolated 3,356-input reference build with no enterprise paths. React/Radix/Sonner reference dependencies remain outside the Preact products. Sonner 2.0.7 and original retained IBM Plex Mono bytes have recorded provenance; NOTICE is shipped. No reference renderer is shipped.

Checked read-only routes under `https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646`:

- A: root dashboard, settled tables, period/date popover and Select from calendar.
- B: `/traces`, public model-cost question and its read-only Formatted detail.
- C: `/prompts/answer%20question`, enabled read-only Compare with selected prompt.
- D: root dashboard popups opened read-only and closed with Escape (no selection): `Env` filter is `features/filters/components/MultiSelect.tsx` (cmdk, `Select All` and `Clear filters` as items), the model popover is `MultiSelectTagInput`, the period control is a date dialog. None is the pinned `SelectInput`/`MultiSelectInput`.
- E: `/traces` filter sidebar and its `Add filter` popover (opened read-only, closed with Escape). The pinned inputs appear only in `KeyValueFilterBuilder` after choosing a facet in `Add filter`, which edits the view's filters; experiment filter blocks render only for an added filter. Every other consumer at the pinned SHA (`SettingsTable`, `Form`, API-key expiry, annotation queues, dataset mapping, blob storage, Mixpanel, PagerDuty, monitors, AI gateway) is a settings or create/edit surface, which the contract forbids.
- The range error needs an invalid apply (an induced error), so it is not reproduced on the Demo.

Every fresh Demo screenshot hides and asserts the account footer. `demo-context.json` contains 12 genuine full-page contexts. `demo-records-matched.json` refreshes actual period paint at both widths/themes. `demo-records-extra.json` reconciles actual mobile navigation Avatar image and Home Spinner in both themes. No account menu was opened and no name/email/image URL was retained. Only exact read-only dashboard GET requests were held to capture loading, then continued; no induced error or write. The actual Spinner signature is Loader2 / size-5 / block with omitted variant, so `md-inherit`, not explicit primary.

The inspected routes do not expose equivalent whole-family Textarea/Radio/Toast states; the explicit Toast amendment permits actual pinned-MIT reference. Other unavailable individual states use actual equivalent MIT props, not unrelated live widgets. The legacy genuine Switch signature was reconciled and not reused for unrelated variants. Caller-owned Avatar image pixels and Skillar labels/data remain explicit adaptations. Native KST fields/popups, native select behavior, 32px mouse/44px coarse targets and visible keyboard focus follow the owner policy. See external `REFERENCE-NORMALIZATION.md` for the exact setup and deviations.

### Every component/state reference

Each state has eight required site/local x width/theme comparisons. A/B/C above and F (the full route list in the reference-eligibility follow-up) are the checked routes; this is not a claim of global Demo unreachability. REAL-DEMO is primary where an equivalent state is observed.

| Component | State | Checked routes | Reference rows out of 8 |
| --- | --- | --- | --- |
| Textarea | `default` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Textarea | `empty` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Textarea | `disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Textarea | `error` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Textarea | `code` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Combobox | `default` | F | 8 REAL-DEMO (`demo-records-closed.json`) |
| Combobox | `disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Combobox | `error` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Combobox | `empty` | F | 8 REAL-DEMO (`demo-records-closed.json`) |
| MultiSelect | `selected` | F | 8 REAL-DEMO (`demo-records-closed.json`) |
| MultiSelect | `empty` | F | 8 REAL-DEMO (`demo-records-closed.json`) |
| MultiSelect | `disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `default-default-unchecked-enabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `default-default-unchecked-disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `default-default-checked-enabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `default-default-checked-disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `default-green-unchecked-enabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `default-green-unchecked-disabled` | F | 8 REAL-DEMO (`demo-records-closed.json`) |
| Switch | `default-green-checked-enabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `default-green-checked-disabled` | F | 8 REAL-DEMO (`demo-records-closed.json`) |
| Switch | `sm-default-unchecked-enabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `sm-default-unchecked-disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `sm-default-checked-enabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `sm-default-checked-disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `sm-green-unchecked-enabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `sm-green-unchecked-disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `sm-green-checked-enabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Switch | `sm-green-checked-disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Radio | `unchecked-enabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Radio | `unchecked-disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Radio | `checked-enabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Radio | `checked-disabled` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Radio | `group` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xxs-primary` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xxs-primary-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xxs-muted` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xxs-muted-inline` | F | 8 REAL-DEMO (`demo-records-closed.json`) |
| Spinner | `xxs-inherit` | F | 8 REAL-DEMO (`demo-records-closed.json`) |
| Spinner | `xxs-inherit-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xs-primary` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xs-primary-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xs-muted` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xs-muted-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xs-inherit` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xs-inherit-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `sm-primary` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `sm-primary-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `sm-muted` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `sm-muted-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `sm-inherit` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `sm-inherit-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `md-primary` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `md-primary-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `md-muted` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `md-muted-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `md-inherit` | A, B, C | 8 REAL-DEMO |
| Spinner | `md-inherit-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `lg-primary` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `lg-primary-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `lg-muted` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `lg-muted-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `lg-inherit` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `lg-inherit-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xl-primary` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xl-primary-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xl-muted` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xl-muted-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xl-inherit` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xl-inherit-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xxl-primary` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xxl-primary-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xxl-muted` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xxl-muted-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xxl-inherit` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `xxl-inherit-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `full-primary` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `full-primary-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `full-muted` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `full-muted-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `full-inherit` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Spinner | `full-inherit-inline` | A, B, C, F | 8 ACTUAL-PINNED-MIT |
| Toast | `default` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Toast | `success` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Toast | `info` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Toast | `warning` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Toast | `error` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Toast | `loading` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `sm-circle-muted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `sm-circle-tinted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `sm-rounded-muted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `sm-rounded-tinted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `md-circle-muted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `md-circle-tinted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `md-rounded-muted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `md-rounded-tinted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `lg-circle-muted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `lg-circle-tinted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `lg-rounded-muted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `lg-rounded-tinted` | A, B, C | 8 ACTUAL-PINNED-MIT |
| Avatar | `image` | A, B, C | 8 REAL-DEMO |
| MarkdownViewer | `formatted` | A, B, C | 4 REAL-DEMO / 4 ACTUAL-PINNED-MIT |
| MarkdownViewer | `empty` | A, B, C | 8 ACTUAL-PINNED-MIT |
| MarkdownViewer | `literal-html` | A, B, C | 8 ACTUAL-PINNED-MIT |
| MarkdownViewer | `structured` (headings, lists, nested list, emphasis, code blocks) | B (trace peek `4c869ec4f5478358`) | 8 REAL-DEMO (1440 and 390, both themes) |
| Combobox | `open` (surface, active, selected, disabled, rest rows, radio marks) | A, B, C, D, E | 8 ACTUAL-PINNED-MIT (pinned `SelectInput`) |
| MultiSelect | `open` (surface, select-all, active, selected, disabled, rest rows, checkboxes) | A, B, C, D, E | 8 ACTUAL-PINNED-MIT (pinned `MultiSelectInput`) |
| DateRangeInput | `error` (both fields invalid, alert text) | A, B, C | 8 ACTUAL-PINNED-MIT (pinned `FormField` + `Input`) |
| CodeBlock | `default` | A, B, C | 4 REAL-DEMO / 4 ACTUAL-PINNED-MIT |
| CodeBlock | `read-only` | A, B, C | 8 ACTUAL-PINNED-MIT |
| CodeBlock | `empty` | A, B, C | 8 ACTUAL-PINNED-MIT |
| DiffViewer | `changed` | A, B, C | 4 REAL-DEMO / 4 ACTUAL-PINNED-MIT |
| DiffViewer | `empty` | A, B, C | 8 ACTUAL-PINNED-MIT |
| DateRangeInput | `default` | A, B, C | 8 ACTUAL-PINNED-MIT |
| DateRangeInput | `disabled` | A, B, C | 8 ACTUAL-PINNED-MIT |
| TimePeriodSelect | `default` | A, B, C | 8 REAL-DEMO |

## Real-screen evidence and API boundaries

`surface-review.html` is the complete 148-row genuine Demo / before / after reviewer index; it links original-resolution top/end screenshots and labelled atomic comparisons. `G2-MATRIX.md` lists every row and deviation. Before uses an immutable git archive of b8b1d62; its primitive blob matches Git. Both real production builds receive the same deterministic API fixtures, with loopback hostname differences labelled. Demo and Skillar domain/data differ; there is no whole-page same-data pixel-parity claim.

The matrix includes document formatted/raw/editor, comparison, real YAML publisher, workflow/evaluation textareas, consent mode/backfill inputs, device-grant shell commands, copy Toast, account Avatar, every actual standalone analysis tab, all four actual embedded tabs, trace attributes/tool arguments, and technical error details after real refresh failures. Versions/connections/trace previews remain additional regression contexts. The phone account drawer is opened by its real button so Avatar is visible; normal closed account pages remain covered by runtime. End captures scroll the actual visible main/inspector containers and assert their offsets, not a nonexistent selector. The retained baseline and product both have blank trailing main-scroll space on command forms and some embedded routes, and tall mobile version rows. Those existing layout issues are recorded, not repaired outside this PR.

Mock-only grant creation/download controls and consent selections never issue real grants, download files or save consent. Existing API/auth/consent semantics and exact-millisecond text fallback remain unchanged. Markdown/Prism output is escaped Preact text; raw HTML remains inert, automatic highlighting is disabled and no React/Radix/cmdk runtime enters production.

## Verification commands and remaining scope

- `cd site && npm test && npm run build`: 489 tests and build pass.
- `cd local && npm run typecheck` and `npm run build`: pass.
- `cd local && npm test`: 986/987; unchanged `test/cli-init.test.mjs:159` fails with `ENOTDIR: /tmp/h/Library/LaunchAgents/dev.skillar.daemon.plist`, reproduced on immutable baseline. Neither test nor /tmp/h was modified.
- Control/style regressions are included in the full site run. Standalone DateRangeFields retain their machine-consumed style hook outside DateRangeInput and preserve exact text fallbacks; real consumer checks assert 13px type and 12px horizontal insets. Previously run sync-performance 1/1 and changed trace regressions 15/15 are retained, not rerun as new evidence.
- `p1-runtime.mjs` runs the unchanged PR-6 36-check driver with only out/base/file-URL import configuration, and a separate development gallery. Template SHA256: `834ea84a1823e2f40d63c835d5fa8cc147a614b932d8b69d9284f08c0181967f`.
- TSX LSP diagnostics are clean; MJS TypeScript initialization and CSS Biome tooling are unavailable. Actual compilers, script syntax checks and CI are the executed evidence.

Independent review belongs to the lane lead; no reviewer approval is claimed. Preview authentication, forced-colors, a full contrast/motion audit and real grant/consent writes remain unverified. No production deployment or merge is authorized.
