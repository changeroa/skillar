import { hookCommand as formatHookCommand, isHookCommand } from "../runtime.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpOutcome, PackCtx, PackPlan, RuntimePack } from "../types.js";
import { type JsonObject, keptLocal, isObject, isRemoteEntry, localServerName, noop, planJsonFile, readJsonConfig, refuse, REMOTE_ALREADY_REGISTERED, remoteConflictWarning, remoteEntryUrl, SKILLAR_REMOTE_MCP_URL } from "./json-config.js";

// Hook shape confirmed against https://cursor.com/docs/agent/hooks : hooks.json is { "version": 1, "hooks": { <event>: [{ "command": ... }] } }
// and Cursor reloads hooks config files automatically. MCP servers live in ~/.cursor/mcp.json under mcpServers.
const HOOK_EVENTS = ["beforeSubmitPrompt", "sessionStart", "sessionEnd"];
const URL_KEYS = ["url"];

function localMcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

function hookCommand(ctx: PackCtx): string {
  return formatHookCommand(ctx.bunPath, ctx.packageRoot, "cursor");
}

function isOurHook(entry: unknown): boolean {
  return isObject(entry) && typeof entry.command === "string" && isHookCommand(entry.command) && entry.command.endsWith(" cursor");
}

export const cursorPack: RuntimePack = {
  id: "cursor",

  async detect({ home }) {
    const dir = join(home, ".cursor");
    const installed = existsSync(dir);
    const servers = readJsonConfig(join(dir, "mcp.json")).obj.mcpServers;
    return {
      installed,
      evidence: installed ? [dir] : [],
      remoteSkillarRegistered: isObject(servers) && (isRemoteEntry(servers.gisul, URL_KEYS) || isRemoteEntry(servers.skillar, URL_KEYS)),
    };
  },

  async plan(ctx): Promise<PackPlan> {
    const dir = join(ctx.home, ".cursor");
    if (!existsSync(dir)) return noop("~/.cursor not found; Cursor does not appear to be installed, nothing planned.");
    const mcpPath = join(dir, "mcp.json");
    const hooksPath = join(dir, "hooks.json");
    const mcp = readJsonConfig(mcpPath);
    const hooksFile = readJsonConfig(hooksPath);
    for (const [path, cfg] of [
      [mcpPath, mcp],
      [hooksPath, hooksFile],
    ] as const) {
      if (cfg.error) return refuse(path, "unparseable_config", cfg.error);
    }

    const nextMcp: JsonObject = structuredClone(mcp.obj);
    const servers = nextMcp.mcpServers ?? {};
    if (!isObject(servers)) return refuse(mcpPath, "invalid_shape", "mcpServers must be a JSON object");
    const notes: string[] = [];
    if (ctx.disableRemote && isRemoteEntry(servers.gisul, URL_KEYS)) {
      notes.push("Remote skillar MCP entry left enabled: Cursor's disable key is unverified, so disable it manually.");
    }
    const remoteUrl = remoteEntryUrl(servers.skillar, URL_KEYS);
    if (remoteUrl !== null && remoteUrl !== SKILLAR_REMOTE_MCP_URL) return ctx.mcp === "hosted" ? keptLocal(remoteConflictWarning(remoteUrl), "a different remote MCP holds the skillar name") : noop(remoteConflictWarning(remoteUrl));
    let mcpOutcome: McpOutcome | undefined;
    // Already pointing at the hosted skillar MCP: keep the registration, still install capture.
    if (remoteUrl === SKILLAR_REMOTE_MCP_URL) { notes.push(REMOTE_ALREADY_REGISTERED); mcpOutcome = { state: "already_hosted" }; }
    else if (ctx.mcp === "hosted") {
      const local = localServerName(servers);
      if (local !== "skillar") delete servers[local];
      servers.skillar = { url: SKILLAR_REMOTE_MCP_URL };
      mcpOutcome = { state: "hosted" };
    } else servers[localServerName(servers)] = { url: localMcpUrl(ctx.port), headers: { Authorization: `Bearer ${ctx.token}` } };
    nextMcp.mcpServers = servers;

    if (hooksFile.obj.version !== undefined && hooksFile.obj.version !== 1) {
      return refuse(hooksPath, "invalid_shape", "hooks.json version must be 1");
    }
    const nextHooks: JsonObject = { ...structuredClone(hooksFile.obj), version: 1 };
    const hooks = nextHooks.hooks ?? {};
    if (!isObject(hooks)) return refuse(hooksPath, "invalid_shape", "hooks must be a JSON object");
    for (const event of HOOK_EVENTS) {
      const entries = hooks[event] ?? [];
      if (!Array.isArray(entries)) return refuse(hooksPath, "invalid_shape", `hooks.${event} must be an array`);
      hooks[event] = [...entries.filter((entry) => !isOurHook(entry)), { command: hookCommand(ctx) }];
    }
    nextHooks.hooks = hooks;

    const files = [planJsonFile(mcpPath, mcp, nextMcp), planJsonFile(hooksPath, hooksFile, nextHooks)].filter(
      (f) => f !== null,
    );
    notes.push("Restart Cursor or reload MCP servers to load the skillar MCP entry; Cursor reloads hooks.json on change.");
    return { files, commands: [], notes, conflicts: [], ...(mcpOutcome ? { mcp: mcpOutcome } : {}) };
  },

  async doctorChecks({ home, port }) {
    const mcp = readJsonConfig(join(home, ".cursor", "mcp.json"));
    if (mcp.error) return [{ name: "cursor mcp.json", ok: false, detail: mcp.error }];
    const hooksFile = readJsonConfig(join(home, ".cursor", "hooks.json"));
    if (hooksFile.error) return [{ name: "cursor hooks.json", ok: false, detail: hooksFile.error }];
    const servers: JsonObject = isObject(mcp.obj.mcpServers) ? mcp.obj.mcpServers : {};
    const entry: JsonObject = isObject(servers[localServerName(servers)]) ? servers[localServerName(servers)] as JsonObject : {};
    const hooks: JsonObject = isObject(hooksFile.obj.hooks) ? hooksFile.obj.hooks : {};
    const hooksPresent = HOOK_EVENTS.every((event) => {
      const entries = hooks[event];
      return Array.isArray(entries) && entries.some(isOurHook);
    });
    return [
      { name: "cursor MCP skillar", ok: entry.url === localMcpUrl(port), detail: `url ${String(entry.url ?? "missing")}` },
      {
        name: "cursor capture hooks",
        ok: hooksPresent,
        detail: hooksPresent ? "beforeSubmitPrompt, sessionStart, sessionEnd present" : "capture hooks missing; rerun skillar init",
      },
    ];
  },
};
