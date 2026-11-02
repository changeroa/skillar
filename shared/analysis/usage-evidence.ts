import type { AssignedTreeEvent, RuntimeId, SkillSpan, TurnTree } from "./types.js";
import type { SupportingRead } from "./usage-types.js";

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function skillDirHint(span: SkillSpan): string | null {
  const path = stringOf(span.activation.data.path);
  if (path === undefined) return null;
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : null;
}
function readFileBelongsTo(event: AssignedTreeEvent, span: SkillSpan): boolean {
  const skillUri = event.skillUri ?? stringOf(event.data.skillUri) ?? null;
  if (skillUri === null) return false;
  if (span.uri !== null) return skillUri === span.uri;
  return skillUri.split("/").at(-2) === span.name;
}
const COMMAND_KEYS = new Set(["command", "full_command", "bash_command", "cmd", "argv", "script", "shell_command"]);
type ArgString = { readonly text: string; readonly command: boolean };

/** Command-key values are shell text; other JSON strings remain whole path arguments. */
function collectArgStrings(text: string): ArgString[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [{ text, command: true }];
  }
  const out: ArgString[] = [];
  const walk = (value: unknown, command: boolean): void => {
    if (typeof value === "string") out.push({ text: value, command });
    else if (Array.isArray(value)) for (const item of value) walk(item, command);
    else if (value !== null && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) walk(item, command || COMMAND_KEYS.has(key));
    }
  };
  walk(parsed, false);
  return out.length > 0 ? out : [{ text, command: true }];
}
/** Shell-like splitting preserves backslashes except when they escape separators or quotes. */
function shellTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let open = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (quote === null && /\s/.test(char)) {
      if (open) tokens.push(current);
      current = "";
      open = false;
      continue;
    }
    if (quote === null && (char === '"' || char === "'")) {
      quote = char;
      open = true;
      continue;
    }
    if (quote === char) {
      quote = null;
      continue;
    }
    const next = text[i + 1];
    if (char === "\\" && quote !== "'" && next !== undefined && (/\s/.test(next) || next === '"' || next === "'" || next === "\\")) {
      current += next;
      open = true;
      i += 1;
      continue;
    }
    current += char;
    open = true;
  }
  if (open) tokens.push(current);
  return tokens;
}
function normalizePath(path: string): string {
  return path.replace(/\\+/g, "/").replace(/\/+$/, "");
}
/** Match whole path tokens; a command naming only a directory is not a file read. */
function tokenReferencesDir(token: string, dir: string, insideOnly: boolean): boolean {
  const path = normalizePath(token);
  const target = normalizePath(dir);
  if (path === "" || target === "") return false;
  if (path.startsWith(`${target}/`)) return true;
  const rooted = target.startsWith("/") || /^[A-Za-z]:\//.test(target);
  if (!rooted && path.includes(`/${target}/`)) return true;
  if (insideOnly) return false;
  return path === target || (!rooted && path.endsWith(`/${target}`));
}
function argsReferenceSkillDir(event: AssignedTreeEvent, span: SkillSpan, dirHint: string | null): boolean {
  if (event.text === null) return false;
  const target = dirHint ?? span.name;
  for (const { text, command } of collectArgStrings(event.text)) {
    for (const token of command ? shellTokens(text) : [text]) {
      if (tokenReferencesDir(token, target, command)) return true;
    }
  }
  return false;
}
export function supportingReadsOf(span: SkillSpan, turn: TurnTree): SupportingRead[] {
  const reads: SupportingRead[] = [];
  const start = turn.events.findIndex((e) => e.id === span.activation.id);
  // Source row order, not timestamps, decides which reads followed the activation.
  for (const event of turn.events.slice(start < 0 ? turn.events.length : start + 1)) {
    if (event.kind === "read_file" && readFileBelongsTo(event, span)) {
      reads.push({ eventId: event.id, kind: "read_file", uri: event.skillUri ?? stringOf(event.data.uri) ?? null, label: "reported" });
    }
  }
  if (span.activation.kind !== "native_skill") return reads;
  const dirHint = skillDirHint(span);
  for (const event of span.events) {
    if (event.kind !== "tool_call" || isSkillarMcpData(event.data)) continue;
    if (argsReferenceSkillDir(event, span, dirHint)) {
      reads.push({ eventId: event.id, kind: "tool_call", uri: null, label: "heuristic" });
    }
  }
  return reads;
}
/** The historical gisoolMcp flag still marks a skillar MCP call. */
export function isSkillarMcpData(data: Readonly<Record<string, unknown>>): boolean {
  return (data.skillarMcp ?? data.gisoolMcp) === true;
}
const SHELL_TOOLS = new Set(["exec_command", "Bash", "shell", "local_shell"]);
export function activityKind(event: AssignedTreeEvent, runtime: RuntimeId): "command" | "unresolved_exec" | "other" {
  const toolName = stringOf(event.data.toolName);
  if (runtime === "codex" && toolName === "exec") return "unresolved_exec";
  return toolName !== undefined && SHELL_TOOLS.has(toolName) ? "command" : "other";
}
