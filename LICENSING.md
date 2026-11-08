# Licensing

Skillar is open source, with licenses split by component starting with the
commit that introduces this file:

| Scope | License | Text |
| --- | --- | --- |
| `server/` - Node.js registry and server tooling | AGPL-3.0-only | [server/LICENSE](server/LICENSE) |
| `worker/` - Cloudflare Worker hosting and distribution | AGPL-3.0-only | [worker/LICENSE](worker/LICENSE) |
| `local/` - local CLI, daemon and dashboard | MIT | [local/LICENSE](local/LICENSE) |
| `clients/` - client integrations | MIT | [clients/LICENSE](clients/LICENSE) |
| Other project files, including `plugins/`, `site/`, `scripts/` and `docs/` | MIT | [LICENSE](LICENSE) |

The root MIT license applies outside `server/` and `worker/`; their directory
licenses take precedence over it. Third-party dependencies and bundled material
retain their own licenses and notices.

`server/` and `worker/` are AGPL-3.0-only from this commit forward. Copies
obtained earlier, including earlier released versions, keep their MIT terms;
MIT permissions already granted cannot be revoked. This change does not
retroactively relicense those copies. Existing tags, release assets and git
history are unchanged; earlier GitHub release notes link here to explain the
current licensing split.

The hosted-service core uses AGPL-3.0-only to protect the hosted service while
keeping it open source. In particular, AGPL requires operators of modified
versions to offer corresponding source to users interacting with those versions
over a network, as described in section 13. The local CLI and client integrations
remain MIT for broad adoption and integration.

Project copyright remains Copyright (c) 2026 changeroa. Existing copyright and
permission notices are retained.
