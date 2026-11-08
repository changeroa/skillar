# Activity authentication foundation (P2)

P2 reuses the existing Google signed cookie and ACCOUNTS session rows. It does
not connect the hosted dashboard or accept activity batches. All new routes
return 404 unless `ACTIVITY_ENABLED` is exactly `"true"`. That variable is
intentionally absent from production configuration. No production deployment
or remote ACCOUNTS migration is performed by this increment.

## Routes

| Route | Principal and behavior |
| --- | --- |
| `GET /api/activity/status` | Live Google sid, account map and generation; foundation status only |
| `GET /api/devices` | Browser-owned devices, no credentials |
| `POST /api/devices/grants` | Browser + exact Origin; explicit read/ingest scopes, one-time grant |
| `POST /api/devices/:id/revoke` | Browser + exact Origin + tenant ownership; revokes device and tokens |
| `POST /v1/devices/exchange` | High-entropy one-time grant; CLI may omit Origin |
| `GET /v1/activity/status` | Live scoped device token; `activity:read` required |

The Pages route manifest includes `/api/*` and `/v1/*`; unknown routes remain
404, rather than returning SPA HTML or forwarding unverified identity headers.
ACCOUNTS maps Google `sub` to a server-issued account ID and `activity-00`.
Neither email, source ID, payload account ID, nor URL slug chooses a tenant.
The initial shard mapping is deliberately a single server-defined slot.

Device grants last ten minutes, and exchanged opaque tokens last thirty days.
Only SHA-256 hashes are persisted. Each exchange atomically inserts a token
from a live, unconsumed grant and consumes that grant. The issuing browser sid,
account generation, device state, issuer, audience and scopes are checked in
the final D1 statements. A lost exchange response requires a new browser grant:
replaying the old grant cannot recover or mint another secret.

Every bearer request joins current ACCOUNTS token/device/account state; no KV
cache or JWT lifetime substitutes for revocation. Browser requests verify the
cookie issuer/audience and live sid on each request. Device bearer scopes
cannot grant device management, and browser mutation Origin checks cannot be
bypassed by attaching a bearer header.

`sourceNamespace` includes the verified account, live owned device, source DB
lineage and source ID, preserving identical source IDs across tenants/devices.
Activity projections and their final generation fence belong to P3; raw
content and consented batch transport remain P5.

## Local verification

Build shared contracts first, then run the Pages package:

```sh
npm --prefix shared ci
npm --prefix shared run build
npm --prefix site ci
npm --prefix site run build
npm --prefix site test
```

On Node 24.15.0, strict Pages compilation/build and **85 tests passed**, including
the existing Google-auth tests. The SQLite-backed D1 adapter executes real SQL
and atomic batches, including `RETURNING`; it has a rollback regression test.
New tests cover one-time concurrent exchange, hash-only persistence, expired
and revoked credentials, wrong issuer/audience, scope separation, Origin,
logout-before-commit, account generation, and two tenants/devices with the same
source identity.

Real local Pages/workerd QA used local-only D1 migrations 0001 and 0002 and
`test/fixtures/activity-qa.sql`. No remote ACCOUNTS data was touched. With
synthetic bindings and `PUBLIC_ORIGIN=http://localhost:8788`, HTTP observations:

| Scenario | Observed |
| --- | --- |
| Signed browser foundation status | 200, server-issued account and shard; dashboardConnected false |
| Browser grant issue | 201 |
| Six concurrent grant exchanges | Exactly one 200, five 401 |
| Winning bearer foundation status | 200 |
| Hostile mutation Origin | 403 |
| Device revoke | 200; token's next request 401 |
| Existing Google logout | 303 to `/login/`; sid's next activity request 401 |
| Live `https://skillar.sh/login/`, no deployment | 200 HTML |

The QA server was stopped after the checks. The fixture secret and user are
synthetic local-only values, not production credentials.

## Before, after and rollback / 이전·이후·복구

Before P2, hosted Google sign-in existed but no device-scoped activity identity
or guarded API/v1 routing existed. After P2, these foundations are testable
behind an off-by-default flag; the dashboard remains a preview.

P2 이전에는 Google 로그인만 있었고 activity 전용 기기·토큰·tenant 경계는 없었습니다.
이후에는 기본 비활성 flag 뒤에서 경로와 인증을 검증할 수 있습니다. 원격 dashboard가
완성되었다고 표시하지 않습니다.

To roll back, keep the flag absent/false and revoke any staging device tokens.
The schema is additive; preserve existing users and sessions. Apply migration
0002 only to a deliberately configured staging environment before enabling it.
