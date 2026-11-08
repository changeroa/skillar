# Native fixture replay benchmark

From `worker/`, using the already installed repository dependencies:

```sh
node scripts/parity-replay-benchmark.mjs --accounts=2
node scripts/parity-replay-benchmark.mjs
```

The default runs separate 10, 100, and 1000 account scenarios, sequentially.
`--accounts=1,2,10` selects smaller smoke scenarios; each count must be 1..1000
and at most 10 scenarios may be selected. No packages, credentials, deployed
resources, owner data, Oracle, or external services are needed.

Each scenario creates its own native Miniflare runtime through the existing
`activity-migrations` fixture. It uses real Worker execution, D1, encrypted R2
content, and a native ReportFlow Workflow. Accounts use fresh run UUID namespaces;
device, source, snapshot, session, CDC batch, and report IDs intentionally overlap
between accounts. The script asserts account-specific report content, complete
coverage, one CDC receipt per account, and identical duplicate acknowledgments.

Per account, the workload grants synthetic managed-content consent, publishes a
snapshot containing a session and recording clock, uploads and commits a session
update twice, captures runtime context at that cut, and requests/downloads a sessions
report. This representative report exercises snapshot-plus-CDC reconstruction.
It does not replay every parity golden or simulate a full day of user traffic.
Accounts run serially against one activity database, not the proposed 16-shard
production topology. Inputs and ordering are deterministic; UUIDs, encryption,
timestamps, and measured durations are naturally different between runs.

## Output and measurement boundaries

Success writes one bounded JSON object to stdout, with aggregate metrics per
scenario and no per-account payloads, SQL, raw prompts, or keys. Failure writes
an error JSON object to stderr and exits nonzero. There are no workspace artifact
writes. Miniflare uses its default temporary ephemeral storage, cleared by
`dispose()`. Runtime disposal and loopback callback server closure run in
`finally`, including failure paths; `disposed: true` is emitted only after cleanup.
Abrupt OS termination cannot run JavaScript cleanup.

- `requests` counts completed host dispatches by path. `fixture:*` paths are
  internal fixture controls (snapshot summary/begin/page/complete), not public
  requests. Query/status/result are real content-service routes. Workflow
  invocation and its loopback completion callback are not added as HTTP
  dispatches. These counts are **not billable Worker invocations**.
- `timingMs` uses host monotonic wall time. Request p95 includes response body
  consumption. Account p95 includes packet creation, consent setup, all replay
  calls, and report completion/download. Report p95 is end-to-end wall time.
  Nearest-rank p95 is selected from sorted observations; at small counts it is
  effectively the maximum. No fixed sleeps or completion polling are used:
  the Workflow completion event is subscribed before query submission with a
  bounded 30 second timeout.
  The benchmark subclass disables Workflow retry backoff so a failed native
  attempt fails the smoke instead of hiding the failure behind delayed retries.
- D1 binding proxies preserve native `first`, `all`, `run`, and `batch` execution.
  Native result `meta.rows_read` and `meta.rows_written` are accumulated in
  `observedRowsRead`/`observedRowsWritten`, never inferred from logical mutations,
  SQL text, `changes`, or input row counts. `first()` and `raw()` hide metadata;
  `withoutMetadata` records those calls. `rowsRead`/`rowsWritten` are null when
  any statement hides or omits that field. Observed partial sums are **not total
  billed rows**. Both ACCOUNTS and ACTIVITY workload binding calls are included.
- R2 counters observe attempted and successful native methods across HTTP replay
  and Workflow processing. Class A attempts are PUT+LIST; Class B attempts are
  GET+HEAD, including missing-object reads. DELETE is recorded separately. These
  are emulator operation counts, not a provider invoice. Conditional failures
  still count as attempts. Final encrypted `storedBytes` and object count come
  from a paginated native R2 inventory after workload completion. That diagnostic
  LIST, receipt-count SQL, and metrics/reset calls are excluded from workload
  counters.
- Migrations, initial user/account/device/fence provisioning and synthetic consent
  inserts performed by fixture host helpers are excluded from D1 workload metrics.
  `setup` times runtime creation and migrations, not subsequent account
  provisioning. `replayWall` starts after account provisioning and includes
  synthetic consent setup. No cleanup operations are charged to the replay.
  `uniqueDocumentPlaintextBytes` counts snapshot and CDC documents once, not
  duplicate transmissions, runtime documents, encryption envelopes, or reports.

**All reported measurements are emulator metrics. Wall time is NOT billable
Worker CPU.** CPU, production billable request totals, D1 physical storage,
Workflow steps/state, monthly cost, and any unavailable billing dimension remain
null/unmeasured. No CPU estimate, fake SQL counts, dollar estimate, free allowance,
or account entitlement is derived.

## P14 release/cost interpretation

This harness is a measurement input for sections 8/9 of
`skillar-full-parity-arch.md`, not a full P14 release gate or production usage
model. It preserves existing fixtures and local semantics. Production CPU,
hidden D1 reads/writes and index/FTS amplification, actual request accounting,
sharding contention, Queues/DO/SSE, backups, retention/deletion, retries, provider
rounding, and other usage in the shared billing account remain conditional cost
risks. Storage is an end-of-run snapshot, not GB-months. Scaling these small
synthetic inputs into a monthly invoice or subtracting assumed available account
allowances would be unsupported. The parent owns the full-scale run and production
usage model.
