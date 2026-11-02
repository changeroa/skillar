# skillar landing

Vite site with same-origin Cloudflare Pages Functions for Google sign-in.
MCP provisioning and hosted activity remain previews. No analytics or external
fonts. The owner-authorized production domain is `https://skillar.sh`.

```sh
cd site
npm ci
npm test
npm run build
npm run dev:pages
```

Pages project: `skillar-site`. Build command: `npm run build` from `site`;
output: `site/dist`. Run deployments from `site` so Wrangler includes
`functions/`. Production is the `main` branch at
`https://skillar.sh`, with `https://skillar-site.pages.dev` retained as a working
production alias. Only `/auth/*` runs Functions; account HTML
and assets remain static and contain no personal data.

## Google sign-in operations

The OAuth client is a **Web** client, with only `openid email profile` scopes.
Configure these exact Google-authorized origins and callback URLs:

| Environment | Origin | Redirect URI |
| --- | --- | --- |
| Canonical production | `https://skillar.sh` | `https://skillar.sh/auth/google/callback` |
| Production alias | `https://skillar-site.pages.dev` | `https://skillar-site.pages.dev/auth/google/callback` |
| Local | `http://localhost:8788` | `http://localhost:8788/auth/google/callback` |

Google does not support wildcard callback URLs. Branch preview hosts cannot
authenticate: their `/auth/*` routes reject unapproved origins. Do not put
production credentials in preview bindings. `PUBLIC_ORIGIN` is `https://skillar.sh`.
The exact production Pages alias also authenticates; callbacks, signed-cookie
issuers and logout Origin checks stay bound to the host where login began.
Sessions are separate host-only cookies, never shared across the two domains.
All four HTML entries declare their corresponding `skillar.sh` canonical URL.
There is no alias redirect and no wildcard preview authorization.

Set **production** Pages secrets using Wrangler (never commit their values):

```sh
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name skillar-site
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name skillar-site
npx wrangler pages secret put SESSION_KEY --project-name skillar-site
npx wrangler d1 migrations apply skillar-accounts --remote
```

Generate `SESSION_KEY` with at least 32 cryptographically random bytes. Google
credentials and the session key stay server-side, never in Vite variables.
Store the OAuth credentials in the `claw` 1Password vault as well.

For local development put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SESSION_KEY`, and `PUBLIC_ORIGIN=http://localhost:8788` in ignored `.dev.vars`.
Use the localhost URL, not `127.0.0.1`. Apply local D1 migrations with
`npx wrangler d1 migrations apply skillar-accounts --local`, build once, then
run `npm run dev:pages`. Vite alone does not serve the auth routes.

The flow uses authorization code + S256 PKCE, signed browser-bound state and
nonce, and Google's rotating JWKS for RS256 ID-token verification. Cookies
are host-only (`__Host-`), Secure, HttpOnly and SameSite=Lax. A login flow
expires in 10 minutes. Sessions expire in 7 days and are revoked in D1 on
same-origin POST logout. `GET /auth/session` is always `no-store`.

D1 stores only Google subject, email, name, picture URL and first/last sign-in
timestamps, plus random session IDs and their expiry. No Google access,
refresh or ID tokens are retained. Expired sessions are pruned on login.
Rotating `SESSION_KEY` invalidates all existing browser sessions.

The apex `skillar.sh` domain is attached to this Pages project with a proxied
CNAME to `skillar-site.pages.dev`. Its exact Google origin and callback are
registered alongside the Pages alias and localhost. Verify active HTTPS and
real login/logout on the canonical domain after deployment.

`public/workshop.webp` is an optimized copy of the repository's own `docs/assets/gisul-workshop.png`. See that folder's README for source details. The code example excerpts `plugins/skillar/skills/skillar/SKILL.md`, with its complete frontmatter and first instruction sentence.

Product claims are sourced from the root README, `local/README.md`,
`server/README.md`, `worker/src/`, and `docs/deployment.md`. Google account
sign-in is implemented; managed MCP provisioning, activity and hosted prices
remain coming soon. Local privacy does not imply hosted privacy.
