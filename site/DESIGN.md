# skillar.sh

## 0. Research log

- Product: root README, local CLI/MCP, server registry and Worker distribution. The local CLI ships today; managed provisioning, signup and pricing do not.
- Taste: [tasteskill v2](https://github.com/leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md). Adopt subject-derived composition, full-ink copy, large type, a working example, and no invented proof. The subject's actual `SKILL.md` becomes the page's central artifact.
- Spatial contract: StyleGallery `sg:layout/webpage-generation-workflow`, use-cases section and homepage recipe. One document scroll owner; hook, explain, prove, compare, convert. No nested vertical scrollers.
- Reference shortlist: Vercel, Warp, Claude. Vercel selected for precise developer typography and readable code; its brand colors and logo are not copied. Native skillar workshop artwork supplies the project's own visual identity.
- Direction: a skill workshop, not an abstract cloud. Huge utilitarian lettering, vermilion actions, neutral paper, a real instruction file and the repository's articulated-arm illustration. Hosted capability is kept distinct from working local tooling.
- Existing brand artwork replaces generated concepts; no stock photography or invented product interface is needed.

## 1. Audience and argument

Developers using multiple coding agents need portable instructions. Hook: one place to serve skills. Explain: write, serve, connect. Prove: actual Markdown and MCP resource flow. Compare: local/self-host today versus hosted coming soon. Convert: disabled signup with an honest availability note and working GitHub path.

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
- Theme select: system/light/dark in the footer; visible label, native keyboard behavior. Source order always matches visual order.
- Code panel: dark field, readable tokens, filename header. Links use code-ink focus rings on the dark field in both themes. Copy action reports success/failure through a live region.
- Disclosure: native summary, 48px minimum target; native triangle indicator, visible focus.
- Shell, cluster, split: reusable layout classes; paragraph measures provide content limiting and normal flow provides stacking. No bespoke per-section grids.
- Compatibility list: real agent names, not endorsement logos.
- Example switch: native select chooses an actual host configuration example; no invented remote URL.

## 6. Motion

No decorative animation. Control hover is an immediate underline; press opacity communicates activation. All content visible without JavaScript. Reduced motion needs no separate reveal behavior.

## 7. Accessibility constraints

WCAG AA contrast in both themes, visible skip link, semantic landmarks, one h1, visible labels, keyboard-operable disclosures, no color-only status. At least 44px targets. The static signup does not collect personal data or pretend to provision a server.

## 8. Accepted debt and boundaries

Hosted signup, account provisioning, billing and prices are coming soon, not implemented. No backend is authorized by the brief. English only; Korean toggle optional and omitted. No custom domain attachment. Native system typography avoids CDN dependencies.
