# SaaS billing and information-architecture comparison

Research date: 2026-11-02. This is the owner's additional reference pass before
PR40 may merge. It supplements, rather than replaces, the HIG/frontend audit.
No vendor price, metric, trial, quota or licensing claim becomes a skillar promise.
Skillar hosted pricing remains **not announced**.

## Method and limits

Eleven named services were checked through live public sites, official
documentation and real screenshots. Five evidence packs contain 135 image
artifacts and per-image URL/date/viewport/provenance manifests:

- `supabase-langfuse`: 18 artifacts.
- `posthog-sentry`: 36 artifacts.
- `trigger-inngest`: 36 artifacts.
- `mcp-hosts`: 23 artifacts.
- `cal-plausible`: 22 artifacts.

The lane retains these under `research/saas/` with reports and source/claim
manifests. They are not runtime site assets. Counts include documented access
gates and failed/lazy-loading frames; **135 does not mean 135 authenticated
product screens**. No account was created or signed in, no keys were obtained,
and no external resources were provisioned.

Public sign-in screens were reached. Private first-run, empty dashboards and
settings were auth-gated. Official published UI illustrations and documentation
supplement those states with explicit provenance; a login redirect is not an
empty dashboard. Cal's settings illustrations visibly date from 2023/2024 and the
Supabase app illustration is historical. Plausible's loading demo and unloaded
documentation image frames are explicitly excluded as empty/product UI proof.
Its actual published onboarding WebP was inspected instead.

Some packs split pricing/self-hosting and others split onboarding/connection.
The tables below normalize topics, without inflating a uniform state count.

## Billing-model fit: verified, not assumed

