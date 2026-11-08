# P14 parity release: inventory, limits, and recovery runbook

P14 release candidate: implementation and local verification are complete.
Independent approval, exact-head CI, merge, and production activation are
separate gates. Release evidence records their actual outcomes; this runbook
does not imply production activation.

Each claim below names the file it comes from. If a claim has no file, it's marked **UNVERIFIED** and you shouldn't treat it as true until someone reads the code or runs the test.

## 1. What P14 adds

| Area | Files |
| --- | --- |
| Primary D1 (`ACCOUNTS`) migrations | `site/migrations/0007_private_skill_retention.sql`, `site/migrations/0008_activity_deletions.sql` |
| Activity D1 (`ACTIVITY`) migration | `worker/activity-migrations/0011_deletion_objects.sql` |
| Source content TTL | `worker/src/activity/content-retention.ts` (`sweepSourceContent`) |
| Runtime context TTL | `worker/src/activity/runtime-cleanup.ts`, `worker/src/activity/runtime-api.ts` |
| Account deletion | `worker/src/activity/deletion-api.ts`, `deletion-store.ts`, `deletion-cleanup.ts`, `shared/activity-deletion.ts`, `site/lib/activity-deletion.ts` |
| Private skill retention | `worker/src/private-skills/retention.ts`, `objects.ts` |
| Scheduler wiring | `worker/src/activity/content-api.ts` (`scheduled`), `worker/wrangler.activity.jsonc` |
| Replay benchmark | `worker/scripts/parity-replay-benchmark.mjs`, `worker/docs/PARITY-REPLAY.md` |

## 2. Collector inventory

### 2.1 Cloud storage and complete collector wire contract

The migrations under `worker/activity-migrations/0001..0011` and
`site/migrations/` own cloud data and control-plane storage. Examples include:

`account_changes`, `account_content_keys`, `account_control_outbox`, `account_control_receipts`, `account_event_outbox`, `account_heads`, `accounts`, `activity_deletions`, `api_tokens`, `connector_commands`, `content_manifests`, `content_uploads`, `dashboard_eval_cases`, `deletion_objects`, `device_consents`, `device_grants`, `device_streams`, `devices`, `dispatch_outbox`, `entity_tombstones`, `event_facts`, `google_login_returns`, `ingest_receipts`, `jobs`, `mcp_connections`, `mcp_consents`, plus the rest of the alphabetical list (at least `migration_pages`, `session_facts`, `span_facts`, `tenant_fences`, `private_skills`, `private_skill_versions`, `private_skill_uploads`, `private_skill_purges`, which the P14 code references).

The list above describes cloud storage, not the collector wire inventory.
The complete closed collector allowlist is `shared/activity-content.ts`:
15 tables, with the following accepted fields. Every wire row also has `table`,
`key`, `revision`, `operation`, `sourceOrder`, and `values`. Consent may omit or
hash sensitive fields; full fidelity requires the corresponding explicit grant.

| Table | Accepted columns |
| --- | --- |
| skills | uri, root_id, name, description, tags_json, when_to_use, examples_json, aliases_ko_json, group_id, group_stage, invocation, body_head, digest, manifest_digest, resources_json, mtime_ms, removed_at |
| sessions | id, runtime, runtime_session_id, conversation_id, client_name, cwd, first_prompt, end_orders_json, started_at, ended_at |
| events | id, kind, source, session_id, attribution_method, attribution_reason, runtime, trace_id, load_id, skill_uri, tool_use_id, text, text_digest, data_json, source_key, turn_key, call_id, span_id, recording_orders_json, ts, text_length |
| loads | load_id, trace_id, uri, manifest_digest, resources_json, created_at |
| eval_cases | id, query, expected_uri, from_trace_id, created_at |
| otel_spans | trace_id, span_id, parent_span_id, name, runtime, conversation_id, turn_key, call_id, recording_orders_json, start_ms, end_ms, received_at |
| herdr_workspaces | id, label, created_ms, closed_ms |
| herdr_tabs | id, workspace_id, label, created_ms, closed_ms |
| herdr_panes | id, workspace_id, tab_id, label, cwd, agent, created_ms, closed_ms, last_seen_ms |
| pane_sessions | pane_id, agent, source, agent_session_value, session_id, first_seen_ms, last_seen_ms |
| workflow_specs | id, name, body_json, digest, version, created_ms |
| flows | id, workspace_id, tab_id, spec_id, label, start_event_ids_json, end_event_ids_json, end_sessions_json, end_spans_json, start_order_domain, end_order_domain, registered_ms, ended_ms, start_order, end_order |
| flow_steps | flow_id, pane_id, step_id, registered_ms |
| load_candidates | load_id, session_id, ts |
| recording_clock | domain, singleton, position |

