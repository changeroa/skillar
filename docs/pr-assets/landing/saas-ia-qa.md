# SaaS-informed landing follow-up

The owner requested a new reference pass before PR40 merges. See
[`saas-ia-comparison.md`](../../design/saas-ia-comparison.md) for all eleven
services, source limitations, billing-model differences and the four-screen IA.
Independent advisory audit `st_01a19a2d` approved the revised IA with no blockers.
This is not the final implementation gate.

## Changed journey

- Hosted/local deployment choice follows the hero, before implementation details.
- The hosted account -> MCP endpoint -> activity journey follows that choice.
- The hero offers the hosted explanation and a separate working local path.
- Installation and migration instructions now belong to local setup.
- Pricing remains unannounced; no account, endpoint or connection is created.
- The original workshop artwork has equivalent-source compressed WebP variants.

## Root browser checks

Production build: strict TypeScript and Vite passed. The optional Biome language
server is unavailable; no dependency was added solely for agent tooling.

Real isolated Chrome verified both CTA destinations, local setup selection
(`claude-code` produces dry-run, normal and `--no-service` commands), theme
persistence after navigation, native FAQ disclosure and denied-clipboard
selection plus persistent manual-copy instructions. No forms exist.

No horizontal document overflow at 320, 390, 768 or 1440 CSS pixels; 200% computed
text enlargement also fits at 390 and 1440. All visible links, buttons, selects
and summaries measure at least 44 x 44 pixels. The offscreen skip link is
intentionally clipped until focused; its focus behavior was verified in the
original landing increment.

The refreshed matrix covers every section at 390/1440/1920, light/dark, with
overlapping offset captures for tall phone sections, plus header-inclusive
resting captures. Full local artifacts:
`/Users/iyen/.dori/state/lane-results/skillar-web-ui/after/landing-saas-ia/`.
The original matrix remains unchanged as the before baseline.

Initial measurements found mobile performance 99, with other categories 100.
Equivalent-source WebP compression reduced transfer size. The final three mobile
and three desktop runs each scored 100 for performance, accessibility,
best practices and SEO (exit 0). Mobile LCP was 1.7 seconds. Image-delivery and
render-blocking advisory opportunities remain; a category score is not a claim
that Lighthouse emitted no suggestions. Earlier runs remain available.
No Lighthouse thresholds were changed. Source SEO and Pages preview noindex
remain separate checks.

Authentication, backend provisioning, activity ingestion and private reference
dashboards were not tested or implemented. They are outside this screen-only
increment. The following account-preview PR delivers the remaining three routes.
