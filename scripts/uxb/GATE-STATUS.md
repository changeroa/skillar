# PR-2 overlay gate ledger

PR: https://github.com/changeroa/skillar/pull/101 (draft; no merge or production deployment).
Base: origin/main 46bc344. This ledger supersedes the fce3b28 and 3ec35dd coverage claims.
Evidence root E: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-2/`.
Current authoritative evidence: E/followup. Older scratch artifacts are historical and excluded.
Final published SHA and exact-head CI receipts: E/followup/publication.json and final-head-ci.json.

| Gate | Status | Evidence and limits |
| --- | --- | --- |
| 1. Component visual parity | **PASS under the explicit Confirm and non-Confirm amendments** | 104 state/theme references: 74 actual hosted Demo, 30 labelled actual pinned MIT renders. Both apps: 208 comparisons, 72,008 assertions, 208 PASS, zero missing references or unexplained mismatches. E/followup/parity/{sources,products,comparisons,measured-validation}.json and approved-fallbacks.json. |
| 2. Screen comparison | Prior evidence retained | Original 12/12 closed-screen and 24/24 product-panel before/after cases remain E/screens and E/product-panels; not recaptured or claimed pixel-identical. Current changed overlay captures were visually inspected, including light/dark and mobile. |
| 3. Keyboard/ARIA and actual Peek sizing | PASS | Updated shared overlays: 384 assertions, 12/12 site/local cases at 390/1440/1920 in both themes, 144 captures, including empty-menu focus/status/insets and Escape restoration. E/followup/keyboard-amendment/results.json. Unchanged actual hosted Peek evidence: 729 assertions, 6/6 cases, 24 native dirty-draft confirm decisions, 32px mouse/44px touch. E/followup/real-peek/final/results.json. |
| 4. R1-R7 structure | Prior PASS retained | Unchanged PR-0 assertions: 8/8 production-page fixture cases; R4 N.A. in that probe. Actual Peek separately checks URL, focus and draft ownership. E/structure/qa-structure.json. This amendment changes no real-page structure. |
| 5. Build/tests | PASS except recorded pre-existing host failure | Site 368/368; both builds, local typecheck and package dry-run pass. Local 984/985: unchanged cli-init.test.mjs:159 fails ENOTDIR at existing host file /tmp/h. Neither host file nor failing test modified. E/checks.json and logs. Exact final-head CI is reported separately. |
| 6. Licensing | PASS | Three matching notices list actual pinned source modules. Built packages include NOTICE; reference React/Radix/Floating UI dependencies are external-only, not shipped. No product dependency or lockfile change. |
| 7. Deployment policy | PASS | No merge, production deployment, project mutation or account-setting change. Existing preview receipts belong to an older head, not this amendment. |

## Coverage: hosted Demo and actual MIT renders are distinct

Each reference is one state/theme, with separate site/local comparisons.

| Family | States | Hosted Demo | Actual pinned MIT render | Missing | App comparisons |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dialog | 11 | 10 | 12 | 0 | 44 |
| Confirm | 9 | 8 | 10 | 0 | 36 |
| Dropdown | 12 | 22 | 2 | 0 | 48 |
| Tooltip | 7 | 14 | 0 | 0 | 28 |
| Sheet/Peek | 13 | 20 | 6 | 0 | 52 |
| Total | 52 | 74 | 30 | 0 | 208 |

The 74 hosted Demo captures remain unchanged. Only the 10 previously approved Confirm
references and the exact 20 newly approved non-Confirm references use actual MIT renders.
There are zero remaining Gate 1 reference gaps; the 30 fallback references are still not hosted Demo.

Every available state checks every captured primitive part plus its actual focused element:
font family/size/line-height/weight/spacing, foreground/background, four border widths/colors/styles,
four corner radii, four paddings, shadow, opacity, outline fields, smoothing and geometry.
Missing mandatory fields fail. Closed, disabled and Sheet cases have no whole-case bypass.
Source measurements are retained separately from approved native replacements, never rewritten.
Native differences remain explicit: 32/44px targets, retained R1 control recipes, native top-layer
ownership, visible token focus and caller-owned content/geometry. The focused empty native menu
asserts its token 2px inset outline even though the actual source hides its outline.
Equivalent non-painted borders/outlines and color serialization are canonicalized.
Raw image diffs use zero tolerance and remain unmasked; this is not a zero-different-pixel claim.

## Read-only Demo route audit

P = `https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646`.
R14 means all of: P, P/dashboards, P/traces, P/sessions, P/users, P/alerts,
P/skills, P/prompts, P/playground, P/scores, P/evals, P/annotation-queues,
P/datasets and P/experiments. Full URLs and controller/permission observations are in
E/followup/demo-route-audit.json; every fallback record retains its checked routes and reason.
No account-settings route or final destructive confirmation was entered. No Demo errors,
writes or mutations were induced. The amendment's renderer/capture script visits localhost only.

## Provenance for every approved actual MIT fallback

Pinned SHA: `69181812b87169df157841fce1314ec96ecd2c5a`.
All rows below mean **actual pinned MIT component render, NOT HOSTED DEMO**, in both themes.
E/followup/approved-fallbacks.json records each separate state/theme's source label, URL,
reason, routes, screenshot, context image and provenance file.

Confirm references import actual ui/ConfirmDialog.tsx, legacy Dialog, Alert and LayerProvider.
E/followup/actual-mit-confirm/{entry.tsx,serve.mjs,provenance.json,sources.json}.

| Confirm state | Checked routes and unavailable read-only condition | Reference |
| --- | --- | --- |
| disabled | R14, especially P/evals: enabled intermediate Confirm exists, not a disabled-action dialog. | Actual MIT /?state=disabled&theme=light or dark |
| loading | R14, P/evals: busy state requires final mutation; never invoked. | Actual MIT /?state=loading&theme=light or dark |
| error | R14, P/evals: mutation failure is not read-only; never induced. | Actual MIT /?state=error&theme=light or dark |
| empty | R14, P/evals: actual caller always supplies a description. | Actual MIT /?state=empty&theme=light or dark |
| nested | R14, P/evals: controller opens from a row menu, not inside another modal. | Actual MIT /?state=nested&theme=light or dark |

Actual Demo P/evals still supplies open, cancel-focus, confirm-hover and closed (8 references).
Its intermediate controller was verified safe before opening; final Delete evaluators was never clicked.

The newest non-Confirm amendment authorizes exactly these 10 states, both themes:

| Family/state | Light reference | Dark reference | Checked routes and unavailable read-only condition |
| --- | --- | --- | --- |
| Dialog/default-open | Actual MIT PASS | Actual MIT PASS | R14, P/prompts/P/skills: available comparison/install variants are not the default 512px dialog. |
| Dialog/disabled-action | Actual MIT PASS | Actual MIT PASS | R14, P/prompts/P/skills: no safe disabled default-dialog action; write entry controls disabled. |
| Dialog/loading-action | Actual MIT PASS | Actual MIT PASS | R14, P/prompts/P/skills: no read-only loading action; no write initiated. |
| Dialog/error-body | Actual MIT PASS | Actual MIT PASS | R14, P/prompts/P/skills: no genuine default-dialog error body observed. |
| Dialog/empty-body | Actual MIT PASS | Actual MIT PASS | R14, P/prompts/P/skills: no genuine empty default-dialog body observed. |
| Dialog/nested-menu | Actual MIT PASS | Actual MIT PASS | R14, P/prompts/P/skills: no menu inside a safe default-dialog instance. |
| Dropdown/empty | Actual MIT PASS | Actual MIT PASS | R14, P/traces/P/sessions/P/prompts/P/skills: caller menus contain items, not zero items. |
| Sheet/peek-error | Actual MIT PASS | Actual MIT PASS | R14, P/traces/P/sessions: no genuine Peek error; none induced. |
| Sheet/sheet-loading | Actual MIT PASS | Actual MIT PASS | R14, P/traces/P/sessions: no genuine filter-Sheet loading state. |
| Sheet/sheet-error | Actual MIT PASS | Actual MIT PASS | R14, P/traces/P/sessions: no genuine filter-Sheet error state. |

These 20 references import actual legacy Dialog parts/Button, ControlledDropdownMenu,
TablePeekView, ObservabilityEntityDetailHeader, MobileFiltersSheet and Layer/Popover providers.
The original components and source CSS are unmodified; primitiveOverrides is empty.
The actual PopoverLayerProvider keeps the nested menu inside DialogContent's accessibility subtree.
E/followup/actual-mit-unreachable/{entry.tsx,serve.mjs,provenance.json,sources.json,README.md}
records source inputs, per-file SHA-256, stylesheet/bundle hashes and official Tailwind candidates.
Context captures visibly label the render as NOT HOSTED DEMO.

Documented external environment adapters supply only local router/table-controls state,
inert analytics and plain anchors. Optional UI branches not used by these fixtures throw
if rendered; they cannot silently substitute fake UI. Every rendered primitive comes from
actual pinned source. Caller loading/error text and comparison content are local inert props.
The earlier handwritten scratch renderer is excluded from every current comparison.

## Repairs and verification limits

Measured product repairs: isolate caller comparison sections from the gallery's section grid;
match default Dialog busy-action width/spinner; use content-width empty Dropdown with actual
inner padding, centered empty status and accessible role. The empty-menu keyboard regression
opens it with trusted input, checks focus/status/insets, and verifies Escape restoration.
Standalone R1 controls, existing actual Peek sizing/draft handlers, API/data/route/auth,
server/worker, product dependencies and lockfiles are unchanged in this amendment.

Runtime on 3ec35dd completed normally with success, as did both Site runs; no rerun was needed.
The apparent delay was the active scripts/verify.mjs step; logs were not published while running.
E/followup/runtime-diagnosis.md records timestamps and log endpoint results. The final commit
must have its own completed CI receipts rather than inherit that earlier result.

Current TSX diagnostics, typecheck and builds pass; CSS LSP was unavailable earlier.
The unchanged local host-only test failure is recorded above. Fresh independent approval,
full Lighthouse/contrast and forced-colors screenshot audits remain unclaimed. The lead's
reviewer re-checks against both amendments; no merge or production deployment is authorized.
