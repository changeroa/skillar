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
