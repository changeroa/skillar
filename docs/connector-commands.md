# Durable connector commands

`shared/activity-commands.ts` is the wire authority. Operations use `kind` and
direct fields (not an `input` wrapper):

- `workflow.put {spec}` preserves the Local workflow schema, defaults and unique step IDs.
- `flow.create {workspaceId,tabId?,spec:{name,version?},label?}`
- `flow.map-step {flowId,paneId,stepId}`
- `flow.end {flowId}`
- `eval.add {query,expectedUri?,fromTraceId?}` creates a **source-local** eval case;
  it is not the existing cloud-owned dashboard eval endpoint.

## Routes and exports

`commandsRequest(request, env): Promise<Response | null>` in
`worker/src/activity/commands.ts` recognizes these exact internal POST paths:

| Path | Body | Success |
| --- | --- | --- |
| `/v1/activity/commands/enqueue` | `SourceCommandRequest`: `{profile:{deviceId,sourceDomain},commandId,baseRevision,operation}` | 202 `CommandStatus` |
| `/v1/activity/commands/status` | `CommandStatusRequest`: `{profile,commandId}` | 200 `CommandStatus` |
| `/v1/activity/commands/poll` | `CommandPollRequest`: `{sourceDomain}` | 200 `{command: SourceCommand \| null}` |
| `/v1/activity/commands/ack` | `CommandAck`: `{sourceDomain,...CommandResult}` | 200 `CommandStatus` |

The shared module exports each corresponding camelCase schema, plus
`sourceOperationSchema` / `SourceOperation`, `sourceCommandSchema` /
`SourceCommand`, `commandResultSchema` / `CommandResult`,
`commandStatusSchema` / `CommandStatus`, and the workflow schemas
`commandWorkflowStepSchema` and `commandWorkflowSpecSchema`.

Delivered `SourceCommand` has `accountId,generation,deviceId,sourceDomain,
commandId,baseRevision,operation,payloadHash,expiresAtMs,consentVersion`.
`CommandResult` has `commandId,payloadHash,state,sourceRevision,result,error`;
terminal state is `applied`, `conflict`, or `rejected`, result is a JSON record
or null, and error is a string or null. `CommandStatus` has
`commandId,state,baseRevision,sourceRevision,result,error`; pending has null
sourceRevision, result and error. There is no success inferred from an upload.

`canonicalCommandPayload(request): string` parses the request, applies workflow
defaults, and recursively sorts object keys by UTF-16 code-unit order while
preserving array order. `payloadHash` is lowercase SHA-256 hex of that string's
UTF-8 bytes. The connector reconstructs `profile` from the delivered
deviceId/sourceDomain. `canonicalCommandJson` is the same serializer without
request parsing and is used for exact ACK outcome hashes.

## Authority and durability

The service accepts only `https://activity.internal`, a deployment-matching
issuer and a strict device-shaped `x-skillar-principal`. Pages must replace that
header after authentication. Browser forwarding uses the existing session and
downscopes to `activity:read`; no device bearer goes to the browser. Connector
poll/ACK require both `activity:read` and `activity:ingest`.
`ACTIVITY_INGEST_ENABLED=true` is required for enqueue/poll/ACK. Status remains
read-only while disabled, but still rechecks all authority and consent.

All operations require the active tenant generation and latest primary
ACCOUNTS managed-content consent: all seven content kinds, the selected device,
`device:<deviceId>` project, empty rootIds, and the original consent version.
Full content consent is deliberate because operations and arbitrary source
results/errors can contain mixed private content. Retention is the minimum of
30 days, contentDays and projectionDays. New grants do not revive old commands.

Migration `0010_connector_commands.sql` stores identities, hashes, counts,
revisions, states and encrypted-object descriptors only. Raw specs, query,
paths, result records and error strings never enter D1. Existing account
envelope encryption binds ciphertext to account, generation and object key.
R2 PUTs are conditional and first-writer bytes are decrypted and hash-checked.

A SQLite partial unique index permits one `writing`/`pending`/`acking`
reservation per account/generation/device/source. The insert trigger atomically
compares baseRevision against the maximum of the projected source journal head
and all successful source-ACK cuts. Missing source heads and stale bases return
409 `command_conflict`. Duplicate IDs with identical canonical payload replay;
changed payloads conflict. Only terminal source ACK releases a live reservation.
An applied no-op at the same cut permits another command at that cut.

The intent is committed before R2. Exact enqueue retry repairs interrupted
publication; poll can finish publication if R2 arrived before a worker crash.
Missing unfinished bytes yield no delivered command. Repeated polls deliver the
same command, never a lease or a newly generated identity. ACK reserves its
exact outcome hash before storing encrypted result bytes; only verified bytes
publish a terminal status. Lost ACK responses and interrupted ACK publication
retry exactly; any changed outcome is 409. The source remains responsible for
atomic cut comparison, actual application and durable receipt before ACK.

## Integration owned by the parent / P14

The parent calls `commandsRequest` from content-api before its ordinary route
dispatch, wires the four authenticated Pages forwards, and applies the new
ACTIVITY migration. The parent implements explicit local commands.json opt-in
bound to connection instance, validates connection/account/generation/device/
source/expiry/consent, and executes source-cut CAS, mutation and receipt in one
daemon-main-thread SQLite transaction. The receipt is excluded from CDC/export.
Use the existing bounded 30-second sync cadence; no always-awake Durable Object.

`sweepCommands(env, {limit?: number, now?: number})` in `commands-cleanup.ts`
is the bounded P14 cleanup hook (default 100, maximum 1000 rows per call).
It checks current fences and consent, marks purging before deletion, deletes
both encrypted objects and retains/rotates descriptors after purge. Recurring
invocation is necessary: timed-out PUTs can complete after deletion. Every
visited row rotates, including retained rows, so active records cannot starve
cleanup. Retain the source-ACK watermark metadata when later compacting rows.
The existing Activity cleanup cron invokes this hook alongside content and
private-pack cleanup. P14 must include its metadata in the account-deletion
lifecycle and preserve descriptors through late PUT cleanup. Read/write gates
deny revoked or expired data immediately, independently of the cleanup sweep.
