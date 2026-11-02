# Skillar web UI audit

Status: implementation and local verification complete. The original gap/checklist
tables below preserve the pre-implementation baseline. Current dispositions and
evidence are in [`web-ui-verification.md`](web-ui-verification.md); its delivery
section distinguishes verified local behavior from remaining PR/merge checks.
Scope: `site/` only. The local dashboard is read-only product context.
Contract: `site/DESIGN.md` (extended for the account preview before any screen code).
Plan: approved work plan `skillar-web-ui` (Todos 1 to 6, F1, F2).

## 1. What's being built

A screen-only account preview, with no authentication, credentials, backend, account data or invented metrics:

- `/login/`: a GitHub sign-in button that is genuinely disabled, with its reason beside it, and a separately named, enabled "Explore the account preview" link. No email, password, token or endpoint fields.
- `/connect/`: a fixed, copyable MCP configuration that uses a reserved `.example` hostname. It's labeled as a non-working example before the copy action, and the status stays "Not connected (preview)".
- `/dashboard/`: four EMPTY views named Sessions, Workspaces, Flow and Heatmap, in that order, matching `local/dashboard/main.tsx:110-115`. Each view explains what would appear there and why it's empty now.
- `/`: the landing page keeps its workshop identity and gains an honest route into the preview.

The existing vanilla TypeScript and Vite stack stays. No framework, package manager or brand change.

## 2. Sources and coverage

Full manifest: [`research/manifest.md`](research/manifest.md). Full reports: [`research/hig-report.md`](research/hig-report.md) and [`research/frontend-audit.md`](research/frontend-audit.md).

| Corpus | Read | Limits |
| --- | --- | --- |
| Apple HIG | 158 of 160 slugs read in full; 2 returned 404 (`links`, `tooltips`) | No images, video or inline cross-reference text. This is complete text coverage, not a claim that every demonstration was watched. |
| Local frontend references | 172 files plus `SKILL.md`, all in full | Model-assisted per-file reading, with decision-critical quotes checked against source |
| Impeccable | 49 documents at a pinned tree, all in full | Generated provider copies and engine code not audited |
| Product source | 11 `site/` files plus root `README.md` in full; local dashboard taxonomy slices | Artwork not visually reviewed |
| Baseline captures | 390 px and 1440 px, light and dark | Kept in the lane evidence store, not committed; phone full-page capture clipped at 16,383 px |

The research didn't run a browser, build, screen reader or Lighthouse. Those belong to Todos 3 and 6.

## 3. Universal principles adopted

Value before identity. Accurate availability before action. A clear way out. One primary action per view. Progressive disclosure. Visible system status. Controls that do what their names say. Empty states that explain themselves and offer a next step. No data without provenance. Source order that matches visual and keyboard order. No functions hidden on phones. System appearance by default, with the existing explicit override. Reduced motion respected. Descriptive links. Minimal collection, which here means none.

The web contract is stricter than the platform minimums: every interactive target is at least 44 by 44 CSS px, all text (body, labels, buttons, notes, code, bold and large text) is at least 4.5:1, and text survives 200% enlargement. Apple pt values, materials, brand assets and native control metrics aren't copied.

## 4. Personas and ideal journey

| Persona | Goal | Ideal path | What must not happen | Ideal state |
| --- | --- | --- | --- | --- |
| New developer | Understand and use portable agent instructions | Read what a skill file and MCP are, install locally | Assumed MCP knowledge, a primary action that dead-ends | IS1 |
| Returning local operator | Recognize the planned remote experience | Landing, login preview, setup, familiar four-view shell | Any claim that local sessions have been uploaded | IS3, IS4 |
| Hosted evaluator | Inspect the future account flow | Explore without giving any personal data | Fake authentication or a fake connection | IS2 |
| Team self-hoster | Keep control of infrastructure | Hosting comparison and registry docs | Implying an account is needed for local tooling | IS1 |
| Keyboard or low-vision user | Finish the same tasks | Skip link, navigate, copy, go back, exit | Lost focus, small targets, color-only status | IS5 |
| Phone user | See the same journey on a narrow screen | Same routes and functions in reading order | Overflow, hidden navigation, clipped examples | IS5 |
| Reviewer | Reproduce every claim | Screenshots, audit, CI and live readbacks | Proof that can't be traced | IS6 |

