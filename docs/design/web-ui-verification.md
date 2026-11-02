# Web UI verification

Date: 2026-11-02. Scope: landing and screen-only account preview, not the real
local dashboard or a hosted service. Read alongside the original
[`web-ui-audit.md`](web-ui-audit.md) and
[`saas-ia-comparison.md`](saas-ia-comparison.md).

## Evidence and limits

The root agent drove isolated real Chrome against the production Vite build.
The site has no established unit, lint or browser-test command. No tests were
deleted, skipped or weakened; no prose-pinning test was added. Strict
`tsc --noEmit && vite build` passed. TypeScript LSP/Biome were unavailable in
the agent workspace; compiler evidence is used, not an invented diagnostics pass.

Local artifacts are retained at
`/Users/iyen/.dori/state/lane-results/skillar-web-ui/`:

- `after/landing-saas-ia/`: 68 section/tail and six header-inclusive captures.
- `after/account/`: 90 final route/viewport captures, plus six primitive captures
  at 390/820/1440, diagnostic renders, no-JavaScript and forced-colors states.
- `before/account/`: 12 real previous-deployment captures. Those old route URLs
  served the landing fallback; they were not existing login or dashboard screens.
- `account-qa/lighthouse-{landing,login,connect,dashboard}/`: three mobile and
  three desktop raw production reports per route, 24 runs total. All four
  category scores are 100. Advisory image/render-blocking opportunities remain.
- `landing-qa/`: original interaction/error/reflow logs and raw reports.

Independent visual audit `st_01a19a50` opened all 90 account-matrix PNGs: PASS,
no clipping, overlap, unreadable text or fabricated data. Desktop login tail
frames add no content beyond the footer already in the initial frame; they
are redundant capture evidence, not additional UI states. Landing images in
this matrix cover only the changed entry viewport; the earlier full-section
landing matrix supplies the remaining coverage.

These checks are not a complete manual WCAG or screen-reader certification.
Private reference-product screens remained auth-gated and are labeled honestly.
Authentication, endpoint provisioning and activity ingestion are intentionally
absent, not deferred UI implementation.

## Gap disposition: all 20

| Gap | Current result and evidence |
| --- | --- |
| G01 | PASS: landing primary action reaches the real `/login/` preview; separate local action reaches installation. New owner IA supersedes the original local-first recommendation. |
| G02 | PASS: focused login, native disabled GitHub method and adjacent explanation; separate enabled exploration path. |
| G03 | PASS: unassigned account endpoint and credentials are distinct from fixed `.example` configuration; no verification request. |
| G04 | PASS: four distinct empty views match the current local taxonomy. |
| G05 | PASS: local daemon upload is explicitly absent; future hosted capture remains undecided. |
| G06 | PASS: hero defines Markdown instructions and Model Context Protocol. |
| G07 | PASS: no email/password form; account value and explicit preview are visible. |
| G08 | PASS: labeled native theme select on every page; navigation/reload and blocked storage exercised. |
| G09 | PASS landing CI; account CI is a delivery prerequisite below. Scoped site workflow builds all MPA entries. |
| G10 | PASS landing public images; account paired images are included with the account PR. Public account image readback is a delivery prerequisite. |
| G11 | PASS: keyboard skip -> exploration, view focus/current semantics, target/reflow checks and both-theme captures. |
| G12 | PASS: no inputs/forms, auth handlers, data requests or account persistence; browser resource entries same-origin only. |
| G13 | PASS: viewport matrices with overlapping phone tails, not clipped full-page captures. |
| G14 | PASS local MPA build; deployed route readback is a delivery prerequisite below. |
| G15 | PASS: decorative action arrows are hidden from assistive technology; other links remain explicitly named in words. No icon-only action. |
| G16 | PASS: exact example copy, denied clipboard and missing API each produce persistent status and selectable fallback. |
| G17 | PASS: four hashes, one current link/visible view, useful titles, back/reentry and malformed-hash Sessions recovery. |
| G18 | PASS: fresh-install label and migration prerequisite beside copy. |
| G19 | PASS: foreground alternative includes `init --no-service` before `serve`, replacing background setup. |
| G20 | PASS: measured home links meet 44px; focused skip link measured 151.08 x 59.89px. |

## Precise QA conditions: all 14

