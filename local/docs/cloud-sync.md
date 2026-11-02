# Cloud sync and recovery

Cloud sync is optional. Local capture, the local dashboard, and Google sign-in do
not enable uploads. A device connection and an explicit account consent are
separate steps. The daemon runs transport in a worker thread only while an
account-issued device credential exists.

## Connect and choose coverage

1. Obtain a one-time device grant from the signed-in account's device API.
2. Save it in a private local file and run
   `skillar sync connect --grant-file <path>`. This exchanges the grant and saves
   the device credential with mode `0600`; it does not grant raw upload.
3. For historical upload, run `skillar sync prepare`. This makes a private,
   consistent **local** SQLite backup and prints its snapshot ID, source domain,
   journal cut, and expiry. No historical data is sent by preparation.
4. Grant `managed-content` for the selected device, content kinds, and time range
   in the account consent API. Whole-device transport uses the explicit project
   scope `device:<deviceId>` and an empty root restriction list. A project-only or
   root-only grant is not treated as permission to upload the whole device.
   Historical consent must identify the prepared snapshot and its exact cut.
   The account stamps the consent time; local `captureLevel` is not consent.
5. `skillar sync run` performs one bounded unit. The running daemon continues
   work automatically. `skillar sync backfill` schedules the prepared historical
   snapshot without resetting an existing live cursor. The daemon also notices a
   newly granted prepared snapshot automatically. After five live batches,
   a backfill page gets a turn, so live traffic cannot starve historical work.

Without historical permission, the initial cloud baseline is empty at the
current local cut. Only subsequent changes inside the consented time range can
be sent. Out-of-range records are counted as excluded; this is reduced coverage,
not full-history parity. Selected content kinds keep only their permitted
columns. Full-fidelity recovery requires all seven raw-content kinds and a
complete historical snapshot. Metadata mode is explicitly reported as
`metadata-only`; this raw transport does not mislabel it as full-content sync.

The first binding to a new device connection forks the source and future
recording domains. It preserves existing row vectors and the recording clock's
monotone high-water mark. Restored databases get fresh local domains and do not
inherit a device credential, transport queue, or acknowledgement.

## Durable progress and failures

`skillar sync status` prints connection identity and progress, never the token.
The source database contains only its transaction journal. A separate private
`cloud/spool.sqlite` contains exact request bytes, referenced blobs, sequences,
and ACK cursors in one SQLite transaction. Restarting a process retries the same
bytes. A chunk or page ACK is not a snapshot ACK, and only a verified durable
receipt advances a cursor. The spool has a fenced single-writer lease.

429 and 5xx responses persist Retry-After plus bounded jitter as a future
scheduling time. There is no sleeping HTTP retry. Authentication, consent,
permanent schema errors, local pressure, and unsafe redirects are visible
states; pending bytes are not skipped. `skillar sync run --resume` explicitly
retries a quarantined job or clears a pause. A changed consent version cannot
silently authorize an older pending request.

Current bounded contracts allow 10,000 rows and 16 MiB per snapshot, 128 snapshot
pages, 128 chunks, 100 rows per page, and a 64 MiB local spool. A single large row
can span multiple 128 KiB content chunks. Exceeding a bound fails explicitly
without truncation or an advanced ACK. Prepared local backups expire after
24 hours; already-spooled jobs remain resumable. The SQLite backup API restarts
its copy on concurrent writers; its completed copy supplies both rows and cut.

## Pause, rollback, disconnect, and reverse restore

`skillar sync pause` prevents further delivery without changing local capture.
`skillar sync rollback` pauses locally and marks the latest prepared migration
for rollback. Unaccepted staging is abandoned. An accepted snapshot and its live
cursor remain intact and exportable. Neither command deletes accepted history.
`skillar sync disconnect` removes the local device credential; source history,
prepared backups, and durable pending bytes remain local.

To recover into a **new** database:

```sh
skillar sync restore --destination ./recovered.sqlite \
  --source-domain <source-domain> --snapshot-id <snapshot-id>
```

The authenticated read API exports the original snapshot and a fixed contiguous
CDC range, including raw values, tombstones, source row order, and recording
vectors. The client verifies each payload, whole-snapshot counts/hash, sequence
continuity, SQLite integrity, foreign keys, and the restored dataset. It rebuilds
FTS from restored skills and publishes the new file only after verification.
Existing destination files are never replaced. Read-only recovery remains
available with ingestion disabled, but still requires current account/device
authorization and consent.

A historical snapshot older than an empty future-only cloud baseline may have a
gap before the first uploaded CDC batch. Recovery rejects that gap instead of
claiming completeness; prepare a new snapshot after the live baseline to create
a recoverable backfill. Partial content projections and snapshots without the
recording clock cannot be used for full-fidelity recovery.