Ideal journey: landing, then "Explore the account preview" (or `/login/`), then the explore link, then `/connect/` with the example config copied, then each of the four dashboard views, then back to setup, then out to the landing page. Reload and the browser back button keep the person where they were at every step.

## 5. Gap ledger

Severity describes impact on the requested journey. It doesn't claim every earlier design choice is broken. "Todo" refers to the approved plan.

| ID | Sev | Evidence and affected user | Required fix | Binary verification | Todo | IS |
| --- | --- | --- | --- | --- | --- | --- |
| G01 | Major | `site/index.html:41` hero "Get your skill server" scrolls to a disabled form (`:138-142`); frontend F1 | Primary action is the working local path; hosted exploration labeled as a preview | Each CTA's destination does what its label says | 2 | IS1 |
| G02 | Major | No login entry point in site source | Method-named sign-in screen, disabled, with the reason beside it | Direct and landing navigation resolve; zero auth requests | 4 | IS2 |
| G03 | Major | No account MCP explanation exists | Setup preview with a fixed `.example` config and no secret field | Status stays not connected; zero requests to the example host | 5 | IS3 |
| G04 | Major | No remote dashboard preview exists | Four empty views: Sessions, Workspaces, Flow, Heatmap | All four links resolve with the right current state | 5 | IS4 |
| G05 | Major | Root README says local telemetry isn't uploaded; a remote shell could contradict it | Separate current local behavior from undecided future hosted capture | No text implies local activity syncs today | 2, 5 | IS1, IS4 |
| G06 | Medium | Hero mentions agent skills without defining skill or MCP | Plain definitions near first use | A new visitor can name the file, the transport and what's available now | 2 | IS1 |
| G07 | Medium | Disabled email form fills the main conversion area | Replace it with an explanation of the future flow | No email or password input, no misleading submit | 2 | IS1 |
| G08 | Medium | Theme control only in the long-page footer | Labeled theme control near navigation, one source of state | Change near nav; reload and next route keep the choice | 2, 4 | IS5 |
| G09 | Medium | Site excluded from runtime workflow paths; PR40 has no checks | Scoped site production build CI | CI clean on both PRs | 3 | IS6 |
| G10 | Medium | PR40 body has no embedded before/after images | Paired screenshots and a checklist readable on GitHub | Every PR image URL returns image bytes | 3, 6 | IS6 |
| G11 | Medium | New routes have no keyboard or reflow proof | Shared primitives with source-order nav, skip link, focus, contrast | Full keyboard path; no overflow at 390 px or 200% text | 4, 5, 6 | IS5 |
| G12 | Medium | Preview could invent login or session state | No credentials, cookies, data APIs, loaders or false success; explicit exit | Request and storage log shows only static assets and the theme key | 4, 5, 6 | IS2, IS3 |
| G13 | Medium | Full-page phone capture hit the 16,383 px cap | Section and bottom viewport captures | Every section and state appears in an inspected valid PNG | 3, 6 | IS6 |
| G14 | Medium | Static hosting of new routes unproven | Vite multi-page inputs, live Pages deep-link QA | `/login/`, `/connect/`, `/dashboard/` return the right content | 4, 6 | IS2, IS6 |
| G15 | Minor | Arrow glyphs decorate links (`index.html:26,41-42`) | Keep them hidden from assistive tech; status in words | Accessible names stay descriptive; status isn't glyph or color alone | 2, 4 | IS5 |
| G16 | Medium | New copy control could fail silently | Announced success and failure with a selectable fallback | Denied and normal clipboard both give clear feedback | 5 | IS3, IS5 |
| G17 | Medium | Hash-based dashboard views could lose context | Real links, current-view semantics, safe fallback for unknown hashes | Back and reload keep the view; an unknown hash recovers, no blank screen | 5 | IS4 |
| G18 | Medium | Frontend F2: hero install omits the gisool migration prerequisite (`README.md:21-26`) | Label it a fresh install and put the migration link beside it | Migration guide visible before copying | 2 | IS1 |
| G19 | Medium | Frontend F3: foreground note omits `skillar init --no-service` (`README.md:32`) | Show the foreground path as replacing background setup | Commands match the README; no hint of running both daemons | 2 | IS1 |
| G20 | Medium | Frontend F4: wordmark has a 32 px line box, no target padding (`style.css:28`) | Grow the hit area without changing type | Measured home-link rectangle is at least 44 by 44 CSS px | 2 | IS5 |