| Condition | Result |
| --- | --- |
| Q1 | PASS: visible preview boundary throughout; no identity, fake data or connected/provisioned state. |
| Q2 | PASS: real pointer click on disabled sign-in leaves URL/history unchanged. Native disabled semantics exclude keyboard activation; Tab skips it and Enter follows exploration. No OAuth handler/popup exists. |
| Q3 | PASS: no credential/endpoint fields or form on any page. Only `skillar-theme` is written by source. |
| Q4 | PASS with explicit adaptation: Codex example parses as JSON with the reserved URL/scopes; Claude Code is a documented CLI command, not JSON. Copy preserves the displayed bytes. No request is made to `.example`. |
| Q5 | PASS: success, NotAllowedError and absent clipboard exercised. Missing-API check subscribed a bounded MutationObserver before clicking. Feedback has no dismissal timer. |
| Q6 | PASS local: four links, one current view, focus heading, back and direct reload. Deployed equivalents are checked during delivery. No ARIA tab roles. |
| Q7 | PASS: distinct explanations and next action for every empty view; no charts, counts, filters, timestamps or create simulation. |
| Q8 | PASS: seven surfaces x three widths x two themes = 42 initial captures, 90 including overlapping tails; focus, primitive and boundary states separately captured. |
| Q9 | PASS: no horizontal document overflow at 320/390/768/1440, including long config. 320 CSS pixels supplies the reflow equivalent of 1280px at 400% browser zoom; no claim of automated browser-chrome zoom. Doubled computed text reflows at 390/1440. |
| Q10 | PASS for exercised keyboard/DOM behavior: skip, titles, h1, native controls and hash heading focus. No screen-reader certification claimed. |
| Q11 | PASS: visible controls measured >=44x44 and actions >=48 high. Computed direct text/background ratios across seven surfaces, both themes: minimum 5.37 light / 7.87 dark; no <4.5 failures. Opaque neutral/code surfaces, no text over artwork. |
| Q12 | PASS: theme/reload, denied storage, forced colors and reduced motion checked; zero animations. |
| Q13 | PASS: strict production build and raw production Lighthouse. Static-host readback remains a delivery gate. |
| Q14 | PASS: preserved current migration, local/runtime/foreground commands and availability boundaries. |

## HIG applicability: all 63 IDs

Grouped rows share the stated evidence. Every ID is included once; original
scope-specific N/A reasons remain in the baseline audit.

| IDs | Disposition | Evidence / adaptation |
| --- | --- | --- |
| 1,4,8,9,10,11,16,17,18,19,20,21,23,25,32,45,53,56,58,63 | N/A | No registry/search/input/permission/dialog/progress/data loader/destructive action/RTL/gesture/menu/tab widget. No new hidden implementation assumed. |
| 2,3,6,7 | PASS | One accent action per task, no unsupported proof/price/data, no splash or load-time modal. Actual 390/1440 captures inspected. |
| 5,12,13,14,15 | PASS | Definition, account purpose, method-specific disabled sign-in and preview boundary; keyboard exploration path. |
| 22,24,26,27,28,29 | PASS/adapted | Text status, selectable config and errors, all empty views have a next step, nav wraps without disappearing, no fake chart. One-level wrapping links replace a sidebar. |
| 30 | Adapted | Concise noun view labels identify Sessions/Workspaces/Flow/Heatmap. The extracted “under 15 characters” header recommendation is not applied to explanatory empty-state sentences; semantic clarity wins over arbitrary truncation. |
| 31,33 | PASS | URL preserves view; document alone owns vertical scroll. |
| 34,35,36,37,38,39,40,41 | PASS | Contrast/targets/reflow measurements, system default and explicit theme, reduced motion/forced colors; native hover/focus/active styles; no focus movement on first load, user hash navigation focuses the view. Regular-or-heavier text. |
| 42 | N/A after inspection | No icon-only controls exist. |
| 43,44,46,47,48,49,50,51,52 | PASS/adapted | Persistent copy live region, consistent terms, optional exploration not a forced tour, named links, unique titles/h1/landmarks, 18px body with 15px secondary notes, same nav/functions, explained unavailable sign-in. |
| 54,55,57,59,60,61,62 | PASS/adapted | AI agents named without fabricated AI results; no fake badge/chart/count, no text over artwork, measured all-text contrast, disabled reason visible, no loaders/placeholders/autoplay. |

## Personas and ideal-state walkthrough

| User / ideal state | Observed path |
| --- | --- |
| New developer / IS1 | Definition -> current local versus planned hosting -> migration-aware local instructions. |
| Hosted evaluator / IS2 | Landing -> login -> explicit non-authenticating exploration; no personal input. |
| Integrator / IS3 | Unassigned endpoint/credentials -> client example -> copy feedback -> empty dashboard. |
| Returning local operator / IS4 | Four familiar names and distinct empty explanations, plus real local `skillar open` alternative; no implied upload. |
| Phone / keyboard / low-vision user / IS5 | Same wrapped navigation, measured targets, skip/focus path, text reflow and visible exits. |
| Reviewer / IS6 | Source comparison -> design contract -> committed paired images/QA -> strict build/raw Lighthouse -> independent gate -> live PR/deployment readbacks. |

## Delivery state

Landing PR40: merged `37eda19648d8cc0ec7f72b3f64648a76abd2edde` after gate
`st_01a19a41` APPROVE, three current-head checks and live preview/image readbacks.
Landing preview: https://deployment-2.example.test.

Account preview deployment: https://deployment-4.example.test.
Four direct routes returned HTTP200, correct distinct HTML and current built
asset names. Root drove landing -> login -> setup -> all four views, then
back/forward/direct reentry on this host; exact current view, theme persistence
and client switching passed after actual module-ready signals.
Current account PR, public image readback, CI, independent gate and merge remain
delivery gates at this document's creation; the lane result/ledger records their
final receipts. No custom domain is attached.
