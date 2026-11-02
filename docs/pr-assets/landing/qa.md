# Landing increment QA

This increment completes the landing and its design/audit groundwork, not the
subsequent login/setup/dashboard screens. Hosted service remains unavailable.
No custom domain is configured.

## Evidence

Before images show the existing landing at `3d68317`. After images show the
production build of this increment. Paired hero and hosted-section images cover
390 and 1440 CSS px in light/dark. The lane additionally retains 60 production
viewport screenshots: resting header plus all eight sections and footer at
390/1440/1920 in both themes. Segmented captures avoid Chrome's full-page height
cap; no clipped full-page phone image is used as evidence.

## Driven checks

| Check | Result |
| --- | --- |
| Strict TypeScript and Vite production build | PASS, exit 0 |
| Theme select, saved preference and reload | PASS |
| Local CTA | PASS, reaches local setup |
| Hosted CTA | PASS, reaches explicitly planned account journey |
| Codex runtime variant | PASS, dry-run/init/foreground commands all update |
| Foreground alternative | PASS, `init --no-service` then `serve`, replaces service setup |
| Migration prerequisite | PASS, link before install command and collision explained |
| Native FAQ expansion | PASS |
| Clipboard success | PASS, announced persistent success |
| Clipboard denial | PASS, announced failure plus selected command for manual copy |
| Keyboard skip link | PASS, visible 151x59.9 px focus target; next focus is local CTA |
| Visible interactive targets | PASS, no target below 44x44 px; open FAQ links included |
| 390/1440/1920 light/dark geometry | PASS, scroll width equals viewport width |
| 320 and 768 reflow | PASS, no horizontal document overflow |
| 200% text at 390 and 1440 | PASS after fixing long-heading and footer-word reflow |
| JavaScript disabled | PASS, local anchor and native FAQ work via native DOM/input |
| Storage denied | PASS, theme still changes without persistence |
| Forced colors and reduced motion | PASS, visible focus and controls; no animations |
| Collection and third-party resources | PASS, no form or cross-origin resource requests |
| Truthfulness | PASS, only theme preference stored; local daemon upload claim scoped to captured activity |

The no-JavaScript test used native CDP DOM/input because the browser driver's
JavaScript-based locators cannot operate when scripting is disabled. Clipboard
checks subscribed to exact live-region state before clicking; no fixed sleeps.

## Performance

Three mobile and three desktop real Google Chrome Lighthouse runs on the final
post-reflow production build scored 100 performance, accessibility, best
practices and SEO in every run. The final build also passed independently.
Unscored image-delivery/render-blocking suggestions remain optimization notes,
not hidden failures. The Pages preview intentionally has `noindex`.

Preview: https://0322ceda.skillar-site.pages.dev (HTTP 200). Its asset names
`index-4a3AN8Vr.js` and `index-BkmpFg-4.css` match the local final build, and its
theme-storage and scoped telemetry disclosures were read back from deployed HTML.

## Independent review

Second visual oracle: PASS after viewing all six resting images and 54 section
images, plus supplemental boundary captures. First visual oracle and whole-change
gate remain pending before merge. This file does not claim their approval.

## Tool limitations

The TypeScript LSP could not discover the site's installed TypeScript from the
workspace root; independent strict `tsc --noEmit` passed. Biome LSP is not
installed. No unrelated lint dependency was added to the product.

## Scope

Source changes are confined to `site/`, the scoped site-build workflow, design
audit/provenance docs and these explicitly requested PR screenshot assets.
Local daemon, dashboard, registry, auth and runtime behavior are unchanged.
