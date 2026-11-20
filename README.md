<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/skillar-wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/skillar-wordmark-light.svg">
    <img src="docs/assets/skillar-wordmark-light.svg" width="500" alt="skillar">
  </picture>
</p>
<p align="center"><strong>One skill library for every agent. See what they actually read.</strong></p>
<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a></p>
<p align="center">
  <a href="https://www.npmjs.com/package/skillar"><img src="https://img.shields.io/npm/v/skillar?color=c44b2b&amp;label=npm" alt="npm version"></a>
  <a href="https://github.com/changeroa/skillar/blob/main/local/package.json"><img src="https://img.shields.io/badge/Node.js-%E2%89%A524.15-333333" alt="Node.js 24.15 or newer"></a>
  <a href="https://github.com/changeroa/skillar/blob/main/LICENSING.md"><img src="https://img.shields.io/badge/license-MIT%20%2F%20AGPL--3.0-333333" alt="MIT / AGPL-3.0 licenses"></a>
</p>

skillar serves the `SKILL.md` folders on your machine and the private skills in your skillar.sh account to your coding agents over MCP, through the local daemon or `https://skillar.sh/mcp`. It records what each session searched and read. The history is visible in the local dashboard, and devices that consent to upload also see it in the skillar.sh sessions view.

**Index in place · Serve over MCP · Upload only with consent**

