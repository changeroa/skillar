import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/** Limits mirror the private publication package contract (docs/private-skills.md). */
export const SYNC_MAX_RESOURCES = 128;
export const SYNC_MAX_RESOURCE_BYTES = 512 * 1024;
export const SYNC_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const SYNC_MAX_SKILL_MD_BYTES = 64 * 1024;

export type SyncRoot = { id: string; path: string };
export type SkipReason =
  | "external_pack_unverified" | "managed_sync_external" | "runtime_default_excluded" | "external_pack_marker" | "symlink_or_special_file" | "secret_like_file" | "binary_or_archive_file"
  | "secret_pattern_in_content" | "limit_exceeded" | "invalid_skill_md" | "unreadable";
export type PlannedSkill = {
  /** Stable key: <deviceId or "unconnected">/<rootId>/<relative dir>. Account and connection generation are added by the apply step, not by this dry run. */
  key: string; rootId: string; dir: string; name: string | null; resources: number; bytes: number; digest: string | null;
  /** "candidate" means it passed every LOCAL check. It is not an upload decision: see SyncPlan.uploadDecision and `unresolved`. */
  decision: "candidate" | "hold_name_conflict" | "skipped";
  /** Checks this dry run cannot make. Present on every candidate; an upload step must resolve them first. */
  review?: Unresolved[];
  reason?: SkipReason; detail?: string;
  /** Other local keys with the same content digest (possible duplicate or moved copy; never merged automatically). */
  sameContentAs?: string[];
};
/** ownership_unverified: nothing proves the user authored or may publish this skill (no positive evidence either way). */
export type Unresolved = "account_identity" | "connection_generation" | "remote_same_name_conflict" | "ownership_unverified";
export type SyncPlan = { dryRun: true; sent: false;
  /** Always "unknown_needs_review" in this step: nothing here may be read as permission to upload. */
  uploadDecision: "unknown_needs_review"; unresolved: Unresolved[];
  /** Keys use the device id only (or "unconnected"). They are NOT the final identity: account and connection generation are not part of them yet. */
  identity: { final: false; basis: string };
  deviceId: string; roots: { id: string; path: string; present: boolean }[]; skills: PlannedSkill[];
  summary: { candidates: number; held: number; skipped: number }; notes: string[] };

const EXTERNAL_SEGMENTS = new Set(["plugins", "plugin", "marketplace", "marketplaces", "node_modules", ".system", ".git", "vendor", "packs"]);
const SECRET_FILE = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore|kdbx|token|secret|secrets)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials(\..*)?|secrets?(\..*)?|\.netrc|\.npmrc|\.pypirc|.*_token|.*\.env)$/i;
const BINARY_EXT = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "exe", "dll", "so", "dylib", "bin", "class", "jar", "wasm", "o", "a", "pyc", "db", "sqlite", "sqlite3", "png", "jpg", "jpeg", "gif", "webp", "pdf", "mp3", "mp4", "mov", "ico"]);
const IGNORED = new Set([".DS_Store", "Thumbs.db"]);

/** Content patterns. A match skips the whole skill; the matched text is never printed, only file, line and pattern name. */
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "private_key_block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "aws_access_key_id", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "github_token", re: /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/ },
  { name: "slack_token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "openai_style_key", re: /\bsk-[A-Za-z0-9_-]{24,}/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "bearer_token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/ },
  // Assignments to secret-looking names with a long, placeholder-free literal value. Short or templated values ("<token>", "${TOKEN}", "your-key") do not match.
  { name: "secret_assignment", re: /\b(api[_-]?key|secret|token|passwd|password|private[_-]?key|access[_-]?key)\b["']?\s*[:=]\s*["']?(?![<$\{])[A-Za-z0-9_\-/+=.]{20,}["']?\s*$/im },
];
function scanSecrets(rel: string, text: string): Skip | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const p of SECRET_PATTERNS) if (p.re.test(lines[i]!)) return new Skip("secret_pattern_in_content", `${rel}:${i + 1} matches ${p.name}`);
  }
  return null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SYNCED_UUID_PAIR = new RegExp(`^${UUID}_${UUID}$`, "i");
/** Markers that positively identify a plugin or extension package (never a skill name). */
const PACK_MARKERS = [".claude-plugin", ".codex-plugin", "plugin.json", "openclaw.plugin.json"];

/** Configured default exclusion policy (not a provenance finding): runtime skill roots whose contents are mostly runtime-installed. A single skill can be opted in by "<rootId>/<dir>". */
export const DEFAULT_EXCLUDED_ROOTS: ReadonlySet<string> = new Set(["gajae"]);

const sha = (b: Uint8Array | string) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const hasNul = (b: Buffer) => b.subarray(0, 8192).includes(0);

