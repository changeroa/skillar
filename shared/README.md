# Activity contracts (P1)

This MIT package defines the connector/hosted-service boundary. Hosted
implementations belong under the AGPL `worker/` tree. No dashboard connection,
upload transport, encryption implementation or production endpoint is enabled
by this package.

```sh
npm ci
npm run build
npm test
```

## Privacy contract / 개인정보 계약

**Local-only is the default and sends no data.** Local `captureLevel=full` is
not cloud consent. Every upload must name its device, project/root scope,
consent version and historical/live time range.

**기본값은 local-only이며 데이터를 보내지 않습니다.** 로컬 full 수집 설정은
클라우드 전송 동의가 아닙니다. 기기·프로젝트/root·동의 버전·기간을 별도로 확인합니다.

Managed-content requires explicit acknowledgement that the server and its
subprocessors can read/process selected raw content. Prompt, query, tool
arguments, errors, paths, span attributes and private skill resources are
separate selected kinds; consenting to prompts does not consent to private
skill uploads or external model transfers. External-model transfer is disabled
in this foundation.

Managed-content는 서버와 하위처리자가 선택한 원문을 읽고 처리할 수 있다는 명시적
동의가 필요합니다. prompt·query·args·error·path·span attributes·private skill을
각각 선택합니다. 외부 모델 전송은 이 단계에서 비활성화되어 있습니다.

Content/projection retention defaults to 30 days; users can explicitly select
longer or shorter primary retention. Backups are independently limited to at
most 30 days. Current/pinned
private skill versions have a later, separate lifecycle; this activity policy
does not imply their expiration or indefinite activity history.

원문과 projection 보존은 기본 30일이며 명시적으로 더 짧거나 긴 기간을 선택할 수
있습니다. 백업은 별도로 최대 30일입니다. private skill의 현재/pinned 버전 수명은
후속 계약으로 분리하며, 이 정책이 무제한 활동 이력을 약속하지 않습니다.

A live grant does not authorize historical upload. Backfill needs its own
version, snapshot ID, journal cut and bounded range, including metadata mode.
Unknown/null timestamps, status and token counts stay distinct from numeric
zero. Strict metadata schemas reject unknown/nested raw fields instead of
silently stripping them. They are a closed allowlist, not a promise that
arbitrary source strings have been magically anonymized.

과거 업로드는 별도 버전·snapshot·journal cut·기간 동의가 필요합니다. unknown/null은
0과 다릅니다. metadata는 닫힌 allowlist이며 중첩 원문 필드를 거절합니다.

Strict E2EE is not implemented or advertised here. Managed-content is not E2EE;
metadata-only access is degraded for features requiring raw content.

엄격 E2EE는 이 단계에서 제공하지 않습니다. Managed-content는 E2EE가 아니며
metadata-only에서는 원문이 필요한 기능을 제한 상태로 표시합니다.

## Inventory and capability state

`capability-inventory.json` maps all **83 source rows** from the architecture's
sections 2.2–2.6: 15 CLI, 7 dashboard (including fallback), 25 HTTP, 9 local MCP,
12 registry, 15 runtime ingestion rows. Source-grouped aliases remain grouped;
overlapping HTTP/ingestion entries and local/registry contracts remain distinct.
`stage` is a planned completion gate, not proof of implementation.

`assessCapability` requires both a completed stage and sufficient consent before
returning available. Connector-dependent operations degrade offline. Grouped
features are conservatively assessed for their complete behavior; a metadata
subset may be separately offered by future adapters, without claiming full parity.

Before P1 there was no shared cloud consent/DTO contract. After P1 these
contracts and their boundary tests run in runtime CI; all hosted features remain
planned. P2 adds principals/routing; P3 adds the internal ledger; raw object
durability and upload transport remain P5.

## P5: consented chunk/content wire contracts

`activity-content.ts` adds version **2** without changing P1's version-1
`ActivityBatch`. Raw row documents belong only in private R2 objects. D1 gets
strict P1 `metadataMutations` and immutable chunk references, never raw row
values or base64 bodies. This module supplies contracts, not storage or a sender;
worker integration and the P6 local sender must enforce that separation.
Account identity is supplied by the verified principal, not any wire field.

### Wire values and integrity

- `ContentChunkUpload` / `contentChunkUploadSchema` carry the P1
  `batchId`, `deviceId`, `sourceDomain`, `generation`, `consentVersion`,
  `projectId`, `rootId`, `range`, `backfill`, plus `schemaVersion: 2`,
  `revision`, zero-based `index`, lowercase SHA-256 `plaintextHash`, decoded
  `bytes`, and canonical base64 `body`. A decoded chunk is at most 128 KiB;
  the complete encoded JSON is at most 256 KiB.
- `ContentChunkRef` / `contentChunkRefSchema` contain only
  `index`, `plaintextHash`, `bytes`, and `revision`. They are readonly and
  contain no caller-chosen object key.
