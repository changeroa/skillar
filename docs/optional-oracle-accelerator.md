# Optional Oracle accelerator / 선택적 Oracle accelerator

P13 ships the explicitly allowed **interface and disabled adapter**, not an
active Oracle deployment. `ReportAccelerator` accepts only an existing report
job's account/generation/device/source/job identity, request hash, lease fence,
lease deadline and retention deadline. `oracleAccelerator.enabled` is false and
every submission returns `state: disabled`; it never accepts a lease or sends
content. There is no environment flag that silently activates this adapter.

Core ingest, dashboard, private MCP and reports remain Cloudflare-only. The
existing `ReportFlow`, D1 job ledger, expiry bounds and final-commit fences are
unchanged. Oracle outage, idle reclamation or permanent VM loss therefore does
not trigger a fallback network attempt or delay a core report.

An authenticated, internal-service-only POST to
`/v1/activity/accelerator/status` exposes the machine status. It is not a new
public Pages/MCP route or OAuth scope. No Oracle callback endpoint is installed;
old, expired or duplicate callbacks receive 404 and cannot publish results.
The native acceptance test completes a real encrypted Workflow report and then
proves such callbacks leave its job and output unchanged.

## Why it stays off / 비활성화 이유

No measured workload currently requires an external processor: the native
Worker/Workflow path already computes reports. The architecture's prior
2026-11-02 VM observation was ARM64, one logical CPU, 5903 MiB RAM, no swap,
45 GB root with about 39 GB used (87%) and 5.8 GB free, with existing
onecli/PostgreSQL workloads. Those are historical measurements, not a fresh
capacity claim. This release does not SSH into, install on, resize or alter
that VM, its services, Access policies or Tunnel.

No Queue, DLQ, Cron, external cache or paid resource is added while disabled.
The current report dispatch/recovery Cron and Workflow remain authoritative;
there is no optional work to enqueue, retry, retain or purge. Actual Oracle
throughput, VM cost and active Access/Tunnel behavior are **not verified** or
claimed by this release.

## Separate activation contract / 별도 활성화 계약

Activation requires a separately reviewed implementation and fresh workload/
capacity measurement. It must use an unprivileged loopback processor reached
through an outbound Tunnel, an exact Access Service Auth policy/service token,
and app-level account/generation/job/lease authorization. Tunnel connector and
Access caller credentials are distinct. Do not expose the origin port or put
activity data in the existing shared PostgreSQL.

Start with one heavy job, 1 GiB memory and 512 MiB temporary disk bounds; refuse
new work below 10% free disk. Stream bounded R2 inputs/outputs rather than caching
archives/models. Revalidate current tenant/device consent, generation, input
retention and the current D1 lease fence before final commit. Old/duplicate/
expired callbacks must not publish. Durable replay and bounded Queue/DLQ
retention must leave core reports independent of the VM.

비활성 adapter는 실제 Oracle 처리를 구현했다고 표시하지 않는다. 현재 release의
검증 범위는 disabled 계약, callback writer 부재, 실제 serverless report 완료다.
활성화 전 Access/Tunnel/VM 장애 및 삭제 검증은 별도 작업이다.
