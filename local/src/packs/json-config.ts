import { existsSync, readFileSync, statSync } from "node:fs";
import type { PackPlan, PackPlanFile } from "../types.js";

export type JsonObject = Record<string, unknown>;
export type JsonConfig = { before: string | null; obj: JsonObject; error?: string };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readJsonConfig(path: string): JsonConfig {
  if (!existsSync(path)) return { before: null, obj: {} };
  const before = readFileSync(path, "utf8");
  if (before.trim() === "") return { before, obj: {} };
  try {
    const parsed: unknown = JSON.parse(before);
    if (isObject(parsed)) return { before, obj: parsed };
    return { before, obj: {}, error: "top-level value is not a JSON object" };
  } catch (err) {
    return { before, obj: {}, error: `not valid JSON: ${(err as Error).message}` };
  }
}

export function fileMode(path: string): number {
  return existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
}

export function planJsonFile(path: string, current: JsonConfig, next: JsonObject): PackPlanFile | null {
  const after = `${JSON.stringify(next, null, 2)}\n`;
  if (after === current.before) return null;
  return { path, before: current.before, after, mode: fileMode(path) };
}

export function refuse(path: string, code: string, detail: string): PackPlan {
  return { files: [], commands: [], notes: [], conflicts: [{ path, code, detail }] };
}

export function noop(note: string): PackPlan {
  return { files: [], commands: [], notes: [note], conflicts: [] };
}

/** Plan that changes nothing and records why this runtime keeps its local daemon MCP entry in connected mode. */
export function keptLocal(note: string, reason: string): PackPlan {
  return { files: [], commands: [], notes: [note], conflicts: [], mcp: { state: "kept_local", reason } };
}

export function isRemoteEntry(entry: unknown, urlKeys: string[]): boolean {
  if (!isObject(entry)) return false;
  return urlKeys.some((key) => {
    const raw = entry[key];
    if (typeof raw !== "string") return false;
    try {
      return !LOOPBACK_HOSTS.has(new URL(raw).hostname);
    } catch {
      return false;
    }
  });
}

/** Keep a legacy local registration's key so init never adds a second provider. */
export function localServerName(servers: JsonObject): "skillar" | "gisool" {
  return !Object.hasOwn(servers, "skillar") && isObject(servers.gisool) && !isRemoteEntry(servers.gisool, ["url", "httpUrl"]) ? "gisool" : "skillar";
}

/** The hosted skillar MCP endpoint a previous remote registration points at. */
export const SKILLAR_REMOTE_MCP_URL = "https://skillar.sh/mcp";

/**
 * Normalized remote URL of an MCP entry (url-style keys or an mcp-remote
 * command bridge), or null when the entry is local or carries no remote URL.
 */
export function remoteEntryUrl(entry: unknown, urlKeys: string[]): string | null {
  if (!isObject(entry)) return null;
  const from = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return LOOPBACK_HOSTS.has(url.hostname) ? null : url.toString().replace(/\/+$/, "");
    } catch {
      return null;
    }
  };
  for (const key of urlKeys) {
    const found = from(entry[key]);
    if (found !== null) return found;
  }
  const argv = [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])];
  for (const arg of argv) {
    const found = from(arg);
    if (found !== null) return found;
  }
  return null;
}

/** Skip note when the existing remote registration already is the hosted skillar MCP. */
export const REMOTE_ALREADY_REGISTERED =
  `existing remote skillar registration (${SKILLAR_REMOTE_MCP_URL}) kept; skipping local daemon registration for this runtime`;

/** Skip note when a different remote MCP holds the skillar name. */
export function remoteConflictWarning(url: string): string {
  return `warning: a different remote MCP named skillar (${url}) is registered; skipping this runtime - remove that registration to install the local daemon`;
}