### 2.2 Native surfaces mapped to collector storage

| Native surface | Collector storage | P14 lifecycle |
| --- | --- | --- |
| Source upload (raw content, opt-in only) | `content_uploads`, `ingest_receipts`, `migration_pages`, R2 `ACTIVITY_RAW` | Source TTL (section 3.1) |
| CDC mutations | `ingest_receipts.metadata_json.$.mutations`, `session_facts`/`event_facts`/`span_facts` | Facts retired only if `revision <=` the expired mutation |
| Snapshot | `migration_pages`, `content_manifests` | Covered by the source sweep through `migration_pages` |
| Runtime context | runtime store (`runtime-store.ts`) | `received_at` TTL (section 3.2) |
| Reports and export | `jobs`, report objects (`report-objects.ts`), `export-service.ts` | `sweepReports` 25, dispatch 5 per 15-minute tick |
| Dashboard eval | `dashboard_eval_cases` | `sweepDashboardEvalCases` 25 |
| Connector commands | `connector_commands` | `sweepCommands` 25 |
| Private packs | Activity 0009 tables | `sweepPrivatePacks` 25 |
| Private skills and mutations | `private_skills`, `private_skill_versions`, `private_skill_uploads`, `private_skill_purges`, R2 objects | Retirement, pins, permanent purges (section 3.3) |
| Account deletion | `activity_deletions` (primary), `deletion_objects` (Activity) | 1/min sweep (section 3.4) |

### 2.3 Functional inventory and acceptance coverage

| Surface | Execution and evidence |
| --- | --- |
| Sessions, trace, stats, skill-week | `local/test/cloud-report-parity.test.mjs` compares real HTTP/D1/R2/Workflow results with SQLite, including filters, automation, empty and missing sessions |
| Flow Sankey and heatmap | That native parity test covers four flow units, top/filter combinations, UTC/Seoul/New York, week starts and bucket sizes |
| Workspaces, registered/implicit/outside flows, session reports, skill usage | Native parity covers automation modes, recording cuts, pagination, detail limits, trees, comparisons and usage |
| Snapshot, CDC, backfill, restore/export | `local/test/sync-cloud-golden.test.mjs`, `sync-cloud-backfill.test.mjs`, `sync-restore.test.mjs`; native `worker/test/activity-migrations.test.mjs`, `activity-migration-modes.test.mjs`, `activity-content.test.mjs` |
| Workflow spec, flow start/step/end, eval mutations, pack apply | Connector-authoritative commands, pending offline; `local/test/sync-command-e2e.test.mjs`, `sync-command-apply.test.mjs`; native `worker/test/activity-commands.test.mjs`, `private-packs-write.test.mjs`, `activity-dashboard-eval.test.mjs` |
| Private skills, search, resources, version/head/pin/delete | `worker/test/private-skill-{storage,search,catalog,authority,controls,cleanup}.test.mjs`; `local/test/private-skill-{sync,apply,apply-races}.test.mjs`; 512 files/16 MiB with existing path/archive guards |
| Hosted MCP and Google OAuth | `worker/test/private-mcp-{sdk,native,auth,catalog,packs,telemetry}.test.mjs`; P11 release includes real client acceptance |
| Dashboard, consent and transport | `local/test/cloud-browser-report.test.mjs`, `worker/test/activity-dashboard-{profiles,reports}.test.mjs`, site tests and P8/P9 visual/release evidence; P14 changes only deletion confirmation controls |
| Local host operations | Install/init/rollback/service/doctor, collection, source repair/import/export destinations and OS opener execute on the connector. A cloud worker cannot perform host filesystem/service operations; disconnected state is pending/unknown |
| Optional acceleration | Oracle stays disabled; the Worker/D1/R2/Workflow core has no Oracle dependency |

Acceptance-suite pointers are not claims of production verification. Final test
outcomes belong in release evidence. The P12 production exception remains open.

## 3. Retention behavior

### 3.1 Source TTL (`sweepSourceContent`)

Grounded in `content-retention.ts`:

