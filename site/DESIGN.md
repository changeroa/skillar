# skillar.sh

## 0. Research log

- Product: root README, local CLI/MCP, server registry and Worker distribution. The local CLI ships today; managed provisioning, signup and pricing do not.
- Taste: [tasteskill v2](https://github.com/leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md). Adopt subject-derived composition, full-ink copy, large type, a working example, and no invented proof. The subject's actual `SKILL.md` becomes the page's central artifact.
- Spatial contract: StyleGallery `sg:layout/webpage-generation-workflow`, use-cases section and homepage recipe. One document scroll owner; hook, explain, prove, compare, convert. No nested vertical scrollers.
- Reference shortlist: Vercel, Warp, Claude. Vercel selected for precise developer typography and readable code; its brand colors and logo are not copied. Native skillar workshop artwork supplies the project's own visual identity.
- Direction: a skill workshop, not an abstract cloud. Huge utilitarian lettering, vermilion actions, neutral paper, a real instruction file and the repository's articulated-arm illustration. Hosted capability is kept distinct from working local tooling.
- Existing brand artwork replaces generated concepts; no stock photography or invented product interface is needed.

## 1. Audience and argument

Developers using multiple coding agents need portable instructions. Hook: one place to serve skills. Explain: write, serve, connect. Prove: actual Markdown and MCP resource flow. Compare: local/self-host today versus hosted coming soon. The SaaS-informed revision leads with deployment choice and a clearly labeled account-preview action, alongside the working local path. No signup form and no email collection.

Account preview (screen only): `/login/` shows a disabled "Sign in with GitHub" with its reason beside it and a separate, enabled "Explore the account preview" link. `/connect/` shows a fixed MCP configuration on a reserved `.example` host, labeled as a non-working example. `/dashboard/` has four empty views: Sessions, Workspaces, Flow, Heatmap, in the local dashboard's order. Nothing authenticates, connects, stores or fetches account data. The audit behind this is `docs/design/web-ui-audit.md`.

## 2. Color

Light: background #f4f4f0, surface #e9e9e3, ink #20211e, muted #54564e, accent #b73520, on-accent #ffffff.
Dark: background #171916, surface #242720, ink #f0f1e9, muted #b8bdad, accent #ff9277, on-accent #251811.
Code: background #20251f in light / #0f110e in dark, ink #eff2e7, muted #bbc4ad, syntax #ffa58b. The dark panel stays visibly below both background bands.
Focus uses current ink; no status conveyed by color alone.

## 3. Typography

System sans (`Arial`, sans-serif), code (`ui-monospace`, monospace). No external requests or font shifts.
Hero 80px desktop / 44px phone, line height 1.02, tracking -0.055em.
Section 48px / 32px, line height 1.08, tracking -0.04em.
Subhead 24px, body 18px, notes/code 15px. Weights 400, 500, 600.

## 4. Layout and spacing

Base 4px; spacing 8, 12, 16, 24, 32, 48, 64, 96, 128.
Max width 1280px; symmetric 48px gutters desktop, 24px phone.
Hero text and source artwork share an asymmetric 1.15/1 grid. Workflow is an ordered editorial list. Skill example is split text/code. Comparison is a real table. FAQ uses native details.
At 760px all splits stack. Navigation wraps rather than disappearing. The document owns vertical scrolling. Code wraps long text rather than widening the page.

## 5. Primitives and states

- Action: square, 48px minimum target, primary accent fill / secondary ink wash. Hover underline, active opacity, focus-visible 3px outline. Disabled CTA uses native disabled semantics with an adjacent explanation.
- Theme select: system/light/dark near the main navigation on every route, one shared state and storage key; visible label, native keyboard behavior. System is the default when nothing is saved. Source order always matches visual order.
- Code panel: dark field, readable tokens, filename header. Links use code-ink focus rings on the dark field in both themes. Copy action reports success/failure through a live region.
- Disclosure: native summary, 48px minimum target; native triangle indicator, visible focus.
- Shell, cluster, split: reusable layout classes; paragraph measures provide content limiting and normal flow provides stacking. No bespoke per-section grids.
- Compatibility list: real agent names, not endorsement logos.
- Example switch: native select chooses an actual host configuration example; no invented remote URL.
- Wordmark: home link keeps its type size; padding grows its hit area to at least 44x44px.

### 5a. Account preview primitives

These use the tokens above. No new colors, fonts or radii.

- Preview notice: a bordered surface band at the top of every account route, before any action. Text in ink: "Screen-only preview. Nothing here signs you in, connects or stores data." Plus a link back to the landing page. It never collapses or dismisses.
- Account shell: same shell and gutters as the landing page. Header holds wordmark, a route nav (Sign in, Setup, Dashboard) and the theme select. Nav wraps at narrow widths; it never hides. Each page has a unique title and one h1.
- Disabled action: native `disabled` button, ink text on surface with a 1px dashed ink border. No opacity fade, so its label still meets 4.5:1. A visible reason sits directly after it and is tied with `aria-describedby`. It never navigates, opens a popup or sends a request.
- Preview link: an action-styled link (accent fill) whose label names the outcome, e.g. "Explore the account preview". One accent action per view.
- Status line: text first, e.g. "Not connected (preview)". A neutral square marker may precede it; color never carries the meaning. No green, no "connected", "live", "synced" or "signed in".
- Example config panel: the code panel with header "Example only, won't connect" shown before the copy button. Content is fixed client-specific JSON or a CLI example using an `.example` host; it's selectable and wraps rather than widening the page. No editable endpoint, token or secret.
- Copy feedback: a polite live region next to the button. Success: "Example copied." Failure: "Couldn't copy. Select the text and copy it manually." and the text gets selected. Messages stay until the next action; nothing times out.
- Agent selector: native select switching among fixed example configs. Changing it updates the panel and announces nothing beyond the new panel label.
- Step list: an ordered list showing the journey (Sign in, Set up, Dashboard) with `aria-current="step"` on the current one. Display only, not a wizard and not a progress indicator.
- View nav: four links, Sessions, Workspaces, Flow, Heatmap, each at least 44px tall, with `aria-current="page"` on exactly one. Current view uses an ink underline plus bold weight, not color alone. No tab roles.
- Empty state: per view, an h2, one sentence on what would appear, one sentence on why it's empty in the preview, and one link onward (setup, or local `skillar open` instructions). No charts, zero-filled grids, counts, timestamps, skeletons or spinners.

### 5b. States

| State | Where | Rule |
| --- | --- | --- |
| Rest, hover, active, focus | all controls | Existing rules: underline on hover, opacity on press, 3px focus outline in current ink (code-ink on code panels) |
| Disabled | GitHub sign-in | Dashed border, full-contrast text, reason beside it, removed from tab order natively |
| Current | route nav, view nav, step list | `aria-current` plus underline and weight |
| Empty | four dashboard views | Explanation and next link, never a loading look |
| Copy success / failure | example config | Live region text as above |
| Unknown view | dashboard hash | Falls back to Sessions and says so in the view heading area; never blank |
| No JavaScript | all routes | All content and links visible; theme falls back to system; copy shows selectable text |
| Storage blocked | theme | Choice applies for the page; nothing breaks |

Not used: loading, connected, error-from-server, signed-in. These states don't exist in a screen-only preview, so they have no styles.

## 6. Motion

No decorative animation. Control hover is an immediate underline; press opacity communicates activation. All content visible without JavaScript. Reduced motion needs no separate reveal behavior. Route and view changes swap content instantly; focus moves only in response to the person's action (to the new view heading). No spinners, progress bars or fake transitions.

## 7. Accessibility constraints

Visible skip link, semantic landmarks, one h1 per page, visible labels, keyboard-operable disclosures, no color-only status. No page collects personal data or pretends to provision a server.

- Targets: every interactive element is at least 44x44 CSS px at every width, including the wordmark and view nav. Action buttons stay at 48px.
- Contrast: ALL text is at least 4.5:1, including bold, large, labels, notes, disabled text and code. There's no 3:1 large-text exception on this site. Focus rings and control borders are at least 3:1.
- Token pairs, computed with the WCAG formula from the hex values above (rendered states still need checking):

| Pair | Light | Dark |
| --- | ---: | ---: |
| ink / background | 14.68 | 15.55 |
| ink / surface | 13.28 | 13.32 |
| muted / background | 6.76 | 9.20 |
| muted / surface | 6.11 | 7.88 |
| accent text / background | 5.37 | 8.11 |
| accent text / surface | 4.86 | 6.95 |
| on-accent / accent | 5.93 | 7.91 |
| code ink / code background | 13.76 | 16.74 |
| code muted / code background | 8.63 | 10.49 |
| syntax / code background | 8.18 | 9.94 |

- Accent text on surface (4.86 light) is the tightest pair; don't put accent text on anything lighter-contrast than surface.
- Text reflows at 200% enlargement and at 320px width with no page-level horizontal scroll. Long example URLs break inside the code panel.
- Keyboard: tab order follows reading order; disabled sign-in doesn't trap focus; Back and reload keep the current route and view.
- Forced colors: borders, focus and current markers stay visible.

## 8. Accepted debt and boundaries

Hosted signup, account provisioning, billing and prices are coming soon, not implemented. No backend is authorized by the brief. The account preview has no real sign-in, OAuth, credentials, cookies, account data, endpoint requests or telemetry; it stores only the theme choice. Whether a future hosted service captures any local activity is undecided, and no copy may imply it does today. RTL isn't supported; new CSS should still prefer logical properties so it isn't harder later. Dashboard views use hash links inside one page, so a hosting change would need a recheck of deep links. English only; Korean toggle optional and omitted. No custom domain attachment. Native system typography avoids CDN dependencies.

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
  flow. The account increment replaces it with the actual screen-preview entry.
- Login has one purpose and explains the next step. Unavailable GitHub sign-in
  is distinct from an enabled, explicitly non-authenticating exploration link.
- Connect MCP keeps account scope, unassigned endpoint/credentials and
  client-specific example configuration separate. Copy labels say example.
  No Verify action, completed step or connected badge can imply a real service.
- Dashboard keeps connection help next to four empty activity views. Account
  context is informational: no account created, endpoint not provisioned,
  hosted pricing not announced. No fake user, organization, project, seat,
  trial meter, upgrade action or billing page is introduced.
- Reference access limits remain explicit: public sign-in was viewed; private
  onboarding/empty/settings were gated or supplemented by identified official
  documentation. A loading frame is not an empty dashboard.