Coverage check: 20 gaps, each mapped to at least one implementation Todo and one ideal state. IS1 through IS6 each have at least one gap and, per the plan's success table, a delivering Todo and a proof item.

## 6. Precise QA conditions

These are the original frontend audit conditions (Q1 to Q14). Their current
results and explicit adaptations are recorded in `web-ui-verification.md`.

| ID | Condition |
| --- | --- |
| Q1 | Landing, login, connect and all four dashboard views each say "preview" visibly. No identity, account, connected or live state, provisioning result, rows or metrics. |
| Q2 | Pointer, Enter and Space on the GitHub button do nothing; the reason sits beside it. Zero OAuth or account requests, zero popups. The explore link works and never claims sign-in. |
| Q3 | Rendered DOM and source have no email, password, token, endpoint or hidden fields, and no handler stores such values. Only the theme key is stored. |
| Q4 | Shown and copied config match byte for byte, parse as JSON, and contain the one approved `.example` endpoint. "Example, not working" appears before the copy button. No request to that host; no "connected" change after copying. |
| Q5 | Subscribe to the status region before activating copy. Exercise success, denied permission and a missing clipboard API, waiting on the status change with a bounded timeout, never a fixed sleep. Success says the example was copied; failure offers manual selection. No uncaught exception. |
| Q6 | All four views reachable by keyboard and pointer. Exactly one link has `aria-current="page"`. Back, forward and direct reload land on the intended view on the deployed host. No tab roles on ordinary links. |
| Q7 | Each view has its own heading, says what data belongs there and why there's none. No charts, counts, timestamps, filters, spinners or create actions. Switching views creates nothing. |
| Q8 | Seven surfaces at 390, 1440 and 1920 px in light and dark: 42 resting captures, plus scrolled-end, focus and copy states. 320 and 768 px stress checks. Each capture records viewport, route, state, theme and source revision. |
| Q9 | At 320 px and at 400% zoom from 1280 px, no page-level horizontal scroll or hidden content. At 200% text, nothing lost. Long URLs wrap. No page-wide overflow hiding. |
| Q10 | Skip link works; one useful title and one `h1` per page; coherent landmarks; tab order matches reading order; focus visible in both themes and on code surfaces; route changes announce or move focus understandably; disabled controls don't trap focus. |
| Q11 | Measured targets at least 44 by 44 CSS px (48 px for the action primitive), including wordmark and view nav. All text at least 4.5:1 in rendered states, with no large-text exception. Focus and control boundaries at least 3:1. |
| Q12 | Theme choice survives navigation and reload; blocked storage doesn't break use. Reduced motion hides nothing. Forced colors keep controls visible. |
| Q13 | `cd site && npm run build` once after implementation; inspect production output; test routes on the real static host. No Lighthouse or performance claim from a dev server. |
| Q14 | F1 to F4 fixed; install and foreground commands match the README; local tooling and hosted preview stay distinct. |

## 7. HIG checklist applicability (all 63 items)