- The sweep scans `content_uploads` rows that have an `ingest_receipts` or `migration_pages` lineage, ordered by `purge_order`, limited to 25 per tick.
- For an expired row, it writes `state='purged'` **before** the awaited R2 `DELETE`.
- If the receipt has pending mutations, one batch deletes `session_facts`, `event_facts`, and `span_facts` rows whose `revision <= json_extract(mutation,'$.revision')`. It then empties `$.mutations` on the receipt. Both statements require an `active` row in `tenant_fences`.
- Receipts, manifests, receipt hashes, cursor and fence high-watermarks, and tombstones are kept. The code comment says "Keep manifests, receipt hashes, source/fence high-watermarks and shared keys", and the statements only touch facts and the mutations array.
- Every scanned row rotates `purge_order`, so a failed `DELETE` gets another try on a later tick.

`sourceBatchExpiry` uses `min(content_uploads.created_at)`, not historical
source timestamps or retry time. `grantExpiry` takes the shortest original and
current content/projection retention. `content-objects.ts` checks readability
before and after awaited R2 reads/decryption; cleanup writes terminal intent
before deletion. The native source-retention suite covers exact boundaries,
shorter grants, late PUT, failed DELETE, newer facts, tombstones, closed fences,
and 128-chunk reads within 640 D1 binding RPCs.

Authorized exact CDC retries recover the original receipt even after content
expiry, without reading or recreating R2 bytes, renewing age, or reprojecting
scrubbed mutations. The connector proceeds from an expired chunk response to
that exact receipt check. A changed hash conflicts, revoked generations remain
denied, and an expired batch with no committed receipt remains pending rather
than advancing its local cursor. The lost-ACK regression also sends the next
fresh CDC batch after recovery.

### 3.2 Runtime TTL

Runtime uses server `received_at_ms` in `runtime-api.ts`, and
`runtime-cleanup.ts` sweeps 25 per tick. The connector's
`local/src/sync/cloud-runtime.ts` renews unchanged fingerprints at half the
shorter content/projection retention. Its clock starts before upload, not at
a delayed ACK; a changed consent also invalidates the remembered grant.

### 3.3 Private skill versions

Grounded in `site/migrations/0007_private_skill_retention.sql`:

- Retention starts at `retired_at`, not at publication. A version is retired when the head moves off it and it isn't pinned. Pinning clears `retired_at`, and unpinning a non-head version restores it.
- `private_skill_purges` holds permanent, path-free identities `(account, generation, skill, digest, resource digests)`, with no FK, so a purge target survives metadata or account deletion.
- Purges get recorded on an explicit delete (`deleting_revision`) or a tombstone, in the same transaction as the fence.
- Purge fence triggers abort (`private_skill_purge_claimed`) on any later upload insert, head insert or update, or pin to a purged digest. A late PUT can't revive a purged version, and the sweep keeps revisiting purge targets in `sweep_order` so a late R2 write still gets deleted.
- The cron cap is 5 version candidates and 25 objects per tick (`sweepPrivateSkills(env, { limit: 5, objectLimit: 25 })`).

### 3.4 Account deletion

- Primary `activity_deletions` moves through the states `requested -> access_revoked -> live_purge_complete -> backup_expired`. It stores `last_copy_at_ms` and `backup_expires_at_ms`. The migration comment says: "Independent of ACTIVITY restores. Never rewind this ledger with an old shard."
- Activity `deletion_objects` stores opaque R2 keys that outlive manifests and jobs. The migration comment says: "an old timed-out PUT can finish after a successful DELETE", so swept keys get revisited.
- `sweepDeletions` visits one deletion ledger per minute. `reconcileDeletion` defaults to 1,000 metadata rows per table and 50 object targets, with maxima 1,000 and 100. These are progress limits, not a one-tick erasure promise.

## 4. Scheduler limits and capacity

From `content-api.ts` `scheduled` and `wrangler.activity.jsonc` (`["* * * * *", "*/15 * * * *"]`):

| Cron | Work | Cap per tick |
| --- | --- | --- |
| every minute | `sweepDeletions`, then account control/event dispatch | `deletion-cleanup.ts` bounds |
| every 15 min | content, reports, dashboard eval, private packs, commands, runtime, source | 25 each |
| every 15 min | private skills | 5 candidates, 25 objects |
| every 15 min | `dispatchPendingReports` | 5 |
| every 15 min | `sweepAccountChanges` | internal |

**Honest limits:**

- Read expiry is enforced at the retention boundary. Physical cleanup waits for rotation. A 25-row, 15-minute scan visits at most 2,400 candidates daily per owner, including retained and permanent late-PUT candidates; this is not a guaranteed backlog drain rate.
- No 1,000-account production capacity claim. The final 10/100/1000 replay passed on native Miniflare, serially against one activity database, not the proposed 16-shard topology. Its request counts are not billable invocations. `.omo/evidence/skillar-parity-p14-replay.json` preserves exact counts and unknown billing dimensions; wall timings include concurrent repository verification.
- Billed CPU, per-account allowances, and cost fields are **unknown**. Nobody has measured them, so don't fill them in.