- `ContentBatch` / `contentBatchSchema` carry that same P1 identity/scope,
  `schemaVersion: 2`, P1 `sequence` and `journal`, 0–100 strict P1
  `metadataMutations`, 1–128 ordered contiguous `chunks` starting at index 0,
  SHA-256 `contentHash`, and `totalBytes`. The total must exactly equal the
  reference byte sum and cannot exceed 16 MiB. The manifest JSON is also
  limited to 256 KiB. Metadata timestamps retain P1's half-open range checks.
- `parseContentChunkUpload` and `parseContentBatch` perform strict structural
  parsing. **Parsing alone does not verify plaintext.**
  `verifyContentChunkUpload(input)` asynchronously returns decoded `Uint8Array`
  only after checking canonical base64, decoded size, declared bytes and SHA-256.
  `hashContent(bytes)` computes lowercase SHA-256 using Web Crypto.
- `verifyContentBatch(input, uploads, consent)` checks each upload's identity,
  scope and immutable reference, concatenates decoded chunks in manifest order,
  checks the complete hash, strictly decodes UTF-8 and parses/authorizes the
  resulting row document. Unicode can span chunk boundaries.
  Server ingestion must perform this check before accepting content; inspecting
  independent chunks cannot establish document consent.

Exported limits are `MAX_CONTENT_CHUNK_BYTES`, `MAX_CONTENT_BYTES` and
`MAX_CONTENT_CHUNKS`. `plaintextHashSchema` and `ContentContractError` are also
exported; integrity errors use `chunk_integrity` or `content_integrity`.
Zod reports structural errors; P1 `ActivityContractError` reports consent and
range failures. Malformed JSON/UTF-8 is rejected by the native parsers.

### Row documents and selected-kind policy

`ContentDocument` / `contentDocumentSchema` are
`{ schemaVersion: 2, rows: ContentRow[] }`, limited to 10,000 rows and 16 MiB
of UTF-8 JSON; an empty document can communicate an empty snapshot.
`ContentRow` / `contentRowSchema` preserve P4's `table`, `key`, `revision`,
`operation`, `sourceOrder` and `values`. Upserts require scalar-valued source
columns; deletes require `values: null`. `beforeValues` is forbidden on wire.
`contentScalarSchema`, `contentValuesSchema`, `contentTableSchema`,
`ContentTable` and `contentTables` expose the row primitives and table list:
skills, sessions, events, loads, eval_cases, otel_spans, herdr_workspaces,
herdr_tabs, herdr_panes, pane_sessions, workflow_specs, flows, flow_steps,
load_candidates and recording_clock. Source columns are closed against P4's
schema and migrations 2–6, with typed numeric/time columns.

`await transformContentRows(consent, scope, rows)` returns a `ContentDocument`
or `null`. Pass the P1 `UploadScope` and actual selected kinds. Resolve source
project/root membership locally first: a self-asserted batch label cannot prove
row membership. Local-only returns `null` before accessing rows, serializing or
hashing: send zero bytes, not a JSON `null`. Other modes first call P1
`authorizeUpload`, including its independent historical/backfill grant checks.
Row timestamps and local before-image timestamps must fall within the scope.
Local before-images are discarded before any wire payload is built.

The same closed policy is enforced by
`parseContentDocument(input, consent, scope)` after reassembly. It rejects
forbidden fields instead of silently stripping them:

- Metadata retains only P4's closed numeric fields (times, lengths, versions,
  recording positions and flow orders) and hashes source keys as
  SHA-256 of UTF-8 `table + NUL + key`. No raw strings, digests or nested data
  are metadata. Hash format is checked on receipt; a server cannot establish
  provenance of a hash without the original local key.
- Managed-content with all seven kinds selected in both consent and scope
  preserves every exact source value, including Unicode and opaque JSON strings.
- Partial grants retain `sessions.first_prompt` only for `prompt`,
  `eval_cases.query` only for `query`, `cwd` only for `path`, and private-skill
  text only for `private-skills`. Skill URI columns require both `path` and
  `private-skills`. Skill source keys require both permissions; other raw source
  keys require `path`, otherwise they are hashed.
- Every opaque JSON column requires **all seven kinds**. Other ambiguous text,
  labels, IDs and digests also require all seven kinds: the source has no proven
  narrower category. For example, event text is not assumed to be prompt-only
  based on a free-form event kind. Unselected columns are removed, not replaced
  with fabricated parity values. Raw category permissions must be present in
  both consent and scope; an empty scope kind list cannot broaden a grant.

These conservative partial documents are deliberately incomplete, not full
parity. New source columns or more precise category rules need explicit review
on both sender and server. No external-model transfer is authorized here.

Focused verification:

```sh
cd shared
npm run build
node --test test/activity-content.test.mjs
```