Item numbers match `research/hig-report.md` section 4. PENDING in this baseline
table means awaiting the later implementation, not a current unresolved failure.
The verification document accounts for all 63 IDs. N/A reasons remain scope
facts, not passed tests.

| # | Item (short) | Applicability | Status |
| --- | --- | --- | --- |
| 1 | Registry browsable without login | N/A: no registry in this build | N/A |
| 2 | One accent CTA per viewport, 1440 and 390 | Applies to every route | PENDING |
| 3 | No metric, star, price or testimonial without data | Applies | PENDING |
| 4 | One scoped global search | N/A: no search in this build | N/A |
| 5 | MCP defined on first use | Applies (G06) | PENDING |
| 6 | Logo once, no splash | Applies | PENDING |
| 7 | No modal or alert on load | Applies | PENDING |
| 8 | Persistent visible field labels | N/A: login has no input fields | N/A |
| 9 | Masked, never-prefilled secret field | N/A: no secret field exists | N/A |
| 10 | Email validation, submit gating | N/A: no form | N/A |
| 11 | Field-adjacent error text | N/A: no fields | N/A |
| 12 | One sentence on why sign-in is needed | Applies to `/login/` | PENDING |
| 13 | Button names the method | Applies: "Sign in with GitHub" | PENDING |
| 14 | Visible note that login is a demo | Applies (inferred from transparency, not a literal HIG rule) | PENDING |
| 15 | Form completable with Tab and Enter | Adapted: login completable by keyboard via the explore link; no form | PENDING |
| 16 | Purpose sentence per scope | N/A: no scopes requested | N/A |
| 17 | Single-button pre-permission screen | N/A: setup is explanatory, not an OS pre-permission; it explains connecting in plain words | N/A |
| 18 | Determinate progress | N/A: no progress shown, no loading simulation | N/A |
| 19 | Cancel at every step | N/A: no dialog or multi-step form; the exit link covers escape | N/A |
| 20 | Dialog task title, no Cancel+Done+Back | N/A: no dialog | N/A |
| 21 | One dialog at a time | N/A: no dialog | N/A |
| 22 | Status uses icon or text, not color alone | Applies: "Not connected (preview)" in words | PENDING |
| 23 | Static error screen names a cause | N/A: no endpoint verification, no error state rendered | N/A |
| 24 | Endpoint and error text selectable | Applies to the example config | PENDING |
| 25 | Skeletons before panel data | N/A by decision: there's no data to load, so skeletons would imply a pending load (frontend Q7). The shell renders complete. | N/A |
| 26 | Empty panel has a sentence and next action | Applies to all four views (links to setup or local `skillar open`) | PENDING |
| 27 | Nav items not hidden or disabled when empty | Applies | PENDING |
| 28 | No chart without data | Applies | PENDING |
| 29 | Sidebar levels and compact form at 390 | Adapted: wrapping view nav, one level, same functions at 390 | PENDING |
| 30 | Header title not the app name, under 15 chars | Applies to dashboard view headings | PENDING |
| 31 | Last panel restored on reload | Applies: view lives in the URL; scroll restore is browser default | PENDING |
| 32 | Destructive action confirmation | N/A: no destructive actions | N/A |
| 33 | No nested same-direction scroll areas | Applies | PENDING |
| 34 | Text contrast 4.5:1, both themes | Applies | PENDING |
| 35 | Initial theme follows system | Applies; override stays | PENDING |
| 36 | Reduced motion: no slide, zoom, bounce, blur | Applies | PENDING |
| 37 | Targets at least 44 by 44 | Applies | PENDING |
| 38 | Hover, pressed, focus on custom controls | Applies | PENDING |
| 39 | Focus never moves without user action | Applies | PENDING |
| 40 | No body weight lighter than Regular | Applies | PENDING |
| 41 | 200% zoom without clipping | Applies | PENDING |
| 42 | Icon-only buttons named | Applies if any exist | PENDING |
| 43 | Nothing dismisses on a timer | Applies to copy feedback | PENDING |
| 44 | One glossary, consistent capitalization | Applies | PENDING |
| 45 | RTL mirroring | N/A: English only. Logical CSS properties are recorded as debt in DESIGN.md | N/A |
| 46 | No forced tour; short dismissible tips | Applies | PENDING |
| 47 | Descriptive link text | Applies | PENDING |
| 48 | Unique title, one `h1`, landmarks | Applies | PENDING |
| 49 | Live-region status, empty alt on decoration | Applies | PENDING |
| 50 | Body at least 16 px at 390; targets 44 px everywhere | Applies | PENDING |
| 51 | Same functions and nav order at every width | Applies | PENDING |
| 52 | Unavailable controls distinct and explained | Applies to GitHub sign-in | PENDING |
| 53 | Swipe or drag has a button equivalent | N/A: no gestures | N/A |
| 54 | AI involvement disclosed | Applies to any copy that mentions AI | PENDING |
| 55 | No badge, count, rating, gauge or chart without data | Applies | PENDING |
| 56 | Context menu rules | N/A: no menus | N/A |
| 57 | Text over imagery at 4.5:1 | Applies only if text overlaps artwork; current layout keeps them separate | PENDING |
| 58 | At most 6 tabs, noun labels | N/A: view nav uses links, not tabs. The four labels are nouns anyway | N/A |
| 59 | All text at least 4.5:1, no 3:1 exception | Applies | PENDING |
| 60 | Primary submit never silently disabled | Applies: GitHub button is disabled with visible reason text | PENDING |
| 61 | Placeholders use neutral shapes only | Applies: no placeholders at all | PENDING |
| 62 | No autoplay media | Applies | PENDING |
| 63 | Escape closes dialogs and menus | N/A: no dialogs or menus | N/A |

