import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cliSandbox, runCli, writeStub } from "./helpers/cli.mjs";

const HOSTED = "https://skillar.sh/mcp";
const connect = (sb) => {
  mkdirSync(join(sb.env.SKILLAR_HOME, "cloud"), { recursive: true });
  writeFileSync(join(sb.env.SKILLAR_HOME, "cloud", "connection.json"), JSON.stringify({
    version: 1, instanceId: "5b8f1d3e-6c1a-4f55-9a52-0b6f3c1d2e44", origin: "https://skillar.sh", accountId: "acct", deviceId: "dev-1",
    generation: 1, token: "A".repeat(43), expiresAt: 4102444800 }));
};
const read = (sb, rel) => readFileSync(join(sb.home, rel), "utf8");
const setup = (t, { stubClaude = true } = {}) => {
  const sb = cliSandbox();
  t.after(sb.cleanup);
  delete sb.env.SKILLAR_NO_CLI;
  const log = join(sb.home, "argv.log");
  if (stubClaude) writeStub(sb.bin, "claude", log);
  // The stub claude writes nothing, so seed the entry a real `claude mcp add` leaves behind.
  writeFileSync(join(sb.home, ".claude.json"), JSON.stringify({ mcpServers: { skillar: { type: "http", url: "http://127.0.0.1:8799/mcp" } } }));
  writeStub(sb.bin, "openclaw", join(sb.home, "openclaw.log"));
  return { sb, log };
};
const sets = (sb) => readdirSync(join(sb.env.SKILLAR_HOME, "backups")).sort();
const manifest = (sb, name) => JSON.parse(readFileSync(join(sb.env.SKILLAR_HOME, "backups", name, "manifest.json"), "utf8"));

test("connected init switches every switchable runtime, reports the rest as still local, and rollback restores the local entries", { timeout: 60000 }, async (t) => {
  const { sb, log } = setup(t);
  assert.equal((await runCli(["init", "--no-service"], sb.env)).code, 0);
  assert.match(read(sb, ".gemini/settings.json"), /127\.0\.0\.1/);
  connect(sb);
  const r = await runCli(["init", "--no-service"], sb.env);
  assert.equal(r.code, 0, r.output);
  assert.doesNotMatch(r.stdout, /^\+.*127\.0\.0\.1:\d+\/mcp/m, "no local daemon registration appears in the plan");
  assert.match(read(sb, ".omo/agent/extensions/skillar/discovery.md"), /skillar\.sh account/);
  assert.equal(JSON.parse(read(sb, ".gemini/settings.json")).mcpServers.skillar.httpUrl, HOSTED);
  assert.ok(JSON.parse(read(sb, ".gemini/settings.json")).hooks.BeforeAgent, "capture hooks stay");
  assert.equal(JSON.parse(read(sb, ".cursor/mcp.json")).mcpServers.skillar.url, HOSTED);
  assert.equal(JSON.parse(read(sb, ".omo/agent/mcp.json")).mcpServers.skillar.url, HOSTED);
  assert.equal(JSON.parse(read(sb, ".gjc/agent/mcp.json")).mcpServers.skillar.url, HOSTED);
  const toml = read(sb, ".codex/config.toml");
  assert.match(toml, /\[mcp_servers\.skillar\]\nurl = "https:\/\/skillar\.sh\/mcp"\n/);
  assert.doesNotMatch(toml, /127\.0\.0\.1:\d+\/mcp/);
  assert.match(toml, /\[otel\]/);
  const calls = readFileSync(log, "utf8");
  assert.match(calls, /^claude mcp remove --scope user skillar$/m);
  assert.match(calls, /^claude mcp add --transport http --scope user skillar https:\/\/skillar\.sh\/mcp$/m);
  assert.match(r.stdout, /hosted skillar MCP for claude-code, codex, gemini, cursor, omo, gajae/);
  assert.match(r.stdout, /still local: openclaw: no verified hosted-MCP registration/);
  assert.doesNotMatch(r.stdout, /for [^\n]*openclaw[^\n]*session upload/);

  // Rollback without --all undoes only the switch.
  const rb = await runCli(["init", "--rollback"], sb.env);
  assert.equal(rb.code, 0, rb.output);
  assert.match(JSON.parse(read(sb, ".gemini/settings.json")).mcpServers.skillar.httpUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.match(JSON.parse(read(sb, ".cursor/mcp.json")).mcpServers.skillar.url, /127\.0\.0\.1/);
  assert.match(read(sb, ".codex/config.toml"), /\[mcp_servers\.skillar\][\s\S]*127\.0\.0\.1:\d+\/mcp/);
  assert.match(readFileSync(log, "utf8"), /^claude mcp add --transport http --scope user skillar http:\/\/127\.0\.0\.1:\d+\/mcp --header /m);
});

test("--local-only and a missing connection never switch", { timeout: 60000 }, async (t) => {
  const { sb } = setup(t);
  const noConn = await runCli(["init", "--no-service"], sb.env);
  assert.doesNotMatch(noConn.stdout, /connected mode:/);
  connect(sb);
  const before = read(sb, ".gemini/settings.json");
  const r = await runCli(["init", "--no-service", "--local-only"], sb.env);
  assert.equal(r.code, 0, r.output);
  assert.equal(read(sb, ".gemini/settings.json"), before);
  assert.doesNotMatch(r.stdout, /connected mode:/);
});

test("an existing remote registration is never rewritten, shown as still local when it is not the hosted one, and survives rollback", { timeout: 60000 }, async (t) => {
  const { sb } = setup(t);
  const other = JSON.stringify({ mcpServers: { skillar: { httpUrl: "https://other.example/mcp" } } }, null, 2) + "\n";
  writeFileSync(join(sb.home, ".gemini", "settings.json"), other);
  const hosted = JSON.stringify({ mcpServers: { skillar: { url: HOSTED } } }, null, 2) + "\n";
  writeFileSync(join(sb.home, ".cursor", "mcp.json"), hosted);
  connect(sb);
  const r = await runCli(["init", "--no-service", "--runtime", "gemini", "--runtime", "cursor"], sb.env);
  assert.equal(r.code, 0, r.output);
  const gem = JSON.parse(read(sb, ".gemini/settings.json"));
  assert.equal(gem.mcpServers.skillar.httpUrl, "https://other.example/mcp");
  assert.match(r.stdout, /still local: gemini: a different remote MCP holds the skillar name/);
  assert.equal(JSON.parse(read(sb, ".cursor/mcp.json")).mcpServers.skillar.url, HOSTED);
  assert.match(r.stdout, /for cursor;/);
  const rb = await runCli(["init", "--rollback", "--all"], sb.env);
  assert.equal(rb.code, 0, rb.output);
  assert.equal(read(sb, ".gemini/settings.json"), other, "other remote untouched through full rollback");
  assert.equal(read(sb, ".cursor/mcp.json"), hosted, "hosted remote untouched through full rollback");
});

test("a failure part-way through the switch restores everything it changed", { timeout: 60000 }, async (t) => {
  const { sb, log } = setup(t, { stubClaude: false });
  const script = join(sb.bin, "claude");
  writeFileSync(script, `#!/bin/sh\nprintf 'claude %s\\n' "$*" >> '${log}'\ncase "$*" in *skillar.sh/mcp*) exit 1;; esac\nexit 0\n`);
  chmodSync(script, 0o755);
  assert.equal((await runCli(["init", "--no-service", "--runtime", "claude-code", "--runtime", "gemini"], sb.env)).code, 0);
  const geminiBefore = read(sb, ".gemini/settings.json");
  connect(sb);
  const r = await runCli(["init", "--no-service", "--runtime", "claude-code", "--runtime", "gemini"], sb.env);
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /command failed .*skillar\.sh\/mcp; rolling back this run/);
  assert.equal(read(sb, ".gemini/settings.json"), geminiBefore, "gemini file restored");
  assert.match(readFileSync(log, "utf8"), /^claude mcp add --transport http --scope user skillar http:\/\/127\.0\.0\.1:\d+\/mcp --header /m);
  const failed = sets(sb).map((n) => manifest(sb, n)).filter((m) => m.status === "failed");
  assert.equal(failed.length, 1);
  assert.ok(failed[0].rolledBackAt);
});

