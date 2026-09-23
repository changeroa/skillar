# ARKPOINT deployment — 2026-09-23

## Live deployment

- Canonical origin: https://deployment-9.example.test ; MCP: `/mcp`.
- Cloudflare account: `00000000000000000000000000000001` (`operator-8@example.test`).
- Worker: `gisul-arkpoint`; custom domain configured, workers.dev disabled.
- Deployed source: `4c7cdb57a61a99c87c6ad5b5f5b0d539628da19d`.
- Worker version: `00000000-0000-0000-0000-000000000020`.
- OAuth KV: `00000000000000000000000000000002`; R2: `example-private-bucket-3`.
- Runtime/plugin: https://github.com/Ark-Point/gisul (private), plugin `0.3.1`.
- Content: https://github.com/Ark-Point/gisul-skills (private), release `20260923.2`, commit `cd59fda439f20ee4b9f23253bab7f24bbbbaaa4c`.
- Content publication: https://github.com/Ark-Point/gisul-skills/actions/runs/35831504792 — passed, including staged and live verified MCP reads.
- Canonical runtime working path: `/Users/victor/projects/gisul`; content: `/Users/victor/projects/arkpoint-gisul-skills`.

This deployment used the local Cloudflare OAuth login. It used no Mac mini, SSH, tunnel, or origin server. The initial Worker deployment was not a GitHub Actions deployment. The content release was published by GitHub Actions.

## Verification

- Server tests: 48 passed; Worker tests: 52 passed, including real OAuth-provider integration in workerd with a mocked GitHub upstream.
- TypeScript checks, plugin and loader validation passed.
- Runtime GitHub Actions passed: https://github.com/Ark-Point/gisul/actions/runs/35831485228 .
- Installed marketplace from `Ark-Point/gisul` in a clean Codex home: plugin `0.3.1`, native `streamable_http`, `https://deployment-9.example.test/mcp`, no local command or embedded bearer credential.
- Live `/healthz` returned the deployed source commit. OAuth discovery advertised the custom domain; anonymous MCP requests returned 401.
- Live native search, load and pinned supporting-file read passed using the separate read-only CI identity against release `20260923.2`. This is not evidence of a real member OAuth login.
- GitHub OAuth app homepage and callback saved as `https://deployment-9.example.test` and `/callback`.

## Remaining activation work

1. GitHub OAuth application `3876557` (`example-oauth-client-7`) requires GitHub Confirm access before generating its client secret. Complete reauthentication at https://github.com/organizations/Ark-Point/settings/applications/3876557 ; provision `GITHUB_CLIENT_SECRET` directly into Worker secrets. Do not paste secrets into chat or commit them. Until then login intentionally returns setup-required 503.
2. Create a scoped Cloudflare deployment API token and set `CLOUDFLARE_API_TOKEN` in the runtime repository's `arkpoint-production` environment. Public deployment variables are already configured. Then set repository variable `GISUL_DEPLOY_ENABLED=true` and run `Deploy ARKPOINT Worker`. The job is currently skipped, not a successful automated deployment.
3. Complete an actual member OAuth login and native search/load/read before announcing team availability.
4. Editing is disabled until a content-repository credential and explicit `GISUL_WRITER_IDS` are configured. Members default to read access.
5. The Mac mini's installed client and any existing personal services have not been changed. Use the same team plugin there after actual login verification, then remove its duplicate old connection.

Machine publication/read credentials exist in Worker secrets and content Actions secrets. A local recovery copy is mode 0600 under `~/.config/gisul-arkpoint/`; no values are stored here. Personal skill content and the existing personal plugin were not changed.