Tally: 63 rows, 43 PENDING and 20 N/A.

## 8. Frontend corpus applicability

F1 to F4 are the only source-backed findings and appear as G01, G18, G19 and G20. No WCAG failure or broad visual-slop verdict is claimed without rendered proof. Impeccable operate, clarify, onboard and layout guidance applies to the task screens; taste-skill is limited to landing work by its own terms. Rejected: page-wide overflow hiding, empty ornamental charts, branded glass, new fonts and React dependencies (`site/package.json` has no React). Generic "show value now" or "create your first item" advice doesn't license sign-in, sample data or create actions.

## 9. Strengths to keep

Repository workshop artwork, the asymmetric subject-led hero, restrained vermilion, the honest hosting comparison, the real `SKILL.md` excerpt, working install and setup commands, native FAQ disclosures, the semantic table, system type and zero third-party requests. No baseline horizontal overflow at 390 or 1440 px. Existing theme, copy and setup behavior is regression scope.

## 10. Conflict resolution

Accessibility and the brief outrank taste recipes. The existing DESIGN.md is extended, not replaced. Bundling the real local dashboard with fixtures was proposed and rejected: it couples builds and shows data. The HIG single-Continue pre-permission rule doesn't apply to explanatory setup. The HIG preference for system appearance means "default to system", not "remove the override". Skeletons (HIG 25) lose to honest emptiness (frontend Q7). Web contrast follows the stricter all-text 4.5:1 rule, not native pt tables.

## 11. Nonrequirements

No real auth, OAuth handshake, tokens, endpoint validation, loading simulation, telemetry, account deletion, checkout, registry search, dialogs, gestures or Apple styling. No charts, badges, counters, testimonials or samples that could read as real activity.

## 12. Disposition

All 20 G rows are OPEN and all 43 applicable HIG rows are PENDING. Closing them needs current-build artifact paths with PASS or a justified N/A, a persona walkthrough, a heuristic review, objective visual checks and one whole-change gate approval (plan Todo 6 and F1). This document holds no screenshots and no proof of implementation.