| Service and primary sources | Free/self-host reality | Hosted billing scope | Fit for skillar |
| --- | --- | --- | --- |
| [Supabase pricing](https://supabase.com/pricing), [self-host](https://supabase.com/docs/guides/self-hosting) | Open-source self-host path; operating/support and cloud-feature differences matter | Organization plan, project infrastructure and usage | Strong deployment-choice/connection pattern; do not invent organizations or projects |
| [PostHog pricing](https://posthog.com/pricing), [self-host](https://posthog.com/docs/self-host) | MIT self-host guide, operator responsibility and unsupported deployment; paid cloud features are not universal free parity | Product-specific metered usage | Strong free-local/managed responsibility split and setup-first path |
| [Langfuse pricing](https://langfuse.com/pricing), [self-host](https://langfuse.com/self-hosting), [self-host tiers](https://langfuse.com/pricing-self-host) | Open-source core; commercial self-host features/tiering exist | Cloud organization/project usage and feature tiers | Strong account -> credentials -> first trace structure, not its entity/pricing hierarchy |
| [Sentry pricing](https://sentry.io/pricing/), [self-host/license](https://develop.sentry.dev/self-hosted/) | Free self-hostable, but current FSL/Fair Source is not unrestricted OSI open source | Organization plans plus product usage | Useful project/config/first-event sequencing; not an exact OSS-license analogue |
| [Trigger.dev pricing](https://trigger.dev/pricing), [self-host](https://trigger.dev/docs/self-hosting/overview) | Self-hostable open-source path, operator manages infrastructure | Plan/compute usage with seat/feature distinctions | Strong explicit credential/config placement; task-compute billing is not MCP endpoint pricing |
| [Inngest pricing](https://www.inngest.com/pricing), [self-host](https://www.inngest.com/docs/self-hosting) | SSPL/source-available distinction; do not label unrestricted OSS | Execution/platform usage and plan/seat limits | Useful local-versus-cloud and key-role clarity; not an exact license or endpoint-meter match |
| [Cal.com pricing](https://cal.com/pricing), [root license](https://raw.githubusercontent.com/calcom/cal.com/main/LICENSE) | Root LICENSE returned MIT live; enterprise-component exceptions not fully audited | Free individual hosted plan; team/organization per-user plans | Useful account entry and operations choice; not per-endpoint billing |
| [Plausible pricing](https://plausible.io/#pricing), [self-host](https://plausible.io/docs/self-hosting) | Free self-operated AGPL Community Edition versus managed cloud | Monthly pageviews, plan/site/team/API features | Strongest simple self-host/managed comparison and setup handoff |
| [Smithery current status](https://www.smithery.ai/future) | Registry remains; proxy/managed identity shut down October 31, 2026 | Retired proxy pricing is not a current model | Negative reference: distinguish catalog/discovery from account-owned hosting |
| [Composio pricing](https://composio.dev/pricing), [deployment options](https://docs.composio.dev/docs/security/token-custody) | Cloud/free tier is not free self-host parity; self-host is Enterprise arrangement | Tool calls, delivered events, plan/add-on distinctions | Strong client-specific MCP handoff; shared URL/connected accounts are not skillar identity |
| [Pipedream Connect pricing](https://pipedream.com/pricing?plan=Connect), [MCP consumers](https://pipedream.com/docs/connect/mcp/users) | Open integration components do not establish a free self-hostable Connect control plane | Platform, external users and compute credits | Strong endpoint -> client instructions; no basis for a skillar external-user meter |

No surveyed product establishes that skillar should charge per endpoint,
execution, token, seat or project. The owner supplied the planned per-account
endpoint concept; research informs its explanation, not an invented price model.

## Screen evidence comparison

L=live public UI; D=official documentation/published illustration;
G=auth-gated private state; H=historical official image; R=retired service.

| Service | Landing / deployment-pricing | Sign-in | First-run / connection | Empty dashboard | Settings / API keys |
| --- | --- | --- | --- | --- | --- |
| Supabase | L+D, cloud/self-host distinction | L, method-first identity | D, project then quickstart/config | G; H populated illustration only | D, key versus user identity explicitly separated |
| PostHog | L+D, product meters/self-host caveats | L, one account task | D, install choice and command/snippet | G; D describes next actions, not reached empty app | D, project versus personal keys |
| Langfuse | L+D, cloud and self-host tiering | L | D, get credentials then first trace | G; H populated illustration only | D, project and organization keys distinguished |
| Sentry | L+D, plans/license/support | L, focused auth | D, project/platform/SDK handoff | G; D next-action guidance | D, authentication-token/DSN scope |
| Trigger.dev | L+D, compute and self-host responsibilities | L | D, manual/quickstart and backend placement | G; official populated example not empty proof | D, project/environment key scope |
| Inngest | L+D, execution plans/self-host limits | L | D, local server and connect/sync | G; historical populated UI not empty proof | D, event/signing/API-key roles |
| Cal.com | L, team seats; root license checked | L | L signup/catalog; private calendar connection G | G, app root redirects to login | H official 2023/2024 settings illustrations |
| Plausible | L+D, traffic tiers/CE operations | L | D actual Add website and installation UI | G; public loading frame not empty proof | D, personal versus site/team/API-key scope |
| Smithery | L+R, explicit shutdown status | R; not a current auth funnel | Catalog live, retired proxy excluded | Unavailable after retirement | Retired managed identity excluded |
| Composio | L+D, usage/Enterprise deployment | L | D, shared MCP plus client-specific setup | G | D, project credentials versus connected accounts |
| Pipedream Connect | L+D, platform/external-user scope | L | D, copy endpoint then choose client | G | D, workspace/project/environment scope |

## Adopted patterns and rejected overreach

| Decision | Evidence | Change for skillar | Not transferred |
| --- | --- | --- | --- |
| IA1: show the operating choice before implementation detail | Plausible self-host/Cloud and Langfuse cloud/self-host pricing | Bring deployment comparison immediately after hero; distinguish available MIT local/self-host from planned managed account endpoint | Vendor prices, free cloud, trial or feature-parity promises |
| IA2: name the hosted outcome before asking for identity | Supabase focused sign-in; Cal/Plausible clear signup/demo alternatives | Hero has a clear hosted-flow preview and a working local path; login explains account -> MCP -> remote views | Customer testimonials, live signup, extra OAuth providers or email/password collection |
| IA3: treat setup as first value | [Langfuse manual setup](https://langfuse.com/docs/observability/get-started#manual-installation), [PostHog install](https://posthog.com/docs/getting-started/install) | Move account journey near deployment choice; show Account, Connect MCP, Dashboard as linked preview stages | Completed-step badges, fake key creation or connection checks |
| IA4: endpoint, client instructions and credential state are separate | [Composio Connect](https://docs.composio.dev/docs/composio-connect), [Pipedream MCP](https://pipedream.com/docs/connect/mcp/users) | Connect screen shows not-provisioned account endpoint, client selector and explicitly nonfunctional example configuration | Vendor URL shapes, active token values, SDK sessions or claimed remote-client compatibility |
| IA5: explain ownership instead of inventing hierarchy | [Langfuse key scope](https://langfuse.com/docs/administration/rbac#api-keys), [Plausible API scope](https://plausible.io/docs/stats-api) | Label account endpoint and credential availability separately; no organizations/projects/environments without a product contract | Vendor org, project, team, external-user, region or role selectors |
| IA6: keep connection help beside empty activity | Sentry/PostHog documented first-value guidance; local dashboard taxonomy | Dashboard has connection/availability context and one clear setup action; four meaningful empty views | Charts, counters, sampled sessions, quota meters or populated reference data |
| IA7: billing belongs to account context, not setup progress | Plausible account/team settings; Trigger/Inngest scoped-key guidance | Informational account state says hosted pricing not announced; no dead billing control | Upgrade, payment form, invoices, free credits or trial countdown |
| IA8: preserve escape and working alternative | Cal/Plausible auth and local/cloud paths | Every preview screen links back to landing and real `skillar open`/local setup | Authentication simulation or implying local telemetry uploads |

## Revised screen map

### Landing

Order: hero -> deployment choice -> hosted account journey -> agent compatibility
-> how skills work -> skill format -> local setup -> FAQ -> footer.
The local install/migration block moves out of the hero into local setup,
where the actual commands belong. Main navigation emphasizes Hosting, Hosted
flow and Local setup instead of making implementation format the primary tour.
Before the account-screen PR, the hosted CTA truthfully targets the on-page flow;
that next PR changes it to the real screen-preview route.

### Login preview

One purpose: explain planned account access and what follows. Method-explicit
GitHub sign-in is unavailable with an adjacent explanation. The enabled
exploration link is visibly separate and does not authenticate or submit data.
No personal input, claimed user identity, extra providers or account creation.

### Connect MCP preview

Persistent account-preview and not-provisioned context; Account/Connect MCP/
Dashboard navigation with only the current stage marked. Show endpoint state,
credential state and example configuration separately. A supported-source client
selector changes only illustrative instructions. Copy says **example**, the
hostname is reserved/non-operational, no request is made and no success is faked.
Offer **View dashboard preview**, never Verify/Connected.

### Dashboard preview

Account/connection context remains visible; the primary next action is Connect
MCP. Sessions, Workspaces, Flow and Heatmap remain accessible, distinct empty
views grounded in the local product. Account/hosting information is plain text:
no account exists, no endpoint is assigned and pricing is not announced.
No fake zero charts, generated sessions, trial meter or disabled upgrade maze.
Keep an exit and real local-dashboard alternative on every screen.

## Implementation and verification trace

PR40 gets the landing follow-up and this decision record before a fresh gate.
The next atomic PR implements login/connect/dashboard from this same map.
Both PRs include their own before/after evidence and current QA. Re-run changed
route/section screenshots at 390/1440/1920 light/dark, actual target/overflow
measurements, keyboard and copy/error paths, 200% text, production build,
deployment readback, CI and the independent gate. Prior baseline approval does
not approve the owner's new IA.
