# Activity shard foundation (P3, extended by P5)

This AGPL-3.0-only module is an **internal metadata ledger**, not a public
ingestion endpoint or a connected dashboard. P5 adds a service-binding-only
content entrypoint; its ingest flag is false, Workers.dev/preview URLs remain
disabled, and routes are empty. No production activation is included. See
`CONTENT.md` for the private R2 transport. The server-defined shard is `activity-00`.

## Contract

`commitActivityBatch(db, {principal, batch, receivedAtMs})` accepts the verified
P2 device principal, checks ingest scope/device/generation/shard, and parses
the strict P1 metadata envelope. Caller-controlled tenant IDs are not accepted.
The caller must authenticate through P2; this library is not a serialized
identity-header trust boundary. P5's Pages proxy authenticates and replaces
identity headers before calling the nonpublic service entrypoint.

An active `tenant_fences` row must already exist for the account/generation.
The ledger never provisions or reopens a missing/closed fence as a side effect
of an upload. Control-plane account provisioning/deletion owns that state.

The receipt hash covers the normalized P1 DTO's JSON serialization, including
source namespace, consent version, range, sequence and journal cut. Receipts
retain that strict metadata JSON for replay after projections advance.
Arbitrary raw prompt/query/args/path/span attributes remain rejected by P1.
P5 adds separately durable immutable R2 inputs and a manifest in this same
transaction before acknowledging raw content. A v1 metadata receipt alone
remains no evidence of raw-content durability.

Each D1 `batch` atomically:

1. Checks the active generation, receipt identity/hash, and contiguous source
   batch/journal sequence.
2. Inserts a receipt with a server-generated unique commit ID. Retries do not
   acquire that ID and cannot repeat projection or notification side effects.
3. Applies revision-guarded typed session/event/span facts and tombstones.
4. Advances the source stream and writes jobs plus durable dispatch intent.
5. Increments the account head and appends its invalidation using a same-batch
   SQL subquery, not an interleaved client `RETURNING`/follow-up transaction.
6. Rechecks the final generation fence before marking the receipt projected.
   Only after the entire batch succeeds does the function return a receipt.

Same account/generation/device/domain/batch ID plus the same hash returns the
original receipt, including durable time and change sequence. Different content
under that ID throws `ActivityLedgerError` with status 409. Source sequence or
journal gaps also return 409; missing batches are not skipped or ACKed.
Generation/scope/device failures return 403. Other D1 failures propagate without
inventing a durable receipt.

## Projection semantics

All primary/unique keys include account, generation, device and source lineage.
An event's source key is unique only within that namespace. Cloud arrival row
IDs do not replace `sourceOrder` or the complete `recordingOrders` vector.
Typed indexed event columns retain source timestamp/order; JSON retains null,
zero and legacy order marks exactly.

Upserts only advance an entity's revision. Equal/stale revisions do not
overwrite facts. Tombstones retain deletion revision (and known event source
key) so stale aliases cannot resurrect deleted evidence. A stale delete cannot
remove a newer projection. Newer intentional mutations may advance past an
older tombstone.

Jobs and outbox rows are durable intent, not a claim that Queue delivery,
notification fan-out or report execution already runs. P5/P9/P13 wire those
consumers; receipts retain enough metadata input for their replay. Queue loss,
duplicate notifications and raw-object crash windows are later acceptance gates.

## Resources and migration

The new isolated D1 database is `skillar-activity-00`, initially with no tenants.
It is separate from `skillar-accounts` and the synthetic P0 probe. Apply its
additive migration only through the dedicated configuration:

```sh
cd worker
npx --no-install wrangler d1 migrations apply ACTIVITY \
  --config wrangler.activity.jsonc --remote
```

This command does not enable a Worker endpoint or modify Google auth storage.
Rollback keeps the service disabled and preserves receipts/journal inputs;
do not restore an old database over a closed deletion fence.

## Verification

Final strict shared/Worker typechecks passed. The full Worker suite passed
**128/128**, including 28 real workerd-D1 ledger tests and the existing 100
regressions. Tests include both maximum-size 100-record session and tombstone
batches, concurrent duplicate delivery, source/journal gaps, per-namespace
isolation, revision/tombstone/alias behavior, exact recording vectors and
null/zero, as well as late abort/fence/generation fault injection.

An independent script,
`/Users/iyen/.dori/state/lane-results/skillar-parity-p3-qa.mjs`, exercised the
bundled ledger in workerd with real D1 outside the test runner:

| Scenario | Observed |
| --- | --- |
| First metadata commit | 200 |
| Same-hash replay at a different receive time | Original identical receipt |
| Changed content under the same batch ID | 409 |
| Missing source sequence | 409, no skipped acknowledgement |
| Fence closed after change append | 403; receipt/head/projections rolled back |
| Retry after removing the injected failure | 200 |
| Equal-time reverse arrival | Source order `earlier`, `later`, not arrival order |
| Final durable effects | 2 receipts, 2 jobs, 2 outbox rows, change sequence 2 |

The new remote D1 migration was applied on 2026-11-02: 15 commands succeeded;
`migrations list` reports no pending migration. Live primary APAC/ICN inspection
showed 0 tenants, 0 receipts and 143,360 allocated bytes. All behavioral/fault
tests use disposable local D1 instances, not remote user data. No endpoint or
Worker deployment was performed.

Production sources are 82/73/32 pure LOC (ledger/projections/types). The ledger
test module is at 242 pure LOC, within the warning band; split by behavior
before extending it.

## Before and after / 이전과 이후

Before P3, only DTO/auth foundations existed. After P3, metadata acceptance,
revision/tombstone projections and durable change/dispatch intent share a final
generation fence and one D1 transaction. Raw synchronization and dashboard
connection remain unimplemented later increments.

P3는 내부 metadata 원장입니다. 원문 R2 동기화나 remote dashboard를 활성화하지 않습니다.
동일 hash 재전송은 같은 receipt를 반환하고, 충돌·순서 gap·닫힌 tenant는 거절합니다.
receipt·projection·job·outbox·changes는 최종 generation fence와 함께 원자적으로 저장됩니다.
