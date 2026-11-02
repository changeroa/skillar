# P5: private managed-content transport

P5 adds an **inactive, service-binding-only** activity Worker and two authenticated
Pages proxy routes: `POST /v1/activity/chunks` and `POST /v1/activity/batches`.
No local sender or dashboard connection is included; P6/P8 own those increments.
There are no public Worker routes, workers.dev or preview URLs. No owner data is
used. Server/Worker code is AGPL-3.0-only; shared/site/local code remains MIT.

## Before and after / 이전과 이후

Before P5, a P3 receipt represented only strict metadata; P4 raw source rows could
not be sent to it. After P5, a device with explicit browser-granted managed-content
consent can stage immutable encrypted chunks and finalize their exact manifest
in the same generation-fenced transaction as its receipt and projections. Receipt
JSON, Queue/job intent and D1 manifests contain no raw text/args/span payloads.

P5는 운영 원문 수집을 활성화하지 않습니다. 기본 local-only는 유지되며, 로그인한
사용자가 기기·프로젝트/root·내용 종류·과거 범위를 명시적으로 허용해야 합니다.
원문은 비공개 R2에 저장되고 서버는 복호화할 수 있으므로 E2EE가 아닙니다.

## Authentication, consent and kill switch

Pages uses the existing live device credential verifier. The proxy discards
caller identity headers, cookies and bearer credentials and forwards only its
server-created device principal. The activity Worker trusts this header **only
because it has no public endpoint**; do not enable workers.dev or add a public
route to this entrypoint. Every write also rechecks current account/device state,
primary-D1 consent and the activity tenant-generation fence.

`GET/POST /api/devices/:id/consent` require the existing Google browser session
and mutation Origin checks. POST uses `baseVersion` CAS and the strict P1 consent
schema. Grant time is server-stamped so a device cannot backdate live consent.
Historical backfill remains a separate versioned/ranged grant. Local-only
revocation becomes the latest explicit consent, not an omitted field.

**Kill switch:** `ACTIVITY_INGEST_ENABLED` must equal `"true"` in **both** Pages
and the content Worker. Either absent/false value disables new ingest with 404;
`ACTIVITY_ENABLED` additionally gates the entire Pages activity surface. The
committed Worker configuration sets ingest to `"false"`. Until P8 activation,
do not deploy an enabled configuration or add the Pages `ACTIVITY_SERVICE`
binding. Turning off ingest preserves the local journal/outbox for replay.
An in-flight final transaction remains subject to its D1 generation fence;
account deletion must close that fence before physical cleanup.

## Wire and durability

Shared v2 schemas bound each decoded chunk to 128 KiB and its JSON request to
256 KiB; final manifests allow 128 chunks/16 MiB. Full grants preserve every
source scalar/JSON string, Unicode, recording vector and source order. Raw v2
intervals are `(previousCut, through]`; finalization translates their lower bound
to the P3 ledger's inclusive `from = previousCut + 1`.

A durable intent row is written **before** R2 PUT. Objects use server-computed
account/generation/device/lineage/batch-scoped keys and conditional create-only
PUT. A retry verifies/decrypts already-existing bytes; random nonces do not change
logical content hashes or the original receipt. Chunks are not accepted batches.

Finalization reads and authenticates every actual R2 object, checks references
and the whole plaintext hash, strictly decodes UTF-8, and validates the complete
document against current consent. It then atomically commits manifest, receipt,
projections, dispatch intent, jobs and account change under the final tenant
fence. No R2 write is entrusted solely to `waitUntil`.

Selected-kind grants can upload an independently valid **single-chunk** document;
its entire field policy is verified before R2 PUT. Opaque multi-chunk documents
require all seven kinds because a fragment cannot prove complete document policy.
Unselected mixed JSON is rejected, not staged and later silently redacted.
Partial documents intentionally do not claim full content parity.

## Keys

`CONTENT_KEYRING` is a Worker secret containing JSON:

```json
{"current":1,"keys":{"1":"<canonical-base64url-32-byte-server-KEK>"}}
```

Never commit real key material. Each account/generation/key-version gets a random
DEK, stored only as an AES-256-GCM wrapped record in D1. AAD binds account,
generation, key version and key ID for wrapping; raw encryption additionally
binds object key, source revision and schema version. Every object gets a fresh
96-bit nonce. Returned keys are non-extractable. Managed content is server-readable.

Changing `current` affects new writes. Retain older KEKs while any retained object
references their DEKs. Reads never generate a replacement for a missing old key.
Key removal is not safe rotation or crypto-erasure of historical backups.

## Orphans, late PUTs and purge

R2 success/D1 failure leaves the original intent and immutable object for retry
or cleanup. Cron retries bounded sweeps; active unfinished inputs become eligible
after 24 hours, while closed generations are eligible immediately. A D1 purge
claim prevents a concurrent manifest from committing a chunk while it is deleted.
Committed active manifests are never orphan-GCed.

Purge intents survive successful DELETE. A timed-out PUT can finish afterward;
later sweeps still discover/delete it. A monotonic scan order rotates bounded
pages rather than permanently revisiting only the first page. This is not proof
that every backup/local copy has been purged; P14 owns the independent deletion
ledger, retention release gate and complete recovery policy.

## Resources and activation gate

Private R2 bucket: `skillar-activity-raw`, iyen account
`8277c1acc712e4a9d00479255015c200`, APAC location **hint**, Standard class.
Public r2.dev access is disabled and no custom domains are connected. A location
hint is not a contractual residency guarantee.

Activity migration `0002_content.sql` is additive on `ACTIVITY`. Browser consent
migration `site/migrations/0003_activity_consent.sql` is additive on `ACCOUNTS`.
Existing Google users/sessions/auth routes are unchanged. Production application
and enabled deployment must be explicitly recorded at P8, together with login
HTTP/logged-in smoke and actual D1/R2/DO usage. No such activation is claimed here.