## 5. Known exceptions

- **P12 Activity 0009/0010 production mutation smoke: STOPPED.** This exception still stands and P14 doesn't close it.
- The P13 release ran no authenticated internal smoke and kept Oracle disabled on purpose (`.omo/evidence/skillar-parity-p13-release.json`).
- Owner data: there's no consent to upload the owner's real data. Every test uses fixtures. The owner's 75 skills and grants must stay untouched.

## 6. Migration runbook (additive only)

Production writes need the lead's deploy slot. Don't start without it.

1. **Preflight.** Confirm P14 is merged and exact-head CI and independent review passed; record the merged SHA.
2. **Bookmark and export both databases.** Record a D1 Time Travel bookmark for `ACCOUNTS` and `ACTIVITY` (`wrangler d1 time-travel info`), then take a `wrangler d1 export` of each. Store bookmark IDs and export digests in release evidence. Exports are backups: enforce the 30-day maximum and the physical-erasure policy in section 7.
3. **Inspect migration history first.** Apply primary `0007`, then `0008`. Activity `0011` requires the earlier schema, including P12 `0009`/`0010`; pending predecessors must be named in the lead-approved plan, never silently skipped or activated. P14 adds columns, tables, indexes and triggers; `0007` conservatively backfills upload/retirement timestamps to migration time.
4. **Deploy Activity and Pages from merged main**, preserving secrets and flags. Pages owns the deletion control-plane route. Smoke `/`, `/login/`, `/dashboard/`, the owner session read-only, and `/mcp` (401 plus OAuth challenge). Production mutation smoke requires an approved exact fixture plan; P12's stopped smoke is not permission to retry it.
5. **Watch the first ticks.** Look for one minute tick and one 15-minute tick in the logs, and for no `private_skill_purge_claimed` or `tenant_fenced` errors outside expected retries.

## 7. Rollback and deletion recovery

Rollback must never bring back data a user deleted.

- **Code rollback first.** Redeploy the previous Activity version and leave the schema in place. The additive tables and triggers are harmless to old code. Exception: the `0007` purge fence triggers still block re-uploads of purged digests, and that's intended.
- **Never restore `activity_deletions` from an older copy**, and never restore an Activity shard over a closed fence (a `tenant_fences` row that isn't `active`, or a `requested`+ deletion).
- **If you have to restore a database** (Time Travel or export), forward-reconcile both sides afterwards:
  1. Re-apply every `activity_deletions` row newer than the restore point from the surviving primary ledger, or from the pre-restore export if the primary was the one restored.
  2. Re-fence the affected tenants in Activity, re-insert `deletion_objects` and `private_skill_purges` targets, and let the sweeps re-delete R2 objects.
  3. Check that no restored row belongs to a deleted generation before you reopen ingest.
- **Backups.** Keep any backup for 30 days at most. A backup that holds a deleted account stays in the `pending physical erasure` state until `backup_expires_at_ms`, and then the ledger moves to `backup_expired`. Restoring from that backup means running step 1 above first.

## 8. Validation and evidence pointers

| Item | Where | Status |
| --- | --- | --- |
| P14 unit/integration tests | Worker, Site, Shared, Local suites and compilers | 645 Worker, 201 Site, 94 Shared, 909 Local plus performance test pass |
| P14 UI control captures | `.omo/evidence/skillar-parity-p14-controls/*.png`, `skillar-parity-p14-controls-qa.json` | 24 captures reviewed; desktop/390 px, light/dark, final focus repair verified |
| Replay benchmark | `worker/scripts/parity-replay-benchmark.mjs`, `.omo/evidence/skillar-parity-p14-replay.json` | 10/100/1000 pass; billing and CPU remain unmeasured |
| P13 release record | `.omo/evidence/skillar-parity-p13-release.json` | Merged d9c2af0, deployed Activity only |
| P14 release record | `.omo/evidence/skillar-parity-p14-release.json` | Doesn't exist yet |

The root verifier stopped in the unchanged server legacy-launcher test:
its fixed PATH selects `/opt/homebrew/bin/node`, which aborts because
`libsimdjson.33.dylib` is missing. Server build and 87/88 tests passed; this
host dependency is outside P14. Remaining P14 checks ran separately and passed,
including 74 native cloud/SQLite payload or error comparisons, two multipart
results, search benchmarks, plugin checks, and all six Worker deployment dry runs.
