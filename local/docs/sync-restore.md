# Local logical restore

`dist/sync/restore.js` restores complete logical snapshots into a **fresh, migrated
v7 database**. It does not merge history, replace an existing file, configure roots,
run recorded commands, or restore credentials. All runtime imports are inside the
local package; no sibling shared source is required.

## API

```ts
import { openDb } from "./dist/store/db.js";
import {
  restoreSnapshot, applyCatchup, verify,
  type RestoreDescriptor, type Catchup,
} from "./dist/sync/restore.js";
import type { SnapshotChunk } from "./dist/sync/snapshot.js";
import type { Db } from "./dist/store/db.js";

// Exact public argument signatures:
// restoreSnapshot(db: Db, input: RestoreDescriptor, pages: Iterable<SnapshotChunk>)
// applyCatchup(db: Db, input: Catchup)
// verify(db: Db, input: RestoreDescriptor)
//
// All return synchronously:
// { sourceDomain: string, cut: number,
//   counts: Record<string, number>, hash: string }
//
// RestoreDescriptor:
// { readonly sourceDomain: string; readonly cut: number;
//   readonly counts?: Record<TargetTable, number>; readonly hash?: string }
//
// Catchup:
// { readonly sourceDomain: string; readonly after: number; readonly cut: number;
//   readonly records: Iterable<Mutation>;
//   readonly counts?: Record<TargetTable, number>; readonly hash?: string }

const db = openDb("/new/location/restore.db");
try {
  restoreSnapshot(db, snapshotDescriptor, downloadedSnapshotPages);
  applyCatchup(db, {
    ...finalDescriptor,
    after: snapshotDescriptor.cut,
    records: completeCommittedCatchup,
  });
  verify(db, finalDescriptor);
} finally {
  db.close();
}
```

The example's descriptors and downloaded records are caller-provided verified
transport inputs; this module does not perform network requests or decoding.
`TargetTable` and `Mutation` are exported by `dist/sync/tables.js`.

Use a dedicated offline connection. The destination must have no source facts,
meta configuration, transport streams/outbox/journal, previously consumed journal
sequence, previous restore, or advanced recording clock. Its existing fresh
`sync_identity` and singleton `recording_clock` are expected. An active caller
transaction is refused without rolling it back.

## Transfer and verification contracts

Snapshot pages use the existing `logicalSnapshot()` shape. Page indices must be
contiguous from zero, with one snapshot ID/domain/cut. Each page's byte length and
SHA-256 cover `JSON.stringify(page.records)`. Every row must be an upsert at the
snapshot cut. Duplicate entity keys, partial/extra SQL columns, mismatched keys,
invalid rowids, missing source clock and broken foreign keys fail the restore.
Revision **0**, cut **0**, rowid **0**, vector marks **0**, and nullable historical
boundaries are legitimate and remain distinct.

Supply `counts` and `hash` whenever completeness must be verified. Counts contain
all 15 table names, including zero counts. The descriptor hash is SHA-256 of
`JSON.stringify(allRecords)`, with records concatenated in `logicalSnapshot()`
order: target table order, then source rowid (or primary key for
`load_candidates`). Each record has the snapshot's revision and the existing
Mutation fields, including `beforeValues: null`. This is an aggregate record
hash, **not** a hash of concatenated page hashes, and does not depend on page
sizes. `verify()` recomputes this canonical hash from stored rows and source-clock
provenance. It also runs SQLite integrity and foreign-key checks.

Counts/hash are optional for trusted local callers; without them, page integrity,
exact storage equality, SQL constraints and foreign keys are checked, but a
transport that omitted whole pages or entities cannot be detected. Do not claim
remote transfer completeness without the expected descriptor.

Catchup consumes **one entire committed source range**, not an arbitrary page:

1. Pin a source `journalHead()` cut `C`.
2. Gather all `readJournal({ after, through: C, limit })` pages, advancing the
   paging cursor to the last returned revision until exhausted.
