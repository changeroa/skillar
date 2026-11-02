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

## Read-only CDC export (P6 reverse restore)

`POST https://activity.internal/v1/activity/export` is service-binding-only and
uses the existing internal authenticated device principal with `activity:read`.
It stays readable when ingest is off, just like migration export. This does not
add a public route, proxy, cross-device grant, or permission to read arbitrary R2
keys. Account identity is exclusively the principal's account.

The strict JSON request is:

```ts
{
  deviceId: string; sourceDomain: string; generation: number;
  consentVersion: number; projectId: string; rootId: string | null;
  range: { fromMs: number; toMs: number };
  backfill: { version: number; snapshotId: string; journalCut: number } | null;
  afterSequence: number; throughSequence?: number; limit?: number;
}
```

`afterSequence` is exclusive; `throughSequence` is inclusive and defaults to the
observed source head. Save that returned ceiling and pass it on every resumed
page. `limit` defaults to 1 and is an integer in 1..4 (at most 64 MiB of decoded
document JSON plus envelopes per page, under the existing 16 MiB/batch limit).
All sequence numbers are nonnegative safe integers. A ceiling above the observed
head, a missing nonzero resume anchor, or a sequence gap returns 409
`sequence_gap`. Invalid input returns 400. Missing accepted content returns 409
`content_missing`; inconsistent immutable envelope/receipt returns 409
`content_conflict` (including journal discontinuity). Existing fence, consent, field-policy and crypto errors retain
their existing codes. No partial successful page is returned on failure.

The exact successful JSON response contract is:

```ts
type Cursor = { sequence: number; journalThrough: number };
type ExportPage = {
  schemaVersion: 1;
  deviceId: string; sourceDomain: string; generation: number;
  afterSequence: number; throughSequence: number;
  start: Cursor | null; // cursor at afterSequence
  cursor: Cursor | null; // last returned batch, or start on an empty page
  head: Cursor | null; // observed live device_streams head, not account change head
  hasMore: boolean; // cursor.sequence < throughSequence
  batches: Array<{
    batch: ContentBatch; // original shared v2 envelope, journal (from, through]
    receipt: IngestReceipt; // original projected receipt including payloadHash/changeSeq
    document: ContentDocument; // exact decrypted shared v2 document, no redaction
  }>;
};
```

The cursor fields are null only for an absent source stream (with ceiling 0 and
no batches); a published baseline can instead have sequence 0 and a nonzero
journal cut. Clients verify consecutive sequence numbers starting at
`afterSequence + 1`, each `batch.journal.from === previous.journalThrough`,
receipt/envelope identity, and the final cursor/ceiling. Envelopes are reconstructed
from immutable ledger metadata and manifests and checked against the original
receipt payload hash. Chunk object keys and encryption material are not returned.
`document` preserves exact parsed values, including Unicode, control characters,
opaque JSON strings, nulls, numeric values and tombstones; original JSON whitespace
is not exported.

The request scope authorizes the read, including empty pages. Each returned batch
is independently checked against its original scope and the current primary-D1
consent, including current field policy; scope is not an omission-producing
filter. Consent and the tenant fence are checked again after R2 reads. Uploads
without accepted receipts and snapshot pages are never CDC batches. A metadata-only
receipt in the interval fails closed instead of being silently skipped.

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

Private R2 bucket: `example-activity-raw`, iyen account
`00000000000000000000000000000000`, APAC location **hint**, Standard class.
Public r2.dev access is disabled and no custom domains are connected. A location
hint is not a contractual residency guarantee.

Activity migration `0002_content.sql` is additive on `ACTIVITY`. Browser consent
migration `site/migrations/0003_activity_consent.sql` is additive on `ACCOUNTS`.
Existing Google users/sessions/auth routes are unchanged. Production application
and enabled deployment must be explicitly recorded at P8, together with login
HTTP/logged-in smoke and actual D1/R2/DO usage. No such activation is claimed here.
