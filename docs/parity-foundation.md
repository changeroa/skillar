# Remote parity foundation

These are implementation foundations, not a connected remote dashboard.
Local-only remains the default. No new production route or Worker is deployed
by P0.

## P0: reproducible platform evidence

Run the existing local build before the local parity tests. The Worker suite
includes `worker/test/parity-platform.test.mjs`, which runs the real workerd D1
implementation and compares weighted trigram BM25 values against Node SQLite.
The shared fixtures are inputs and explicit expected results for later adapters.

The isolated `skillar-parity-probes` D1 database contains synthetic data only.
It is not ACCOUNTS or an activity shard. Reproduce its schema with:

```sh
cd worker
npx --no-install wrangler d1 execute PROBE \
  --config wrangler.parity-probes.jsonc --remote \
  --file scripts/parity-probe.sql --json
```

Wrangler file import reports aggregate metrics rather than query rows. To
inspect individual query results, use `d1 execute --command` with the SELECTs
from that file. Read each response's `meta.rows_read`, `meta.rows_written`, and
`meta.size_after`; these are measurements, not capacity estimates.

### Observed on 2026-11-02

Remote D1, primary APAC/ICN, compatibility date `2026-09-03`:

| Probe | Observed result |
| --- | --- |
| Initial schema/data import | 14 queries, 17 rows read, 14 rows written, 45,056 bytes |
| Weighted `workflow` query | name then body; 4 rows read, 0 written |
| Name BM25 | `-0.0000018673740053050398` |
| Body BM25 | `-0.0000011139240506329115` |
| JSON unknown / zero | `null` / `0`, preserved separately |
| Revision trigger | audit revision `2` |
| Additional single-row text index | 45,056 -> 49,152 bytes; 3 rows read, 2 written |
| Forced indexed scan | 1 row read, 0 written |

Index allocation above is a 4,096-byte **database allocation delta** for this
tiny corpus, not a general per-row index cost. FTS internal writes and multiple
indexes amplify production writes; later replay benchmarks must measure them.
SQLite `dbstat` and `PRAGMA page_count` are unavailable through workerd D1,
so the probe uses supported D1 response metrics rather than assuming local
SQLite introspection works remotely.

### Compatibility decisions

- FTS5 trigram and the local `(0,8,2,3,5,6,1)` BM25 weights agree on the
  synthetic corpus. Keep account/catalog-profile corpora separate: shared
  corpus statistics can change rank even after tenant filtering.
- D1 `lower('İSTANBUL')` produces `İstanbul`; JavaScript produces
  `i\u0307stanbul`. Therefore session `q` must use the exact Worker JavaScript
  predicate over each retained string, not SQL `lower`/`LIKE`, joined fields,
  or a truncated prefix. Trigram is only a candidate optimization when it
  cannot lose matches.
- JSON null and numeric zero are distinct. Legacy unknown recording marks
  remain unknown; arrival time or cloud row IDs cannot replace source order.
- D1 batch rollback covers trigger side effects as well as direct writes.
  This is a prerequisite for the later fence/receipt/projection/outbox ledger,
  not evidence that the ingest ledger already exists.

## Before and after

Before P0, only local tests established these semantics, and no actual D1
compatibility or allocation evidence was recorded. After P0, shared goldens
and the workerd probe run in runtime CI; the remote synthetic probe can be
repeated independently. Existing local behavior and hosted sign-in are unchanged.

### Local verification

On Node 24.15.0: final focused acceptance 54/54, existing Worker suite 100/100,
existing local suite 610/610, local build/typecheck, Worker typecheck, both
search benchmarks, plugin checks/build, and all three Worker dry runs passed.
The final golden harness has 250 nonblank, noncomment lines; split it by
contract before extending it.

The root verifier stopped at the unchanged server SSH-launcher test on this
macOS host: its hard-coded PATH selects `/opt/homebrew/bin/node` (26.6.0),
which aborts because `libsimdjson.33.dylib` is missing. The test also fails
alone, and invoking that Node binary reproduces the loader failure. This is
not hidden or skipped; the remaining verifier checks were run separately.
Linux CI remains the complete repository gate.

## P7: shared analysis and asynchronous reports

The local SQLite readers and the cloud fact adapter now use the same portable
session/flow assembly, findings, usage and comparison code. The cloud adapter
retains source rowids, recording marks, nulls and original JSON values; transport
order does not become source order. The exact SQL comparison also covers
runtime-index ordering, Unicode matching, timezone cells, membership boundaries,
request status and pagination ties.

The daemon captures active requests, ingest counters, timezone and source cut
on its main thread. The sync worker requests that capture over a correlated
MessagePort exchange only after an unrestricted raw-content grant. Runtime
snapshots use encrypted P5 chunks and an independent immutable sequence, so a
changed live request does not invent a CDC revision. The receiver records its
own receipt time: an ahead-of-server source clock cannot keep a report fresh.

### Report protocol

The existing authenticated activity service exposes:

- `POST /v1/activity/query`: prepare an encrypted request and return HTTP 202
  with a durable job reference.
- `POST /v1/activity/reports/status`: retrieve state, pinned source/runtime
  revisions, analysis version, freshness and the completed result manifest.
- `POST /v1/activity/reports/result`: retrieve one verified result part.

Queries cover sessions, trace, flow aggregation, heatmap, skill-week, stats,
flow lists/reports, session reports and skill usage. The shared report builders
include session/flow trees, findings, comparison, outside-workspace membership
and usage details. Missing or excluded objects retain the local error codes.

`REPORT_FLOW` is a native Cloudflare Workflow. Its parameters and step result
contain only job/tenant references and state, never the query or report body.
The job pins both source and runtime revisions before dispatch. Repeating the
same request ID retains those revisions; a different request under that ID
conflicts. A later capture makes the old result stale rather than silently
recomputing it with different inputs.

Raw requests/results remain encrypted in R2. D1 holds references, hashes,
leases, manifests and status. The result writer produces 128 KiB encrypted
parts and a native streaming SHA-256 digest without serializing the entire
report into a second full JSON buffer. Its 512 MiB output ceiling is a limit,
not a claim that a 512 MiB input dataset has been load-tested.

Current consent and generation fences gate submission, input reads, result
reads and publication. Report expiry is bounded by both policy and the oldest
raw upload used for the calculation; making a report does not restart that
input's retention period. The existing scheduled Worker recovers queued
dispatch and removes expired/closed-generation report objects, including
late encrypted PUTs whose intents were already recorded.

### Verification and activation

The native Workflow fixture uses real workerd D1/R2 and the production
`ReportFlow`, not a simulated Workflow result. On identical raw SQLite records,
74 HTTP report payload/error cases match the local readers, including two
encrypted multipart results. Separate cases exercise concurrent capture,
consent revocation, tenant/device/generation isolation, expired input before
decryption, closure after PUT, repeated orphan cleanup and dispatch recovery.
No Oracle service or credential is provided to these runs.

`worker/wrangler.activity.jsonc` binds `skillar-report-flow` and keeps
`ACTIVITY_INGEST_ENABLED=false`, no public routes and no workers.dev endpoint.
This PR supplies the report foundation; dashboard connection, production
activation, durable live replay and the remaining release/retention gates
belong to P8-P14. It does not upload the owner's local database.