test("dry run previews the connected end state before any connection and never shows a temporary local MCP registration", { timeout: 60000 }, async (t) => {
  const { sb } = setup(t);
  const r = await runCli(["init", "--dry-run", "--no-service"], sb.env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.stdout, /connected mode \(preview\)/);
  assert.match(r.stdout, /connected mode end state: hosted skillar MCP for claude-code, codex, gemini, cursor, omo, gajae/);
  assert.match(r.stdout, /still local: openclaw: no verified hosted-MCP registration/);
  assert.doesNotMatch(r.stdout, /^\+.*127\.0\.0\.1:\d+\/mcp/m, "no local daemon MCP registration in the diffs");
  assert.doesNotMatch(r.stdout, /^command \[[^\]]+\]: claude mcp add [^\n]*127\.0\.0\.1/m, "no local daemon registration command (undo text may mention the restore)");
  assert.match(r.stdout, /skillar\.sh account/);
  const local = await runCli(["init", "--dry-run", "--no-service", "--local-only"], sb.env);
  assert.match(local.stdout, /local-only mode/);
  assert.match(local.stdout, /127\.0\.0\.1:\d+\/mcp/);
});

test("declining the connect re-plans local without overwriting an existing remote registration", { timeout: 60000 }, async (t) => {
  const { sb } = setup(t);
  const { runInit } = await import("../dist/cli/init.js");
  const other = JSON.stringify({ mcpServers: { skillar: { httpUrl: "https://other.example/mcp" } } }, null, 2) + "\n";
  writeFileSync(join(sb.home, ".gemini", "settings.json"), other);
  const lines = [];
  const io = { out: (s) => lines.push(s), err: (s) => lines.push(s), ask: async (q) => { lines.push(q); return "n"; } };
  const env = { ...sb.env, HOME: sb.home };
  const code = await runInit({ noService: true, runtimes: ["gemini", "cursor"] }, env, io, {});
  assert.equal(code, 0, lines.join(""));
  assert.equal(read(sb, ".gemini/settings.json"), other, "existing remote untouched after decline");
  assert.match(lines.join(""), /registering the local daemon MCP entries instead/);
  assert.match(read(sb, ".cursor/mcp.json"), /127\.0\.0\.1:\d+\/mcp/);
});
