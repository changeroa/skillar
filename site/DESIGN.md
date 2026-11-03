# skillar.sh

## P9 durable live connection increment

This supersedes P8's snapshot-only transport restriction, not its consent or
data-freshness rules. The embedded views reuse the existing connecting/live/
offline text and dot; no new color, animation or component is introduced.
Live means an authenticated update connection is available. It never claims
the device is running, the uploaded snapshot is current, or a report is complete.
Capture/receipt times, pending reports and stale results remain independently
visible. Background invalidations refresh REST-backed views without moving
focus, changing the selected source or resetting scroll.
The embedded connection dot stays static while idle; its text distinguishes
connecting, live and offline states. A failed background report refresh keeps
the last valid report and its disclosures visible with an inline error.

WebSocket is primary, SSE is the compatibility path, and reconnect/visibility
return replays durable changes. Expired cursors refresh the current snapshot.
Session expiry clears private activity and stops connections. MCP remains a
preview until P11; device upload still requires separate explicit consent.

## P8 connected dashboard increment

This section supersedes the dashboard-only preview restrictions below. Google
sign-in and the workshop visual system stay unchanged. MCP remains an explicitly
labeled preview until P11.

The hosted dashboard reuses the local Preact Sessions, Workspaces, Flow and
Heatmap views, including trace/workspace details, filters, reports and eval-case
creation. The site shell supplies account navigation, theme, source selection,
connection instructions and consent controls; there is one main landmark and
one document scroll owner. Keep the existing palette, system type, 44px targets,
48px actions and 4.5:1 minimum for every text size.

Signed-out people see a Google sign-in link, never activity. Signed-in people
start local-only. Device grant creation connects a device but does not grant
upload consent. Consent is a separate deliberate submission: show the seven
content categories, server-readable processing, default 30-day retention,
backup maximum 30 days, and optional historical snapshot identity/cut/range.
No checkbox is preselected to authorize content. Explain the private grant-file
CLI steps without exposing bearer credentials in URLs or persistent browser
storage. Consent withdrawal and device revocation have separate actions.

Source profiles state local-only, metadata-only, partial coverage, awaiting
runtime, ready or revoked. Unavailable content has an explanation and next
action, not fabricated zero counts. P8 displays snapshots, not live transport:
show source capture/receipt time, report revision, pending work and stale
results separately. Queued/running work uses plain status text; failure offers
an explicit retry. Offline, expired-session and logout states clear protected
content and explain recovery. Profile changes must not retain another profile's
results. Private activity and credentials never enter localStorage or caches;
only the existing theme preference persists.

Acceptance includes a keyboard-only user connecting a fixture device and making
an informed opt-in; a phone user switching all four views and opening details;
and a returning user distinguishing pending/stale data from empty data. Verify
light/dark at phone and desktop sizes, text zoom/reflow, visible focus, signed
out, consent, pending, failure, populated and empty states. No accessibility
debt is accepted by this increment.

### P8 embedded primitives

The source/device card, snapshot status list, text field and native choice row
reuse the workshop surface, square corners, ink focus ring and 48px actions.
Choice rows include both the checkbox/radio and its visible explanation.
Historical upload remains unchecked by default. Once explicitly enabled, offer
either all available history in that exact prepared snapshot or a custom local
date range; saved all-history consent preserves the exact full range.

The embedded views inherit background/surface/ink/accent. Additional light/dark
text tokens are ink-3 #5f615a/#a2a79a, accent-2 #8f2917/#ffb3a0, success
#176333/#5fd38a, warning #74430a/#e9b65c and error #9c2416/#ff8c7a. Derived ink
washes are 5%/10%, lines 14%/30%, and accent wash 14% light/20% dark. Embedded
type uses 18px titles, 16px body, 15px secondary and 14px captions; on phones,
body text is at least 17px. Existing chart metadata may use 13px but not controls.
Popover shadow is 0 4px 16px black at 18% light/50% dark. Feedback transitions
use 120ms ease-out; no decorative animation is added.

Embedded detail titles are h2 beneath the page h1. Heatmap date targets remain
44px with a chart-owned horizontal scroller instead of widening the document.
Inline help tooltips render above sticky navigation. Chart values also remain
available through keyboard focus and each cell's accessible label.
Changing an embedded activity route brings its content below the sticky tabs
and focuses the named activity region. Background refreshes retain scroll;
the standalone local dashboard keeps its existing navigation behavior.
Tooltips use measured viewport coordinates outside chart scroll clips, keep a
24px edge inset and 8px anchor gap, and disappear when their anchor leaves view.
Their fade is interruptible; reduced motion keeps the fade without translation.
Focused content controls clear the measured sticky toolbar.
Opaque consent identifiers wrap without truncating or changing their value.

