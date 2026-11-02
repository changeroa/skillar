# P4: local CDC, snapshot and durable outbox

P4 is an offline library foundation. It adds no sender, daemon timer, CLI command,
cloud connection or automatic consent. P5/P6 own those integrations.

## Source history

Migration 007 installs `sync_journal` and three SQL triggers for every target:
skills, sessions, events, loads, eval_cases, otel_spans, herdr_workspaces,
herdr_tabs, herdr_panes, pane_sessions, workflow_specs, flows, flow_steps,
load_candidates and recording_clock. `meta` is local configuration/counters;
FTS tables and the candidate view are rebuildable indexes, not separate facts.
The migration registry installs the generated triggers within the same migration
transaction. Always use `openDb`, which enables recursive triggers (including
REPLACE deletes) on each connection.

Each trigger appends a full stored after-image or a tombstone with a local-only
before-image in the source transaction. Primary-key moves tombstone the old key.
Foreign-key cascades and existing recording/candidate triggers are captured.
Reading the live row **inside the trigger**, rather than copying `NEW`, avoids
stale outer images when another AFTER trigger already updated it.

`journalHead` returns a committed cut and immutable database-lineage identity.
`readJournal({after, through, limit})` selects each entity's last image inside
that fixed cut, ordered by its final revision. A continuation uses the last
returned revision as `after`, keeping `through` unchanged. Never manufacture a
cut from an intermediate journal row or call these APIs during a source
transaction. Journal images are retained; later edits/deletes cannot change
earlier cuts. Revisions, journal sequences and recording-clock positions remain
distinct. No journal compaction is implemented; disk usage needs operational
monitoring until a verified snapshot/receipt retention policy exists.

## Logical snapshot

Use `logicalSnapshot` on a **dedicated reader connection**. Its first SELECT
inside `BEGIN` pins both cut C and source rows. The generator yields bounded
chunks with snapshot ID, index, source domain, cut, record count (array length),
UTF-8 byte count and SHA-256 of the exact JSON record array. All snapshot rows
have revision C; CDC after C has strictly greater revisions.

Source rowid is explicit `sourceOrder`; the WITHOUT ROWID candidate table uses
composite-key order and null sourceOrder. All SQL values, JSON strings,
spec digests, recording domains/vectors, old zero marks and null boundaries are
preserved, without reconstructing unknown history. A final-value/hash comparison
can apply tombstones and upserts from CDC to the snapshot.

Exhaust or explicitly `return()` the iterator to release its read transaction.
Default read lifetime is 30 seconds, checked at each record; pausing a consumer
cannot be forcibly interrupted by this synchronous API. WAL readers pin files,
so integrations must also bound consumer pauses and monitor WAL growth. Default
chunks are at most 100 records and 256 KiB of record-array JSON. Oversized records
raise `record_too_large` (P5 supplies content chunk manifests), never truncate.

## Consent and outbox

`spoolBatch` defaults to local-only and returns null before serializing records,
resolving membership, creating streams or storing **any cloud payload bytes**.
The raw journal remains local capture, not a pre-consent cloud spool.

Callers supply a fixed journal interval and a bounded page, current explicit
consent, upload scope, and a synchronous `scopeFor` resolver proving each record's
source project/root membership. Resolve from retained source facts, including
`beforeValues` on deletes, never from the upload's asserted label. Historical
timestamps are checked against the grant's live/backfill range. A tombstone
without its authorization before-image is rejected. Resolvers must fail closed
for unknown membership; P4 cannot infer project identity from arbitrary schema
keys. Timeless facts need the same externally proven membership.

The consent shape and authorization match shared P1. The standalone local
package's NodeNext rootDir/published files do not include the unpublished shared
package, so the small consent boundary is local with cross-contract tests.
The all-table outbox envelope is explicitly **not** `ActivityBatch` or an HTTP
wire contract: shared P1 metadata DTOs currently cover only session/event/span.
P5 must adapt/extend wire contracts before uploading these records.

Metadata mode is a closed numeric/null column allowlist. Raw keys can be paths,
URIs or user text, so metadata hashes `table + NUL + source key` with SHA-256;
upsert/delete identities remain stable. Before-images never enter the spool.
Metadata does not offer full relationship/content parity. Full rows and original
keys require managed-content acknowledgement and **all seven content kinds**,
because unrestricted nested JSON may contain any kind. Partial raw selection
fails explicitly; P5/P6 need selected-kind, typed transformations for consent UX.
This conservative policy is not redaction or E2EE.

Outbox JSON is transformed before its immutable insert. Bounds include the whole
envelope, not just its records: default/hard ceilings are 100 records/256 KiB,
and explicit quota defaults are 1024 pending batches/64 MiB. Over-limit pages,
single records or envelope overhead fail explicitly; callers split pages or use
P5 chunk manifests. There is no silent truncation or automatic data dropping.
Quota failure rolls back sequence allocation. Batches bind device and source
lineage, retain exact bytes/hash/batch ID across restart and link contiguous
journal intervals.

`pendingBatch` exposes only sequence `ack + 1`. `acknowledgeBatch` accepts the
matching hash for exactly that next batch and atomically advances the durable
ack/cut and removes its spool. Repeating the most recent ACK is idempotent.
Future, stale or mismatched receipts cannot skip a batch. The caller must verify
remote durable receipts and recheck current consent/revocation before sending;
there is deliberately no network sender or remote-acceptance claim here.

Version 7 history exports/imports keep existing portable history semantics and
do not import another database's journal, outbox, receipts or source identity.
