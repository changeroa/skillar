# Private registry pack unit

This unit does not publish to GitHub, change the public registry, or register MCP
write tools. Pack definitions are immutable, account/generation-scoped, encrypted
R2 objects. ACTIVITY D1 contains heads, version pointers and request jobs, not the
definition's scope, member conditions or skill bodies. Search decrypts the
account's current definitions and uses the existing registry lexical ranker.

## Parent integration

Import `privatePacksRequest` from `worker/src/activity/private-packs.ts` and call
it **before** the content API's generic device-principal parser/dispatch:

```ts
const packResponse = await privatePacksRequest(request, env);
if (packResponse !== null) return packResponse;
```

Expose these public POST aliases via the existing authenticated Pages
service-binding adapter, mapping the suffix to the internal prefix:

| Public aliases | Internal path | Existing required scope |
| --- | --- | --- |
| `/api/packs/create`, `/v1/packs/create` | `/v1/private-packs/create` | `skills:write` |
| `/api/packs/update`, `/v1/packs/update` | `/v1/private-packs/update` | `skills:write` |
| `/api/packs/status`, `/v1/packs/status` | `/v1/private-packs/status` | `skills:read` |
| `/api/packs/search`, `/v1/packs/search` | `/v1/private-packs/search` | `skills:read` |
| `/api/packs/load`, `/v1/packs/load` | `/v1/private-packs/load` | `skills:read` |

The adapter must replace, never pass through, `x-skillar-principal`, and forward
to `https://activity.internal`. Use the existing `privateSkillPrincipalSchema`:
server-created browser/session or device/token principals, with the existing
issuer/origin, account, generation, shard and persisted credential checks.
Browser writes need the existing same-origin/CSRF enforcement. MCP principals
can use their existing read grants only; this unit adds no MCP write scopes.
Keep the Worker service-binding-only. It is not a bearer-verification endpoint.
All requests are JSON; responses are `no-store`.

Bindings: `ACCOUNTS`, `ACTIVITY`, `ACTIVITY_RAW`, `CONTENT_KEYRING`, existing
deployment-origin configuration and `PRIVATE_SKILLS_ENABLED="true"`. No new
Durable Object or queue is required. Apply
`worker/activity-migrations/0009_private_packs.sql` to **ACTIVITY**, following
the existing activity migrations; the filename was unoccupied.
Existing account private-skill migrations and content-key tables are required.
Hook `sweepPrivatePacks(env, limit?)` from `private-packs-cleanup.ts` into the
account-deletion/retention sweep. It revisits retained upload intents, including
late PUTs, after the tenant fence closes or a pack head is tombstoned.
No public pack deletion endpoint is introduced.

## Shared exports and payloads

`shared/private-packs.ts` exports `PRIVATE_PACK_SERVICE_PREFIX`,
`privatePackPhases`, `privatePackUri`, the name/digest/URI/member/definition,
create/update/status/search/selection/load schemas, and the inferred
`PrivatePackDefinition`, `PrivatePackMember`, `PrivatePackCreate`,
`PrivatePackUpdate` types.

Buffered adapter and MCP response validation uses `privatePackReceiptSchema`,
`privatePackSearchResultSchema`, `privatePackLoadResultSchema` and inferred
`PrivatePackReceipt`, `PrivatePackSearchResult`, `PrivatePackLoadResult`.
The receipt is a strict discriminated union; published requires a positive
revision and durable content, and failed requires an error. Search/load results
strictly validate definitions, registrations, immutable membership, conditions,
composition and false permission flags. The handler validates its outputs with
these same schemas.

Create:

```json
{
  "request_id": "<UUID>",
  "acknowledge_private_upload": true,
  "definition": {
    "schema_version": 1,
    "kind": "skill-pack",
    "name": "review-pack",
    "display_name": "Review pack",
    "description": "Bounded review",
    "scope": "The review's coverage",
    "members": [
      {
        "uri": "skillar://private/<skill UUID>/<manifest SHA256>/SKILL.md",
        "phase": "scope",
        "selection": "required",
        "when": "Establish the scope"
      }
    ]
  }
}
```

