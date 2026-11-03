# Prompt hero visual QA

Date: 2026-11-03. Branch: feat/prompt-hero. Base: 7aa0b04 (brand PR #60).

## Scope and design

Replace the cropped workshop raster with an informative, static HTML/CSS terminal,
SKILL.md file and MCP-to-agent handoff. Existing Vermilion Refined theme variables
drive every color. No external images, fonts, scripts, animation, invented metrics
or customer marks were added. The local/hosted caption states availability.

The old workshop exports remain because site/README.md and historical design
documentation still reference their provenance. They are no longer requested by
the homepage. The wordmarks keep their native 5:1 ratio. The 1200x630 OG image
was opened and inspected: all text and logo have clear margins; no section artwork
or other content images exist. The account profile picture now uses contain
instead of cover; a deliberately wide 96x48 fixture renders completely inside its
48x48 frame with all four red corner marks visible.

## Browser and captures

Real installed Chrome, driven by Bun.WebView CDP. Omowright's owned engine was
attempted first but produced stale-session errors on fresh tabs; it was closed
and the capture engine was changed. No user browser/profile was used.

360 and 390 use CDP device metrics with mobile=true and touch enabled, bypassing
Chrome's desktop window minimum. Other widths use desktop metrics. DPR is 1
for exact CSS-pixel capture dimensions. Light and dark are explicit saved themes,
with the visible theme select synchronized. Reduced motion is emulated.

The screenshots include the entire hero, using a viewport tall enough to hold it.
Before captures use the unmodified base hero. After captures are from the final
production build at http://127.0.0.1:5194/, not the development server.

## QA matrix

| Scenario | Evidence | Observed | Verdict |
| --- | --- | --- | --- |
| 360, light/dark | before-360-*.png, after-360-*.png | Complete terminal, file, arrow and agent; stacked layout; no page or child overflow | PASS |
| 390, light/dark | before-390-*.png, after-390-*.png | Complete illustration and caption; no overlap or page/child overflow | PASS |
| 768, light/dark | before-768-*.png, after-768-*.png | Two-column layout; command fits one line at 18px; all labels fit | PASS |
| 1024, light/dark | before-1024-*.png, after-1024-*.png | Two-column layout; readable full illustration | PASS |
| 1440, light/dark | before-1440-*.png, after-1440-*.png | Full illustration with balanced text/art columns | PASS |
| 1920, light/dark | before-1920-*.png, after-1920-*.png | Max-width shell; art does not stretch or crop | PASS |
| Safe area in all 12 states | Browser geometry measurements | Exactly 24 CSS px on every side between dotted field and terminal; zero overflowing illustration children | PASS |
| Account, Connect, Dashboard | login-*.png, connect-*.png, dashboard-*.png, plus *-bottom.png | 390 and 1440, both themes: no page overflow; visible wordmark stays 120x24 from 500x100 source | PASS |
| Wide profile picture | profile-contain-fixture.png | Computed contain; natural 96x48, frame 48x48; all four corner markers remain | PASS |
| OG image | site/public/og.png | 1200x630, no cut text or logo | PASS |
| Accessibility | role=img with aria-label; internal content aria-hidden=true | Single informative narration; no focusable illustration controls; caption outside image | PASS |
| Motion | computed animation-name=none in all states | Static with reduced motion; no animation added | PASS |
| Weight | Hero has no img or external asset reference | Zero hero image requests; only small inline markup/CSS added | PASS |
| Existing tests and build | shared: npm ci && npm run build; site: npm test && npm run build | 89 tests passed, 0 failed; production build exit 0 | PASS |
| Diff whitespace | git diff --check | Clean | PASS |

The orchestrator inspected all twelve final hero captures, the OG image and
the profile fixture. Shared CSS selectors for the new art are scoped under
prompt-*; the only account change is image fitting.

## Validation limits and existing findings

- Initial tests were started before building shared/dist and failed on that
  missing prerequisite. After following the CI order, all 89 passed.
- Vite's static preview does not serve Pages Functions; account routes correctly
  show the existing session-check failure message locally. No Google login or
  sign-out was attempted; authentication behavior is unchanged.
- Biome LSP is configured in the agent environment but is not installed.
  Editor diagnostics were unavailable; TypeScript and Vite production checks ran.
- npm ci reports four existing high-severity dependency advisories. No package
  or lockfile was changed in this visual-only task.
- No Lighthouse score is claimed. Real-browser geometry and the production
  build are the performance/weight checks for this scoped image replacement.

Independent visual gate: APPROVE for 08cdd1b, no blocking findings. The reviewer
opened all 12 final captures, compared every baseline width, inspected OG/icons
and the profile fixture, and independently checked text contrast (minimum
5.44:1). See gate-review.md. Feature push Site build CI passed (run 41582247735).
PR checks, merge and live deployment verification follow.