class Skip extends Error {
  constructor(readonly reason: SkipReason, readonly detail: string) { super(detail); }
}

async function skillDirs(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue; // never follow symlinked directories
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      try { if ((await lstat(path.join(dir, entry.name, "SKILL.md"))).isFile()) out.push(rel); } catch { /* not a skill dir */ }
      await walk(path.join(dir, entry.name), rel);
    }
  }
  await walk(root, "");
  return out.sort();
}

async function files(base: string): Promise<{ rel: string; abs: string; size: number }[]> {
  const out: { rel: string; abs: string; size: number }[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (IGNORED.has(entry.name)) continue;
      const info = await lstat(abs);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Skip("symlink_or_special_file", rel);
      if (info.isDirectory()) { await walk(abs, rel); continue; }
      out.push({ rel, abs, size: info.size });
      if (out.length > SYNC_MAX_RESOURCES * 4) throw new Skip("limit_exceeded", `more than ${SYNC_MAX_RESOURCES} resources`);
    }
  }
  await walk(base, "");
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

function frontmatter(text: string): { name: string; description: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m) throw new Skip("invalid_skill_md", "missing front matter");
  let meta: unknown;
  try { meta = parseYaml(m[1]!); } catch { throw new Skip("invalid_skill_md", "front matter is not valid YAML"); }
  const o = meta as Record<string, unknown> | null;
  if (!o || typeof o.name !== "string" || !o.name.trim() || typeof o.description !== "string" || !o.description.trim()) {
    throw new Skip("invalid_skill_md", "front matter needs name and description");
  }
  return { name: o.name.trim(), description: o.description.trim() };
}

async function inspect(rootId: string, rootDir: string, dir: string, prefix: string, include: ReadonlySet<string>): Promise<PlannedSkill> {
  const key = `${prefix}/${rootId}/${dir}`;
  const base: PlannedSkill = { key, rootId, dir, name: null, resources: 0, bytes: 0, digest: null, decision: "skipped" };
  try {
    // Origin of an external pack or plugin is not verified here, so it is excluded by default (an explicit include is a later step).
    // Claude-managed synced folder: a segment "synced" directly followed by a <uuid>_<uuid> folder (both must match, a name alone is not enough).
    const parts = dir.split("/");
    if (DEFAULT_EXCLUDED_ROOTS.has(rootId) && !include.has(`${rootId}/${dir}`)) throw new Skip("runtime_default_excluded", `${rootId} runtime root is excluded by default policy (configured, not a provenance finding; the user may be the author of some skills). Opt in with --include ${rootId}/${dir}`);
    const syncedAt = parts.findIndex((seg, i) => seg === "synced" && SYNCED_UUID_PAIR.test(parts[i + 1] ?? ""));
    if (syncedAt >= 0) throw new Skip("managed_sync_external", `synced/<uuid>_<uuid> folder under ${rootId} is managed and provided externally, not authored here`);
    // Positive plugin/extension package marker in the skill dir or any ancestor below the root.
    for (let i = parts.length; i >= 0; i--) {
      const at = path.join(rootDir, ...parts.slice(0, i));
      for (const m of PACK_MARKERS) {
        try { await lstat(path.join(at, m)); throw new Skip("external_pack_marker", `${m} found at ${parts.slice(0, i).join("/") || "(root)"}; packaged by a plugin or extension`); } catch (e) { if (e instanceof Skip) throw e; }
      }
    }
    const seg = dir.split("/").find((s) => EXTERNAL_SEGMENTS.has(s));
    if (seg !== undefined) throw new Skip("external_pack_unverified", `path segment "${seg}"; source and license not verified`);
    const abs = path.join(rootDir, dir);
    const list = await files(abs);
    const resources: { uri: string; digest: string; size: number }[] = [];
    let total = 0;
    for (const f of list) {
      const name = path.posix.basename(f.rel);
      if (SECRET_FILE.test(name)) throw new Skip("secret_like_file", f.rel);
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
      if (BINARY_EXT.has(ext)) throw new Skip("binary_or_archive_file", f.rel);
      if (f.size > SYNC_MAX_RESOURCE_BYTES) throw new Skip("limit_exceeded", `${f.rel} is ${f.size} bytes (max ${SYNC_MAX_RESOURCE_BYTES})`);
      total += f.size;
      if (total > SYNC_MAX_TOTAL_BYTES) throw new Skip("limit_exceeded", `total exceeds ${SYNC_MAX_TOTAL_BYTES} bytes`);
      if (list.length > SYNC_MAX_RESOURCES) throw new Skip("limit_exceeded", `${list.length} resources (max ${SYNC_MAX_RESOURCES})`);
      const bytes = await readFile(f.abs);
      if (hasNul(bytes)) throw new Skip("binary_or_archive_file", f.rel);
      let decoded: string;
      try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Skip("binary_or_archive_file", `${f.rel} is not valid UTF-8 text`); }
      const hit = scanSecrets(f.rel, decoded);
      if (hit) throw hit;
      if (f.rel === "SKILL.md") {
        if (f.size > SYNC_MAX_SKILL_MD_BYTES) throw new Skip("limit_exceeded", `SKILL.md is ${f.size} bytes (max ${SYNC_MAX_SKILL_MD_BYTES})`);
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Skip("invalid_skill_md", "SKILL.md is not valid UTF-8"); }
        base.name = frontmatter(text).name;
      }
      resources.push({ uri: f.rel, digest: sha(bytes), size: f.size });
    }
    if (base.name === null) throw new Skip("invalid_skill_md", "SKILL.md missing");
    base.resources = resources.length; base.bytes = total;
    base.digest = sha(JSON.stringify(resources));
    base.decision = "candidate"; base.review = ["account_identity", "connection_generation", "remote_same_name_conflict", "ownership_unverified"];
  } catch (error) {
    if (error instanceof Skip) { base.reason = error.reason; base.detail = error.detail; } else { base.reason = "unreadable"; base.detail = (error as Error).message; }
  }
  return base;
}

