# Deployment configuration

Tracked `site/wrangler.jsonc.example` and `worker/wrangler*.jsonc` are templates, not
production configuration. Resource IDs are synthetic and bucket names are
examples. Dry runs and tests use these templates; never deploy them unchanged.
Historical documentation and evidence use replacement deployment identifiers
and example hosts, not usable endpoints.

## Local setup

1. Copy `site/wrangler.jsonc.example` to ignored `site/wrangler.jsonc`. Pages
   requires this default filename; it does not support a custom `--config`.
   Copy required Worker templates beside themselves with `.production` before
   `.jsonc` (for example, `worker/wrangler.activity.production.jsonc`). These files,
   `.dev.vars` and their variants are ignored. Keep a separate private backup.
2. Set your account, Worker/project names, D1 IDs, private R2 bucket names,
   OAuth KV namespace and exact domain routes in these private copies. Provision
   resources in your own Cloudflare account. Keep bindings such as `ACCOUNTS`,
   `ACTIVITY`, `ACTIVITY_RAW`, `SKILLS_BUCKET`, `OAUTH_KV`, `REPORT_FLOW` and
   `ACTIVITY_SERVICE` unchanged; set their resource targets for your installation.
3. Set `PUBLIC_ORIGIN` to your exact HTTPS site origin. Set the optional
   `PUBLIC_ORIGIN_ALIAS` only if an additional host should authenticate. Set the
   same origins in the activity Worker config. Neither accepts wildcard hosts.
   The connector accepts an explicitly configured HTTPS origin; `skillar.sh`
   remains the default public product endpoint.
4. Register each site's exact `/auth/google/callback` URL in your Google Web
   OAuth client. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and a random
   `SESSION_KEY` (at least 32 bytes) as production Pages secrets. Store Worker
   credentials and `CONTENT_KEYRING` as Worker secrets, not config vars. Do not
   rotate an existing session key during a configuration-only deployment.
5. Run `node scripts/verify.mjs` from the repository root. Apply the Pages D1
   migrations and activity migrations to the correct databases using your
   private config and `--remote` before first activation. Resource creation and
   migration are separate from deploying code.

For Pages, build `shared`, then build and deploy from `site` so Functions are
included:

```sh
npm --prefix shared ci && npm --prefix shared run build
cd site
npm ci && npm test && npm run build
npx wrangler pages deploy dist --branch main
```

For the service-binding-only activity Worker:

```sh
cd worker
npm ci && npm run typecheck && npm test
npx wrangler deploy --config wrangler.activity.production.jsonc --keep-vars
```

Use `wrangler.oauth.production.jsonc` or `wrangler.team.production.jsonc` for
those deployments. The team config generator remains available for an initial
team installation; its generated file is also ignored. Never deploy a template
to restore production. `--keep-vars` preserves dashboard vars; Cloudflare
preserves secrets across code deployments. Keep the activity Worker private
(`routes: []`, `workers_dev: false`, `preview_urls: false`) and preserve its
existing ingest switch. No resource IDs or secret values belong in CI logs.

## GitHub Actions

The manually dispatched `Production deployment` workflow runs only on `main`.
It deploys one explicitly selected existing target and serializes deployments
of that target. It does not provision a team Worker or turn on activity ingest.

Configure a `production` environment and the following secrets:

- `CLOUDFLARE_API_TOKEN`: a narrowly scoped deploy token for your account,
  with Pages/Worker and required binding access.
- `SKILLAR_PRODUCTION_CONFIGS`: JSON object mapping each of the six ignored
  config paths listed in the workflow to its JSONC file contents as a string.
  Restore all six entries, even if a target is not currently deployed. Keep
  this bundle private; it contains infrastructure identifiers.

Upload the bundle using stdin, never a command argument containing its values:

```sh
gh secret set SKILLAR_PRODUCTION_CONFIGS --repo OWNER/REPO < /private/configs.json
gh secret set CLOUDFLARE_API_TOKEN --repo OWNER/REPO < /private/deploy-token
gh workflow run deploy.yml --repo OWNER/REPO --ref main -f target=pages
```

The workflow creates ignored files with owner-only permissions and never
prints their contents. OAuth client secrets, session keys and content keys
remain in Cloudflare, not in the config bundle. An authenticated local
Wrangler deploy is also supported; it does not need the GitHub deploy token.

## Audit and history

The audit covered all tracked paths: configs, package scripts, CI, READMEs,
design documents, deployment records and test fixtures. Findings included a
Cloudflare account, D1 databases, OAuth KV, private R2 names, personal OAuth
app metadata and internal custom/Pages/Workers hosts. No real Google OAuth
client ID or personal email was confirmed in the tracked tree; fixture
addresses and client IDs are synthetic. Queue/DO binding types and ordinary
SQL `account_id` columns are not deployment identifiers.

Removing values from the current tree does not remove earlier commits. The
owner requested a separate all-branches-and-tags rewrite after this forward
fix merges, with a private mirror backup and coordinated pause before pushing.
Every affected commit and descendant changes SHA; collaborators must migrate
worktrees and PR heads without replaying the old history. Existing forks keep
their old objects, and GitHub pull-request refs/cached commit views may remain
reachable until GitHub Support purges them. Keep the old SHA list and Support
request private. No complete erasure is claimed by the forward fix.
