# Account preview QA

Current preview: https://deployment-3.example.test.
Initial account preview, before the skip correction:
https://deployment-4.example.test.
Screen-only: no authentication, account, provisioned endpoint or activity data.
`skillar.sh` remains unattached.

## Before and after provenance

The `before-*` PNGs are actual previous-deployment URLs at
https://deployment-2.example.test. `/login/`, `/connect/` and `/dashboard/`
all served the landing fallback then. They do not depict earlier account UIs.
The `after-*` images show the new route-specific production build at the same
390/1440 CSS widths and light/dark settings. They are viewport captures;
additional dashboard and copy-state images show content below the phone fold.

## Root-driven manual QA

| Scenario / action | Expected and observed | Verdict | Artifact |
| --- | --- | --- | --- |
| Landing account action -> login -> keyboard skip/Enter exploration | Real account-preview route, disabled GitHub skipped, setup reached without input | PASS | `after-login-390-light.png`; full lane `after/account/primitive-login-*` |
| Native pointer click on disabled GitHub | No navigation or account creation; URL/history unchanged | PASS | `after-login-1440-dark.png`; source `site/login/index.html` |
| Codex/Claude Code example selection | JSON versus documented HTTP CLI shape; reserved `.example` only | PASS | `after-connect-1440-light.png`, `copy-success-phone-dark.png` |
| Copy displayed example | Clipboard seam receives identical displayed bytes; explicit non-working feedback | PASS | `copy-success-phone-dark.png` |
| Denied/missing clipboard | Persistent manual-copy message and exact selectable text; bounded MutationObserver subscribed before missing-API activation | PASS | `copy-failure-phone-dark.png` |
| Four view links, back/forward and direct reentry | Correct one visible view/current link/title; hash retained | PASS local and deployed | `sessions-phone-dark.png`, `workspaces-phone-dark.png`, `flow-phone-dark.png`, `heatmap-phone-dark.png` |
| Invalid `%XX` hash | Sessions fallback with visible explanation, never blank | PASS | `site/src/account.ts`; root browser transcript |
| Theme navigation/reload; blocked storage | Theme persists after actual module load; blocked storage still applies page choice | PASS local and deployed | Paired light/dark images; lane `after/account/` |
| 320/390/768/1440 and 200% computed text at 390/1440 | No horizontal document overflow; all visible controls >=44x44, actions >=48 high | PASS | Full lane matrix; `web-ui-verification.md` |
| Seven surfaces, 390/1440/1920, light/dark and tails | 42 initial captures, 90 total; independent image inspection PASS | PASS | Full lane `after/account/`; independent audit `st_01a19a50` |
| JavaScript disabled | Login link/config remain; client selector disabled/copy hidden; all four dashboard sections visible with native anchors | PASS | Lane `nojs-login.png`, `nojs-connect.png`, `nojs-dashboard.png` |
| Forced colors and reduced motion | Focus/status/content visible; zero animations | PASS | Lane `forced-colors-connect.png` |
| Resource/storage/input boundary | Static same-origin resources only, no forms/inputs/auth/data requests; only theme persistence | PASS | Root real-browser resource inspection and full authored source |
| Production build | Strict tsc and Vite MPA build exit 0 | PASS | `site/package.json`, `site/vite.config.js`; build transcript |
| Production Lighthouse | 3 mobile + 3 desktop runs per four routes, all category scores 100, exit 0 | PASS | Lane `account-qa/lighthouse-{landing,login,connect,dashboard}/` |
| Static Pages direct routes | Four routes HTTP200 with distinct correct HTML and current built asset names; preview noindex | PASS | Live preview above |

## Gate-found keyboard regression

The first account gate (`st_01a19a5c`) rejected the increment: dashboard
`href="#main"` entered the view router, replacing Heatmap with Sessions and
announcing an invalid view. Earlier keyboard checks covered login exploration
and dashboard view links, not dashboard skip; their Q10 PASS was too broad.
Root reproduced the failure before changing source.

The dashboard skip now moves focus to a focusable main landmark without changing
the view hash. Native no-JavaScript skip remains an ordinary anchor. Real Enter
activation passed for all four views at390/1440 in light/dark (16 cases), plus
the hashless default. The selected view, current link, title and hash stay intact;
no error is announced. Next Tab reaches MCP setup. Ordinary view links, back,
direct reentry, genuinely malformed hashes and four no-JS sections were rechecked.
No fixed sleep, test suppression or new routing framework was added.

`before-skip-*` images reproduce the actual previous deployed failure;
`after-skip-*` show the corrected focus navigation. The new 16-state delta matrix
is in lane `after/account-skip-fix/`. Earlier 90-image resting/geometry evidence
remains valid for unchanged layout, not evidence that the old skip worked.
Affected dashboard production Lighthouse was rerun separately under
`account-qa/lighthouse-dashboard-skip-fix/`: all four categories100 in all six
mobile/desktop runs, exit0. The corrected live preview also preserves default
and Heatmap skip state with focus on main, then ordinary Workspaces navigation.

The initial remote automation changed selects before deferred modules were ready.
That observation was not counted as a persistence/config pass. Repeating after
the actual load event and enabled-client-selector signal confirmed dark theme
storage/navigation and the Claude Code command. No timing sleep was used.

All direct text/background computed contrast ratios across seven surfaces and
both themes exceed 4.5:1; minimum 5.37 light and 7.87 dark. This is not a complete
screen-reader/WCAG certification. Lighthouse advisory image/render-blocking
opportunities remain, and Pages previews intentionally send `noindex`.

No existing site unit/lint/security command is configured. LSP/Biome are
unavailable in this agent workspace; strict compiler output is the type evidence.
The installed optional no-excuse checker requires TypeScript 7 unstable subpaths,
whereas this repository pins 5.9.3; it was not run or worked around by upgrading.
The source was directly checked for assertions, `any`, suppression, broad catches,
debug output, dead code and speculative layers: none added.

## Remaining delivery gates

Current-head CI, public PR image readback, independent gate and merge must be
read live before completion. Their receipts belong to the lane evidence ledger
and final JSON/Markdown, not an assumed green state in this pre-merge document.
All 20 original gaps, 14 QA conditions, 63 HIG applicability IDs and six ideal
states are reconciled in
[`web-ui-verification.md`](../../design/web-ui-verification.md).
