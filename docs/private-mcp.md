# Private account MCP

The private account server is a separate deployment from the historical
GitHub/team MCP Workers. Its canonical resource is `https://skillar.sh/mcp`.
For another installation, replace that origin consistently.

## Connect

Publish a skill on `/skills/` after selecting its files and confirming the
private upload. Add the remote HTTP endpoint in your MCP client and start its
OAuth flow. The approval page uses the existing Google account session; it
does not give the client your Google cookie or Google tokens.

For Codex, the OAuth configuration is:

```toml
[mcp_servers.skillar]
url = "https://skillar.sh/mcp"
```

Use the client's normal MCP login command. For clients without browser OAuth,
create a personal access token on `/connections/`. It is shown once, masked
initially, and defaults to seven days; the maximum is thirty days. The server
stores its hash, not its plaintext. A Codex PAT configuration additionally sets:

```toml
bearer_token_env_var = "SKILLAR_MCP_TOKEN"
```

Supply that environment variable through your normal secret manager. Do not
reuse a device connector credential or put a Google session cookie in an MCP
configuration. Revoking a connection immediately prevents further access;
already recorded history is governed by its retention and deletion controls.

Every connection is read-only in this increment: `skills:read`. OAuth clients
can also request `offline_access` for rotating refresh tokens. The separate
activity-recording checkbox starts unchecked. Checking it permits
`activity:record`: server-readable search queries and resource-read observations
in the activity dashboard, retained for thirty days by default. It does not
upload local files. An unchecked connection creates no observation stream.

## Protocol and data

- `search_skills` keeps the local query, mode, offset, limit, ranking, abstention,
  true total and `trace_id` contract. Pass the returned trace identifier in
  request `_meta["app.skillar/traceId"]` when reading a resource to correlate a
  consented load with its search.
- `skills/list`, `skills/get`, `resources/list` and `resources/read` expose
  current and explicitly pinned versions. Edits, version changes, unpinning and
  deletion are read live without restarting a daemon or redeploying the server.
- MCP resource URIs use `skill://private/<id>/<manifest-digest>/<path>`.
  This is a scheme-only mapping of the private storage identity. Frontmatter
  comes from the complete original `SKILL.md`, including custom and Unicode
  fields. Resource text retains BOM and line endings; binary content uses base64.
- Lists use fifty-entry pages. Cursors are method-, account-, generation- and
  catalog-revision-bound; restart a listing after an expired cursor.
- The native SDK owns JSON-RPC, tools, resource reads, modern protocol headers
  and legacy Streamable HTTP. Fresh server instances serve each exchange.
  HTTP cancellation reaches the in-flight handler and backend abort signal.
  Cross-request cancellation, replay and persistent pushed-state delivery are
  not promised by this stateless implementation.

SDK 2.4's high-level Skills implementation rejects existing Unicode names.
Two typed native SDK extension handlers preserve the original data instead of
renaming skills or changing their bytes. An unmodified SDK 2.4 `SkillsClient`
still applies that semantic restriction; generic extension requests and the
standard search/resource interfaces accept the original names. The SDK's
high-level resource-list callback also discards cursors, so that standard list
method uses its native typed request-handler API. There is no custom JSON-RPC
dispatcher.

## Deploy a private installation

Follow [deployment configuration](self-hosting.md) first. The additional
templates are `worker/wrangler.mcp-auth.jsonc` and `worker/wrangler.mcp.jsonc`;
both are disabled by default and have no public Worker routes.

1. Make ignored `.production.jsonc` copies. Provision a dedicated OAuth KV
   namespace for this authorization server; do not reuse the legacy GitHub
   OAuth namespace. Choose an account-unique rate-limit namespace identifier.
2. Bind the authorization Worker to the existing primary `ACCOUNTS` D1,
   `OAUTH_KV` and `OAUTH_RATE_LIMITER`. Apply primary migration
   `site/migrations/0006_mcp_connections.sql` before enabling any route.
3. Bind the resource Worker to `MCP_AUTH` and the existing `ACTIVITY_SERVICE`.
   Deploy the activity Worker with its existing D1, private R2, actor and
   content-keyring bindings intact. Consented observation cuts are serialized
   by its existing account catalog actor, not a new MCP protocol actor.
4. Bind Pages to `MCP_AUTH` and `MCP_RESOURCE`. Keep its Google client,
   `SESSION_KEY`, primary database and activity binding unchanged. Deploy the
   authorization Worker, resource Worker and built Pages Functions before
   enabling `MCP_ENABLED="true"` in all three private configurations.
5. Verify Google sign-in and an existing session, discovery metadata, an actual
   client connection, cross-account isolation and immediate revocation.
   Disabling the MCP flag closes the corresponding surface without changing
   the legacy team OAuth service.

Public discovery is served at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/mcp`. The browser approval route is
`/oauth/authorize`; token and registration routes are `/oauth/token` and
`/oauth/register`. Google callbacks retain their existing route and ordinary
`/login/` destination. A bounded MCP return URL is stored under a hashed flow
state in primary D1, not inside the browser cookie.

The existing manual production workflow also accepts `mcp-auth` and `mcp`
targets. Its sealed `SKILLAR_PRODUCTION_CONFIGS` repository secret must contain
both additional private configuration paths as well as the six existing paths.
It remains a path-to-file-content JSON object; do not replace production
credentials or the content keyring when updating it.

Only private service-binding RPC can supply a verified browser principal.
Public identity headers are discarded. Primary connection and credential
fences apply independently of OAuth KV consistency, including refresh rotation
and access-token versus refresh-grant revocation. Scheduled cleanup processes
the grant-revocation outbox and expires credential and consent handles.