/** Read-only dry run. It never writes, contacts the network, or changes consent. Remote same-name conflicts are not checked here. */
export async function planSkillSync(roots: readonly SyncRoot[], opts: { deviceId?: string | null; include?: readonly string[] } = {}): Promise<SyncPlan> {
  const deviceId = opts.deviceId ?? "unconnected";
  const skills: PlannedSkill[] = [];
  const rootInfo: SyncPlan["roots"] = [];
  for (const r of roots) {
    let present = false;
    try { present = (await lstat(r.path)).isDirectory(); } catch { /* absent root */ }
    rootInfo.push({ id: r.id, path: r.path, present });
    if (!present) continue;
    for (const dir of await skillDirs(r.path)) skills.push(await inspect(r.id, r.path, dir, deviceId, new Set(opts.include ?? [])));
  }
  const byName = new Map<string, PlannedSkill[]>();
  const byDigest = new Map<string, PlannedSkill[]>();
  for (const s of skills) {
    if (s.decision !== "candidate" || s.name === null || s.digest === null) continue;
    byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
    byDigest.set(s.digest, [...(byDigest.get(s.digest) ?? []), s]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const s of group) { s.decision = "hold_name_conflict"; s.detail = `same name "${s.name}" in ${group.length} local locations`; }
  }
  for (const group of byDigest.values()) {
    if (group.length < 2) continue;
    for (const s of group) s.sameContentAs = group.filter((o) => o !== s).map((o) => o.key);
  }
  return { dryRun: true, sent: false, uploadDecision: "unknown_needs_review",
    unresolved: ["account_identity", "connection_generation", "remote_same_name_conflict", "ownership_unverified"],
    identity: { final: false, basis: deviceId === "unconnected" ? "no device connection: key has no device id" : "device id only; account and connection generation are not included yet" },
    deviceId, roots: rootInfo, skills,
    summary: { candidates: skills.filter((s) => s.decision === "candidate").length, held: skills.filter((s) => s.decision === "hold_name_conflict").length,
      skipped: skills.filter((s) => s.decision === "skipped").length },
    notes: ["dry run: nothing was uploaded and no consent or setting was changed",
      "candidates are NOT cleared for upload: account identity, connection generation and same-name conflicts with skills already in the account are unresolved (unknown, needs review)",
      "keys are not final identities",
      "ownership is not proven for any candidate: only positive evidence (managed synced folder shape, plugin package marker, vendor-like path segment) excludes a skill; a skill name alone never does",
      "content scan is pattern based and can miss secrets; a skipped skill shows file, line and pattern name only",
      "local deletions would keep the remote copy and mark it as missing locally (applied in a later step)"] };
}

export function renderSyncPlan(plan: SyncPlan): string {
  const lines = [`skill sync dry run (device ${plan.deviceId}): ${plan.summary.candidates} local candidates (upload decision: unknown, needs review), ${plan.summary.held} held, ${plan.summary.skipped} skipped`];
  for (const s of plan.skills) {
    const tail = s.decision === "candidate" ? `${s.resources} files, ${s.bytes} bytes` : `${s.reason ?? "name_conflict"}${s.detail ? `: ${s.detail}` : ""}`;
    lines.push(`  ${s.decision.padEnd(18)} ${s.key} (${s.name ?? "?"}) ${tail}${s.sameContentAs ? ` [same content as ${s.sameContentAs.length} other]` : ""}`);
  }
  for (const n of plan.notes) lines.push(`note: ${n}`);
  return lines.join("\n") + "\n";
}
