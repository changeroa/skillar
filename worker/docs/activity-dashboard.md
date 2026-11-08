# Managed cloud dashboard

The hosted dashboard uses the existing Google session at `skillar.sh`. Pages
authenticates every `/api/dashboard/*` request, verifies the owned device and
current consent, and sends a fresh read-only identity over `ACTIVITY_SERVICE`.
Browser cookies, bearer credentials and caller-supplied identity headers never
reach the activity Worker. The Worker has no public routes, workers.dev address
or preview URL.

Device connection is not upload consent. The default is local-only. Each device
needs a separate explicit managed-content grant, selected content categories
and acknowledgment that the service can decrypt/process those bytes. Retention
defaults to 30 days; longer content/projection retention is optional, while
backup retention cannot exceed 30 days. Historical upload requires the exact
prepared local snapshot, journal cut and range. See
[`local/docs/cloud-sync.md`](../../local/docs/cloud-sync.md).

## Deployment order

Use the repository's supported Node version. From `worker/`, apply the reviewed
activity migrations to `ACTIVITY`; from `site/`, apply reviewed accounts
migrations to `ACCOUNTS`. Review the pending migration list before applying it.
Deploy the activity Worker with its checked-in ingest flag **false** first:

```sh
npx wrangler deploy --config wrangler.activity.jsonc
```

Before activation, provision `CONTENT_KEYRING` as a Worker secret. Its format is
`{"current":1,"keys":{"1":"<32 random bytes, unpadded base64url>"}}`. Back up the
keyring in the owner's secret manager before use; never commit it or print it
in deployment evidence. Rotation adds a version and keeps old versions until
every retained ciphertext that needs them has expired. Reads never invent a
replacement for a missing key.

Pages binds `ACTIVITY_SERVICE` to `skillar-activity-foundation`. Its activity
routes are enabled, but raw ingestion additionally requires both Pages and
Worker ingest flags and current explicit device consent. Activate the reviewed
Worker only after tests, CI and gate approval:

```sh
npx wrangler deploy --config wrangler.activity.jsonc \
  --var ACTIVITY_INGEST_ENABLED:true
```

Deploy the reviewed site build to the existing `skillar-site` Pages project.
Preserve its Google OAuth and session secrets; do not rotate `SESSION_KEY` to
obtain a test session. Verify `/login/` over real HTTP after every deployment.
Use the owner's existing browser session for a signed-in smoke if available;
otherwise record that check as blocked once. Use fixture accounts/data for
sync and report tests. Real owner data requires their opt-in through the UI.

## Kill switch

From the reviewed deployed revision, redeploy the private Worker without the
activation override (the config contains `ACTIVITY_INGEST_ENABLED: "false"`):

```sh
npx wrangler deploy --config wrangler.activity.jsonc
```

The explicit equivalent is `--var ACTIVITY_INGEST_ENABLED:false`. This stops new
raw chunks, batch/migration/runtime writes and cloud eval saves. Authenticated
report/recovery reads remain available under current consent and account
fences. Dashboard profile metadata intersects both gates, so it reports ingest
disabled when the Worker gate is off. Local capture remains local.

P8 serves pinned snapshots with capture/receipt times and pending/stale report
metadata. It does not claim live streaming; durable account replay is P9.
Cloud-created eval queries are encrypted cloud-owned records, never silent
repairs or overwrites of the device's original SQLite source.

The first consented chunk or migration provisions a missing activity-shard
account fence after checking current primary account/device/generation and
consent. An existing closed or old-generation fence is never reopened. Account
deletion must keep a closed fence tombstone, including for an account that never
uploaded anything; removing the fence is not a revocation mechanism.

## Deployment evidence

Record exact deployed revisions, migrations, kill-switch state, fixture smoke
results and login HTTP/signed-in results. Read actual D1 size and trailing
read/write counters, R2 object/byte usage, and DO usage when P9 adds one.
Separate resource counters from billed charges; do not infer a $0 bill from an
empty bucket. Report the measured monthly projection and flag values above
$10/month.
