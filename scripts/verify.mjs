import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verify({ root = fileURLToPath(new URL("../", import.meta.url)), run = spawnSync } = {}) {
  const checks = [
    ["shared", "bun", ["install", "--frozen-lockfile"]],
    ["shared", "bun", ["run", "build"]],
    ["shared", "bun", ["run", "test"]],
    ["server", "bun", ["install", "--frozen-lockfile"]],
    ["worker", "npm", ["ci"]],
    ["local", "bun", ["install", "--frozen-lockfile"]],
    ["site", "npm", ["ci"]],
    [".", process.execPath, ["scripts/build-theme.mjs"]],
    ["server", "bun", ["run", "build"]],
    ["server", "bun", ["run", "test"]],
    [".", process.execPath, ["server/bench/search.mjs", "--check"]],
    ["server", "bun", ["run", "build:codex-plugin"]],
    ["worker", "npm", ["run", "typecheck"]],
    ["worker", "npm", ["test"]],
    ["site", "npm", ["test"]],
    ["site", "npm", ["run", "build"]],
    [".", process.execPath, ["scripts/check-team-plugin.mjs"]],
    ["local", "bun", ["run", "build"]],
    ["local", "bun", ["run", "typecheck"]],
    ["local", "bun", ["run", "test"]],
    [".", process.execPath, ["local/bench/search.mjs", "--check"]],
    ["worker", "npx", ["--no-install", "wrangler", "deploy", "--config", "wrangler.team.jsonc", "--dry-run"]],
    ["worker", "npx", ["--no-install", "wrangler", "versions", "upload", "--dry-run"]],
    ["worker", "npx", ["--no-install", "wrangler", "deploy", "--config", "wrangler.oauth.jsonc", "--dry-run"]],
    ["worker", "npx", ["--no-install", "wrangler", "deploy", "--config", "wrangler.activity.jsonc", "--dry-run"]],
    ["worker", "npx", ["--no-install", "wrangler", "deploy", "--config", "wrangler.mcp-auth.jsonc", "--dry-run"]],
    ["worker", "npx", ["--no-install", "wrangler", "deploy", "--config", "wrangler.mcp.jsonc", "--dry-run"]],
  ];
  for (const [directory, command, args] of checks) {
    console.log(`Running ${command} ${args.join(" ")} (${directory})`);
    const result = run(command, args, {
      cwd: resolve(root, directory),
      stdio: "inherit",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.signal ?? result.status})`);
  }
  return checks.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    console.log(`Runtime verification passed (${verify()} checks)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