## 0. Research log

- Product: root README, local CLI/MCP, server registry and Worker distribution. The local CLI ships today; managed provisioning, signup and pricing do not.
- Taste: [tasteskill v2](https://github.com/leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md). Adopt subject-derived composition, full-ink copy, large type, a working example, and no invented proof. The subject's actual `SKILL.md` becomes the page's central artifact.
- Spatial contract: StyleGallery `sg:layout/webpage-generation-workflow`, use-cases section and homepage recipe. One document scroll owner; hook, explain, prove, compare, convert. No nested vertical scrollers.
- Reference shortlist: Vercel, Warp, Claude. Vercel selected for precise developer typography and readable code; its brand colors and logo are not copied.
- Direction: the approved Prompt brand made literal. A static terminal command, a Markdown file and an MCP handoff explain how skills reach an agent. Vermilion belongs to the prompt and transfer arrow; paper, ink and system monospace carry the illustration. Hosted capability stays distinct from working local tooling.
- Hero revision: native HTML/CSS replaces the cropped workshop raster. No stock or generated raster art, invented metrics, customer marks or simulated hosted dashboard.
- Google sign-in increment (owner brief, supersedes the earlier no-backend rule): `GET /auth/google` starts a code + PKCE OIDC flow, `GET /auth/session` returns `{user:null}` or the stored profile as no-store JSON, same-origin `POST /auth/logout` ends the session and redirects to `/login/`, and the callback lands on `/login/`, `/login/?error=cancelled` or `/login/?error=failed`. Sign-in is real and stores a minimal profile; MCP endpoint provisioning and dashboard activity remain previews.
- Owner-authorized domain launch: `https://skillar.sh` is canonical. The exact production Pages alias remains usable with its own host-bound callback, signed cookies and logout Origin; branch previews remain unauthorized. Both hosts retain the same visual design.

## 1. Audience and argument

Developers using multiple coding agents need portable instructions. Hook: one place to serve skills. Explain: write, serve, connect. Prove: actual Markdown and MCP resource flow. Compare: local/self-host today versus hosted coming soon. The SaaS-informed revision leads with deployment choice and Google account sign-in, alongside the working local path. No marketing signup form; Google profile storage is disclosed beside sign-in.

Account routes: `/login/` is the account page. Signed out, it offers a working "Continue with Google" link to `/auth/google`, a privacy note naming exactly what is stored, and a separate "Explore without signing in" link. Signed in, it shows the stored profile (name, email, picture, first and latest sign-in), a sign-out form and the onward preview link. `/connect/` shows a fixed MCP configuration on a reserved `.example` host, labeled as a non-working example, and reports sign-in status in its status list. `/dashboard/` has four empty views: Sessions, Workspaces, Flow, Heatmap, in the local dashboard's order, with sign-in status in the connection help. Only `/auth/session` is read, only on these three routes; nothing provisions an endpoint, connects or records activity. The audit behind the preview increment is `docs/design/web-ui-audit.md`.

## 2. Color

Approved brand: round-1 **07 Prompt**, not round-2 Slab, with **Vermilion Refined**.
The chevron and optically spaced lettering are outlined vectors, with no runtime
font. Header wordmarks render at 120px wide inside the existing 44px minimum
home-link target. Theme selection switches both ink and chevron colors; the
chevron alone is the small-size mark. Keep at least one chevron height of clear
space (52/500 of the wordmark width) around the visible artwork. Minimum sizes
are 96px for the wordmark and 16px for the icon. Never stretch, recolor, or add a
shadow to the artwork.

Light: background #F5F4EF, surface #FFFFFF, ink #1F201D, muted #5F615B, accent #B4321C, on-accent #FFFFFF.
Dark: background #171916, surface #212420, ink #F0F1E9, muted #A9ABA2, accent #FF8F70, on-accent #1F0E09.
Code: background #F2F1EB / #0F100E, ink #1F201D / #E7E8E0,
muted #5F615B / #A9ABA2, syntax #B4321C / #FF8F70 (light / dark).
Semantic tokens: success #1F6F3C / #76D48C, warn #8A5300 / #F4BE55,
error #B0123F / #FF7E9A, border #878983 / #6E716A. Error is crimson,
distinct from the vermilion brand accent; status still requires a text label.
These values map directly to the approved palette, including light code fields.
The complete bilingual usage guide, ANSI mapping, chart ramps, and export sizes
ship with the brand source package.
Focus uses current ink; no status conveyed by color alone.

## 3. Typography

System sans (`Arial`, sans-serif), code (`ui-monospace`, monospace). No external requests or font shifts.
Hero 80px desktop / 44px phone, line height 1.02, tracking -0.055em.
Section 48px / 32px, line height 1.08, tracking -0.04em.
Subhead 24px, body 18px, notes/code 15px. Weights 400, 500, 600.

## 4. Layout and spacing

Base 4px; spacing 8, 12, 16, 24, 32, 48, 64, 96, 128.
Max width 1280px; symmetric 48px gutters desktop, 24px phone.
Hero text and illustration share an asymmetric 1.15/1 grid with zero-minimum tracks. The illustration keeps a 24px safe area, a maximum width of 576px and intrinsic height; no fixed-height crop, transforms, hidden overflow or cover fitting. Its file and MCP handoff remain readable at 360/390/768/1024/1440/1920px. Workflow is an ordered editorial list. Skill example is split text/code. Comparison is a real table. FAQ uses native details.
At 760px all splits stack. Navigation wraps rather than disappearing. The document owns vertical scrolling. Code wraps long text rather than widening the page.

## 5. Primitives and states

- Action: square, 48px minimum target, primary accent fill / secondary ink wash. Hover underline, active opacity, focus-visible 3px outline. A disabled CTA, if one returns, uses native disabled semantics with an adjacent explanation.
- Theme select: system/light/dark near the main navigation on every route, one shared state and storage key; visible label, native keyboard behavior. System is the default when nothing is saved. Source order always matches visual order.
- Code panel: theme-specific code field, readable tokens, filename header. Links use code-ink focus rings in both themes. Copy action reports success/failure through a live region.
- Disclosure: native summary, 48px minimum target; native triangle indicator, visible focus.
- Shell, cluster, split: reusable layout classes; paragraph measures provide content limiting and normal flow provides stacking. No bespoke per-section grids.
- Compatibility list: real agent names, not endorsement logos.
- Example switch: native select chooses an actual host configuration example; no invented remote URL.
- Wordmark: outlined 07 Prompt at 120px wide; its home link keeps a hit area of at least 44x44px. Light/dark exports follow the saved theme and system fallback without changing layout.
- Prompt illustration: noninteractive, informative `role="img"` with one accessible description; its internal terminal/file/agent labels are hidden from assistive technology to avoid duplicate narration. Uses only existing surface, code, ink, muted, border and accent tokens, 15px notes/mono, 24px command (18px below 1000px), and the 8/12/16/24/32px spacing scale. A neutral dotted field and inset file panel provide depth without shadows or new colors. No motion or network requests. The caption distinguishes local availability from planned hosted service.

### 5a. Account primitives

These use the tokens above. No new colors, fonts or radii.

- Availability notice: a bordered surface band at the top of every account route, before any action. Text in ink: "Google sign-in is live. MCP setup and the dashboard are still screen-only previews: no endpoint is assigned and no activity is recorded." Plus a link back to the landing page. It never collapses or dismisses.
- Account shell: same shell and gutters as the landing page. Header holds wordmark, a route nav (Account, Connect MCP, Dashboard) and the theme select. Nav wraps at narrow widths; it never hides. Each page has a unique title and one h1.
- Sign-in action: an accent-filled action link "Continue with Google" to `/auth/google`. A plain link, so it works without JavaScript; no popup, no script-driven redirect, no Google logo (same no-logo rule as the agent list). The privacy note sits directly after it and names what is stored: Google ID, email, name, picture, first and latest sign-in times; the session is a signed, secure cookie; Google tokens are not retained.
- Preview link: an action-styled link whose label names the outcome. Signed out it is the secondary "Explore without signing in"; signed in it is the primary "Preview MCP setup". One accent action per visible state.
- Session status line: a `.note` paragraph with `role="status"` under the lead. Text only: "Checking your account…", then "Not signed in." or a failure sentence; cleared when the signed-in card appears. Empty it has no height or margin but stays in the accessibility tree, so the change is announced.
- Callback message: a second status paragraph filled from `?error=`: "Sign-in was cancelled. Nothing was stored." or "Sign-in didn't complete. You can try again." Unknown codes get the second sentence; the query value itself is never rendered.
- Signed-in card: picture (48px square, `object-fit: contain` to preserve the complete source, `alt=""`, no-referrer, only for `https:` URLs, hidden on load error) beside "Signed in as", the name at subhead size and the email in muted small text (the email takes the name slot when Google sent no name). Below it a two-row status list for first and latest sign-in: `<time>` with an ISO `datetime` and locale-formatted text. The shared account schema validates the server response before rendering. Every value is set through `textContent`; never `innerHTML`.
- Sign-out form: a plain `<form method="post" action="/auth/logout">` with a secondary action button "Sign out", followed by a note that it ends the browser session and does not delete the stored profile. No fetch and no script, so the browser sends the same-origin `Origin` header the service requires.
- Account line: `data-account-line` text inside the connect status list and the dashboard connection help. Default "See the Account page for sign-in status." is true without JavaScript; the session check replaces it with "Checking your account…", "Signed in as {email}.", "Not signed in." or a sentence saying the status is unknown.
- Status line: text first, e.g. "Not connected — preview". A neutral square marker may precede it; color never carries the meaning. No green. "Signed in" appears only after `/auth/session` returned a user; "connected", "live" and "synced" stay banned for MCP and dashboard.
- Example config panel: the code panel with header "Example only, won't connect" shown before the copy button. Content is fixed client-specific JSON or a CLI example using an `.example` host; it's selectable and wraps rather than widening the page. No editable endpoint, token or secret.
- Copy feedback: a polite live region next to the button. Success: "Example copied." Failure: "Couldn't copy. Select the text and copy it manually." and the text gets selected. Messages stay until the next action; nothing times out.
- Agent selector: native select switching among fixed example configs. Changing it updates the panel and announces nothing beyond the new panel label.
- Step list: an ordered list labeled "Account journey" (Account, Connect MCP, Dashboard) with `aria-current="step"` on the current one. Display only, not a wizard and not a progress indicator.
- View nav: four links, Sessions, Workspaces, Flow, Heatmap, each at least 44px tall, with `aria-current="page"` on exactly one. Current view uses an ink underline plus bold weight, not color alone. No tab roles.
- Empty state: per view, an h2, one sentence on what would appear, one sentence on why it's empty in the preview, and one link onward (setup, or local `skillar open` instructions). No charts, zero-filled grids, counts, timestamps, skeletons or spinners.

### 5b. States

| State | Where | Rule |
| --- | --- | --- |
| Rest, hover, active, focus | all controls | Existing rules: underline on hover, opacity on press, 3px focus outline in current ink (code-ink on code panels) |
| Checking | session status line, account lines | Plain text "Checking your account…" while `/auth/session` is in flight. No spinner, skeleton or dimming; the sign-in and exploration links stay usable |
| Signed out | login | Status "Not signed in."; sign-in action, privacy note and exploration link visible |
| Signed in | login, account lines | The card, sign-out form and onward preview link replace the sign-in action; connect and dashboard lines read "Signed in as {email}." |
| Session check failed | login, account lines | Unreachable: "Couldn't reach the account service…"; bad or non-OK answer: "The account service didn't answer as expected…". Signed-out actions stay visible; never a raw server string |
| Callback cancelled / failed | login `?error=` | Fixed sentences from 5a; the session check still runs |
| Current | route nav, view nav, step list | `aria-current` plus underline and weight |
| Empty | four dashboard views | Explanation and next link, never a loading look |
| Copy success / failure | example config | Live region text as above |
| Unknown view | dashboard hash | Falls back to Sessions and says so in the view heading area; never blank |
| No JavaScript | all routes | All content and links visible; theme falls back to system; copy shows selectable text. The sign-in link works; the login page says it cannot show sign-in status; account lines keep their neutral default |
| Storage blocked | theme | Choice applies for the page; nothing breaks |

Not used: disabled sign-in, connected, synced, spinners, skeletons, progress bars. MCP setup and the dashboard have no live state to show, so they have no styles for one.

## 6. Motion

No decorative animation. Control hover is an immediate underline; press opacity communicates activation. All content visible without JavaScript. Reduced motion needs no separate reveal behavior. Route and view changes swap content instantly, and so does the swap from the sign-in action to the signed-in card; focus moves only in response to the person's action (to the new view heading). No spinners, progress bars or fake transitions.

## 7. Accessibility constraints

Visible skip link, semantic landmarks, one h1 per page, visible labels, keyboard-operable disclosures, no color-only status. Personal data is collected only by the Google consent flow that `/auth/google` starts, and the login page names what is stored before that link. No page pretends to provision a server.

- Targets: every interactive element is at least 44x44 CSS px at every width, including the wordmark and view nav. Action buttons stay at 48px.
- Contrast: ALL text is at least 4.5:1, including bold, large, labels, notes, disabled text and code. There's no 3:1 large-text exception on this site. Focus rings and control borders are at least 3:1.
- Token pairs, computed with the WCAG formula from the hex values above (rendered states still need checking):

| Pair | Light | Dark |
| --- | ---: | ---: |
| ink / background | 14.87 | 15.55 |
| ink / surface | 16.37 | 13.80 |
| muted / background | 5.70 | 7.61 |
| muted / surface | 6.27 | 6.75 |
| accent text / background | 5.59 | 7.93 |
| accent text / surface | 6.15 | 7.04 |
| on-accent / accent | 6.15 | 8.37 |
| code ink / code background | 14.47 | 15.46 |
| code muted / code background | 5.54 | 8.21 |
| syntax / code background | 5.44 | 8.55 |
| success / background | 5.61 | 9.74 |
| warn / background | 5.75 | 10.40 |
| error / background | 6.35 | 7.33 |
| border / background | 3.21 | 3.57 |
| border / surface | 3.54 | 3.16 |

- Syntax on the light code field (5.44) is the tightest text pair. Do not apply alpha to text tokens or use chart ramp colors as small text.
- Text reflows at 200% enlargement and at 320px width with no page-level horizontal scroll. Long example URLs break inside the code panel.
- Keyboard: tab order follows reading order; the sign-in link, exploration link and sign-out button are ordinary controls in that order; Back and reload keep the current route and view.
- Forced colors: borders, focus and current markers stay visible.

## 8. Accepted debt and boundaries

Hosted MCP provisioning, account dashboards, billing and prices are coming soon, not implemented. Google sign-in is implemented behind `/auth/*` (code + PKCE OIDC, owner brief). Stored: Google ID, email, name, picture, first and latest sign-in times; the session is a signed, secure, HttpOnly cookie; Google tokens are not retained. The browser additionally stores only the theme choice. Not available yet, so no copy promises them: account deletion, profile export, a retry control for a failed session check (the page says to reload). A no-JavaScript sign-out form remains available even though the page cannot display sign-in status without JavaScript. Timestamps from `/auth/session` are Unix seconds and are formatted in the reader's locale; a malformed account response shows a failed check instead of a partial profile. `/auth/*` answers 403 on any origin other than the configured production origin, its exact production Pages alias, or the configured localhost origin, which the pages report as the failed check rather than hiding it. Whether a future hosted service captures any local activity is undecided, and no copy may imply it does today. RTL isn't supported; new CSS should still prefer logical properties so it isn't harder later. Dashboard views use hash links inside one page, so a hosting change would need a recheck of deep links. English only; Korean toggle optional and omitted. Native system typography avoids CDN dependencies.

## 9. SaaS-informed information architecture

The owner's analogous-billing reference pass is recorded in
[`docs/design/saas-ia-comparison.md`](../docs/design/saas-ia-comparison.md).
Preserve this visual system; transfer the observed task sequence, not vendor
branding, prices, organizational complexity or authenticated sample data.

- Landing order: hero, deployment choice, hosted account journey, agent
  compatibility, how skills work, skill format, local setup, FAQ, footer.
  Hosting choice comes before installation detail. The install/migration block
  belongs with the working local setup, not the hosted prospect's first view.
- Navigation names the user tasks: Hosting, Hosted flow, Local setup, Docs.
  Before account pages ship, the hosted action truthfully reaches the on-page
  flow. The account increment replaced it with the account page entry, which
  the sign-in increment made a real sign-in.
- Login has one purpose and explains the next step. The working Google sign-in
  is distinct from an enabled, explicitly non-authenticating exploration link;
  signed-in people see exactly what is stored and how to sign out.
- Connect MCP keeps account scope, unassigned endpoint/credentials and
  client-specific example configuration separate. Copy labels say example.
  No Verify action, completed step or connected badge can imply a real service.
- Dashboard keeps connection help next to four empty activity views. Account
  context is informational and real: sign-in status from `/auth/session`,
  endpoint not provisioned, hosted pricing not announced. No fake user,
  organization, project, seat, trial meter, upgrade action or billing page is
  introduced.
- Reference access limits remain explicit: public sign-in was viewed; private
  onboarding/empty/settings were gated or supplemented by identified official
  documentation. A loading frame is not an empty dashboard.
