# Local command authority

Remote workflow, flow and source-local eval writes are commands, not edits to a
cloud snapshot. A browser receives `pending` until the selected Local source has
committed both the mutation and its durable receipt. An offline source remains
pending. The existing cloud-owned eval save remains a separate operation.

The source must first have a connected device, a completed managed-content sync,
and device-wide consent for all content kinds. Remote command execution is
**disabled by default**, independently of upload consent. On the selected device:

```sh
skillar sync commands --enable
skillar sync status
```

This grants the signed-in account permission to submit workflow creation/version
updates, flow creation/step mapping/end, and local eval-case additions to this
source. It does not execute shell commands, install integrations or change local
skill files. Approval is bound to the current connection instance. A new
connection, account or device cannot inherit it.

```sh
skillar sync commands --disable
```

Disabling approval or pausing sync prevents application even if a command poll
was already in flight. Re-enable explicitly after a connection replacement.
The daemon's existing bounded sync turn checks commands at its normal 30-second
idle cadence; no new WebSocket, continuously awake Durable Object or polling
daemon is introduced. `sync run` by itself uploads data; source application is a
daemon main-thread operation.

## Revision and crash contract

`baseRevision` is the selected source's exact CDC journal cut, not a cloud time,
workflow version number or recording-clock position. An intervening local write
can conservatively cause a conflict even if it changes a different entity.
Refresh source profiles and review the current source state before submitting a
new command ID. Retry an uncertain submission with the **same** command ID and
payload.

The main thread rechecks connection ownership and approval before application.
Inside one `BEGIN IMMEDIATE` transaction it checks source lineage and journal
cut, invokes the existing store operation, and inserts the command result.
Workflow digests/defaults and flow registration/end recording vectors are
therefore determined by the same Local store as local HTTP writes.

A crash before commit leaves neither a mutation nor a receipt. A lost ACK after
commit replays the stored result without repeating the mutation. Connector
receipts are not CDC source tables and are never adopted by portable history
imports. Local full-database backups can retain receipts for the same source.

`cloud/command-status.json` contains only the last command ID, state and error
code, not its operation or result. Network failures leave the durable server
queue responsible for redelivery; an unavailable main-thread RPC never produces
an applied ACK.

## Additive migration and rollback

Local migration `008_connector_commands.sql` adds a receipt table only. It does
not rewrite history, delete source rows or move recording clocks. The portable
history reader accepts schema 8 and still imports only its explicit history
allowlist.

Before rolling back a Local binary, run `skillar sync commands --disable`.
Preserve the source database and receipt table; do not roll back by restoring an
older snapshot over newer source history. Use a schema-8-capable binary for
portable-history import. On the cloud side, stop new writes with the existing
ingest switch, retain additive command tables and encrypted upload descriptors,
and deploy only within the coordinating lane's production slot. Never rotate
Google/session/content secrets as a feature rollback.