3. Call `applyCatchup({ sourceDomain, after: previousVerifiedCut, cut: C, records,
   counts, hash })` once, with the final source descriptor at `C`.

Records must be globally ascending by revision, strictly above `after` and at or
below `cut`; each entity occurs only once, as in a coalesced journal range.
Sequence gaps are legal because coalescing removes intermediate images.
The domain and previous verified cut must match persisted restore state.
An empty same-cut range is valid. Replaying an older range is refused rather
than silently overwriting a newer restore. Final rows are rewritten as a set
inside one transaction so rowid reuse, key moves, uniqueness changes and
foreign-key dependencies cannot make arrival order change the result.

Catchup is restricted to the offline restore phase. Once normal local collection
has advanced the local clock or journal (or created a stream/configuration),
further source catchup is refused. It is not a bidirectional merge API.

## Identity, exact values and provenance

All 001–006 source columns, source keys, rowids, original recording vectors,
candidate membership, workflow bodies/digests and unknown flow boundaries are
restored exactly. SQLite type-affinity changes are detected by comparing stored
scalars with the input images. No arrival vectors are added, and no historical
cuts are inferred from timestamps.

Source `recording_clock` is the sole exception to placement: its exact complete
Mutation is persisted as `sync_restore_state.clock_json`, together with source
domain and verified cut, rather than replacing the local clock. `verify()` uses
that source clock image when reproducing the original logical export hash. The
destination keeps its independently generated recording domain and position;
the source sync identity, journal, streams, ACKs, outbox, configuration and
credentials are never imported. A regular `logicalSnapshot(destination)` exports
the destination's own lineage/clock, so its hash is intentionally different from
the source-provenance hash.

Recording, candidate and CDC trigger definitions are captured from
`sqlite_schema`, dropped **inside** the write transaction, and recreated from
their exact SQL in their existing creation order. This prevents generated arrival
marks or candidate reconstruction from replacing original facts. Rollback
restores the trigger definitions automatically. FTS is rebuilt from restored
active skills; source FTS internals are not copied.

After reopen, ordinary collection uses the destination recording domain and
journals normal local changes. Existing source vectors stay unchanged. Normal
store startup behavior still applies; use a snapshot from a canonical migrated
source, not a manually fabricated store with split-session duplicates that
`openDb()` would normalize on reopen.

## Failure and resource limits

Snapshot restore and each catchup range use separate `BEGIN IMMEDIATE`
transactions. Parsing errors, iterator failures, bad hashes/counts, SQL failures
and verification failures roll back rows, restore state, FTS and trigger DDL.
Other SQLite readers see only committed states. A failed catchup leaves the
previous verified snapshot/cut intact and can be retried. Source databases/files
are never opened or modified by these APIs. Existing destination data/files are
never deleted or replaced.

The caller creates and owns the new database file. Failed restore may leave that
fresh migrated empty file; there is no file replacement/publication API here.
Do not expose the new destination to normal collection until the final catchup
and verification succeed. To publish under another application path, the owner
must coordinate database closure and SQLite sidecars; renaming a live WAL file
alone is not publication.

This implementation materializes the complete restored record set in memory
and rewrites it during each catchup range. It favors exact offline recovery over
incremental write performance; it is not a bounded-memory restore engine.
Existing snapshot limits still apply upstream (100 records/256 KiB per page,
individual oversized records require the owner's chunk transport). The restore
layer accepts already reconstructed larger records without truncation. It does
not implement transport authentication, deletion ledgers, chunk reconstruction,
CLI commands, path remapping, or cloud generation fencing.

`RestoreError.code` distinguishes `destination_busy`, `destination_used`,
`invalid_snapshot`, `invalid_record`, `verification_failed`, `invalid_catchup`,
and `restore_missing`. Zod parse errors, SQLite errors and iterator errors retain
their original types and details.