The example abbreviates membership: valid packs need 3-64 distinct skills,
exactly one required `scope`, exactly one required `verify`, and at least one
required `investigate`. Other phases are `handoff` and `explain`; selections are
`required`, `when_applicable`, `when_requested`. Duplicate skill IDs, even with
different versions, and public/support-file URIs are rejected.

Update adds `uri: "pack://private/review-pack"` and `expected_digest` (bare
64-character lowercase SHA256) to the create payload and uses a new request ID.
The name must match the URI. A stale expected digest is a durable failed job,
not an overwrite. Same-content updates preserve the head revision and return
`unchanged: true`. Request identity covers operation, expected digest and parsed
definition; conflicting reuse returns `409 request_conflict`. Replaying the
same request resumes accepted work or returns its terminal outcome with current
visibility. A later update does not turn an earlier successful job into failure.

Status takes `{ "request_id": "<UUID>" }`. Receipts include `status`
(`accepted`, `published`, `failed`), `uri`, `digest`, `revision`, `unchanged`,
`content_durable`, `searchable`, `current_digest`, and nullable `error`.
Accepted means a durable upload/job intent, not successful publication.
`content_durable` becomes true only after R2 verification. Publication is
synchronous: head, version and published status commit in one fenced D1 batch.
Infrastructure failures return 503 and retain accepted work for **exact request
replay**; no autonomous queue processor is claimed. Status itself is read-only.
Validation/CAS failures are 400/409; failed jobs remain queryable with status 200.
Published status reads verify encrypted content and current member authority;
it never promises that an inaccessible historical version remains searchable.

Search takes `{ "query": "...", "mode": "discovery", "offset": 0, "limit": 5 }`.
Modes are discovery/explicit; only explicit allows an empty query. Query max is
2048, limit is 1-50, offset is nonnegative. Results include all conditions,
registration, immutable digest, totalMatches and optional nextOffset. Pagination
is over current authorized heads; it is not a multi-page snapshot token.

Load takes `{ "packs": [{ "uri": "pack://private/review-pack", "digest": "<SHA256>" }] }`.
Select 1-8 unique pack URIs, each with its exact digest from search/write status.
Retained old pack versions load independently of current heads. Composition
deduplicates by private skill ID, rejects version/phase conflicts and requires
one shared scope member and verifier. Every originating pack URI/digest,
condition, phase and selection survives in `requirements`. Explicit invocation
is retained. Load returns no skill bodies and grants no execution, delegation
or publication permission; evidence, exclusions and uncovered scope remain the
caller's responsibility.

## Membership, fences and limitations

Members must already be **explicitly pinned** in the account's existing private
skill catalog, even when they are current heads. Use the existing private-skill
pin API first. This unit does not silently pin/unpin or modify skill metadata.
Manifest digest, entrypoint digest/URI, account, generation, tombstone and
deletion state are checked. Unpinning or deleting a member makes dependent
packs unavailable; search omits them and load/status fail closed. Old versions
never fall back to the latest skill head.

ACCOUNTS owns credentials and private-skill metadata; ACTIVITY owns the tenant
fence and pack transaction. These are separate databases. Authority/membership
checks bracket storage/publication and run again on every read; ACTIVITY
triggers atomically fence generation and prevent tombstone resurrection.
There is no distributed transaction across ACCOUNTS, ACTIVITY and R2.
Consequently publication metadata is not an authorization cache: a concurrent
credential/member revocation can make a committed version inaccessible, and
reads must continue through this handler. Do not serve R2 pointers directly or
use a job's stored `published` state to bypass live checks.

Tenant closure must be durable and old generations must never reopen; deletion
integration must retain tombstones/fences and revisit late-put intents. The
cleanup export removes ciphertext, not independent account deletion ledgers.
The parent's generic purge must include these three metadata tables if it
physically removes all account data. No public/private promotion, profile merge,
live-notification registration or connector reverse journal is implemented here.