[Quick start](#quick-start) · [Supported runtimes](#supported-runtimes) · [Privacy](#privacy-and-storage) · [CLI & configuration](local/README.md)

Hosting the site or Workers yourself? Use the [deployment templates and private configuration setup](docs/self-hosting.md).

## Quick start

macOS or Linux · **Node.js 24.15+**

1. **Install** (Node.js 24.15 or newer):

   ```sh
   npm install -g skillar
   ```

2. **Initialize** - preview the changes, then apply them:

   ```sh
   skillar init --dry-run   # preview every change without writing a file
   skillar init             # connect detected runtimes and install the background service
   ```

   `init` installs a LaunchAgent on macOS or a systemd user unit on Linux; the daemon listens on `127.0.0.1:8799`. Prefer a foreground process? Run `skillar init --no-service`, then `skillar serve`.

   `init` also offers to connect your skillar.sh account and asks whether to upload session history (`[y/N]`, off by default). Approval happens in your browser: the approval screen has one "session history upload" checkbox, and upload consent is recorded only when you approve with it checked.

3. **Use it from your agent** - connected agents search with `search_skills` and read the chosen `SKILL.md` over MCP `resources/read`:

   ```sh
   skillar open     # open the local dashboard
   skillar doctor   # check the installation
   ```

   For a source checkout, see [development setup](local/README.md#develop).

## From a skill folder to a session trace

| Step | What happens |
| --- | --- |
| **Discover** | Index existing skill roots without copying or editing their files. Agents search with `search_skills` and receive ranked candidates. |
| **Read** | The host reads the chosen `SKILL.md` and supporting files through standard MCP `resources/read`. Reading is evidence, not permission to execute. |
| **Trace** | Inspect sessions, search candidates, skill reads, task → skill → outcome flows, and activity by weekday and hour in the dashboard. |

Capture can also observe skills used natively when runtime hooks or telemetry report them. [Skill tracing](local/docs/skill-tracing.md) explains attribution, evidence limits, and the **herdr requirement for pane/session tracing**. Core MCP serving and session collection continue if herdr is unavailable.

## Supported runtimes

| Runtime | `--runtime` ID |
| --- | --- |
| Claude Code | `claude-code` |
| Codex | `codex` |
| Gemini CLI | `gemini` |
| Cursor | `cursor` |
| OmO | `omo` |
| Gajae Code | `gajae` |
| OpenClaw | `openclaw` |

`init` detects installed runtimes. Select a subset with `skillar init --runtime codex,claude-code`. Packs configure MCP and runtime-specific telemetry or capture hooks; capture coverage varies by runtime.

Both MCP revision **2026-07-28** and the legacy `initialize` handshake are supported. Skill bodies require a host resource reader. See [protocol and compatibility](local/README.md#skills-over-mcp) for headers, stdio, and legacy transport limits.

## Privacy and storage

The local daemon stores prompts, searches, loads, and supporting-file reads in SQLite. It listens on loopback only, protects MCP, ingest, and API requests with a local bearer token, and never uploads captured telemetry on its own. When a skillar.sh account is connected, a device uploads only what you explicitly consent to in the browser; the default is local only. The dashboard uses a local authenticated cookie. Connected agents and their model providers handle data separately.

Choose what to retain in `~/.skillar/config.json`:

| Setting | Behavior |
| --- | --- |
| `captureLevel: "full"` | Store captured text as sent (default). |
| `captureLevel: "redacted"` | Mask recognized secrets and truncate text to 2,048 characters; this does not guarantee every secret is removed. |
| `captureLevel: "metadata"` | Keep text digests and lengths, without the text. |
| `retentionDays` | Delete old sessions; `null` keeps history. |

Fresh installs use `~/.skillar/`; `SKILLAR_HOME` selects another home. Existing legacy homes and databases are reused according to the [migration rules](docs/migration-skillar.md#local-state-and-configuration).

| Path in the selected home | Purpose |
| --- | --- |
| `config.json` | Port, capture level, retention, and skill roots |
| `token` | Local bearer token, mode `0600` |
| `skillar.db` | Skill index, sessions, events, and loads; existing `gisool.db` stays in place |
| `logs/daemon.log` | Daemon log |
| `backups/` | Per-run configuration backups for rollback |

## Keep your setup portable

```sh
skillar doctor                                  # check daemon, service, index, capture, and herdr
skillar doctor --json
skillar init --rollback                         # undo the newest init run
skillar init --rollback --all                    # undo every run
skillar export ~/skillar-backup                  # settings only
skillar export ~/skillar-backup --with-history   # include sessions, events, and loads
skillar import ~/skillar-backup --dry-run        # preview; existing keys are kept
skillar eval                                    # measure search quality
```

Use `skillar open --print` to print the dashboard URL without opening a browser. See the [CLI guide](local/README.md) for import, service management, settings, and protocol details.

## Documentation

| Guide | Use it for |
| --- | --- |
| [Local CLI & MCP](local/README.md) | Installation, commands, settings, and protocol reference |
| [Upgrade & compatibility](docs/migration-skillar.md) | Safe package handoff, legacy homes, commands, and identities |
| [Skill tracing](local/docs/skill-tracing.md) | Capture coverage, herdr joins, attribution, and evidence limits |
| [Architecture](docs/skillar.md) | Daemon, storage, ingest, and API design |

## Remote registry and team distribution

The local CLI needs no hosted registry. This repository also contains a separate [Node.js registry](server/README.md) (`server/`, stdio or Streamable HTTP) and a Cloudflare Worker (`worker/`) for authenticated distribution from private R2 immutable releases. They implement the [SEP-2640 Skills Extension](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640).

**The former personal Cloudflare deployment was retired on 2026-10-29.** Historical addresses are not maintained endpoints; organization deployments are separate external resources. Self-hosting requires your own configuration and release validation. `skillar init --disable-remote` can disable a remote registration in connected runtimes.

<details>
<summary>Registry clients, deployment, and historical context</summary>

| Runtime | Integration |
| --- | --- |
| Codex | [Self-hosted team HTTPS + OAuth plugin](docs/team-plugin.md) · [Codex client](clients/codex/README.md) |
| oh-my-openagent / OmO 5 (`omo-ai`) | [OAuth stdio bridge and discovery extension](clients/oh-my-openagent/README.md) |
| Gajae Code (`gjc`) | [OAuth stdio bridge and workflow integration](clients/gajae-code/README.md) |
| OpenClaw | [OAuth stdio bridge and bootstrap discovery hook](clients/openclaw/README.md) |

The Worker uses `SKILLS_BUCKET`, a reader `SKILLAR_BEARER_TOKEN`, and a separate `SKILLAR_PUBLISH_TOKEN` for publication. `server/ops/` contains new-install templates, not live credentials or proof of an active deployment.

[Deployment, immutable release format, rollback, and production gates](docs/deployment.md) · [Self-hosted team setup](docs/team-plugin.md)

</details>

## Contributing

With Node.js 24 and npm, run `node scripts/verify.mjs` from the checkout to perform the same locked installs, builds, tests, search and plugin checks, and Worker dry-runs as CI. It does not deploy or publish content.

## License

Skillar is open source: [`server/`](server/LICENSE) and [`worker/`](worker/LICENSE) use **AGPL-3.0-only**; the local CLI ([`local/`](local/LICENSE)), client integrations ([`clients/`](clients/LICENSE)), and other project files remain **MIT** under the [root license](LICENSE).

`server/` and `worker/` are AGPL-3.0-only from the commit introducing [LICENSING.md](LICENSING.md) forward. Copies obtained earlier, including earlier released versions, keep their MIT terms; existing MIT permissions cannot be revoked. See the [licensing map](LICENSING.md) for scope and details.

The name comes from **기술** — Korean for skill, craft, or technique.
