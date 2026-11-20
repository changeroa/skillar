import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DEFAULT_PORT, defaultConfigFile, ensureSkillarHome, expandHome, loadConfig, resolveSkillarHome, resolveHome } from "../config.js";
import { PACKS, getPack } from "../packs/registry.js";
import type { SkillarConfig, PackCtx, PackPlan, PackPlanFile, RuntimeId, RuntimePack } from "../types.js";
import { assertPlatform } from "../version.js";
import { type AppliedFile, WriterError, applyFiles, changedFiles, maskSecrets, removeEmptyDirs, restoreFiles, unifiedDiff, unparseable } from "./config-writer.js";
import { readConnection } from "../sync/cloud-connection.js";
import { dashboardUrl } from "./open.js";
import { connectCloudDeviceFlow } from "../sync/cloud-pending.js";
import { type Io, type PlannedCommand, currentServicePlatform, daemonLogPath, nodePath, packageRoot, planService, servicePath, serviceLabel } from "./serve.js";

export type InitOptions = { dryRun?: boolean; runtimes?: string[]; rollback?: boolean; all?: boolean; noService?: boolean; disableRemote?: boolean; serviceOnly?: boolean; connect?: boolean; upload?: boolean; localOnly?: boolean };
export type InitHooks = {
  afterPlan?: () => void | Promise<void>;
  /** Test/stub seam for the browser-approval connect step; production leaves both unset. */
  fetcher?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
};

type RecordedCommand = { argv: string[]; description: string; undo?: { argv: string[]; description: string }; exitCode: number | null; allowFailure?: boolean };
export type BackupManifest = {
  version: 1; createdAt: string; status: "applied" | "failed"; home: string; runtimes: RuntimeId[]; service: string | null;
  files: AppliedFile[]; createdDirs: string[]; commands: RecordedCommand[];
  rolledBackAt?: string; rollback?: { files: { path: string; action: string }[]; commands: RecordedCommand[] };
};

// Planning never writes: a first run plans against default config and an in-memory token, and materialize() persists
// both only once the apply starts, so dry runs and aborted runs leave HOME byte-identical.
function readConfigForPlan(env: NodeJS.ProcessEnv): { config: SkillarConfig; token: string; materialize(): void } {
  const skillarHome = resolveSkillarHome(env);
  const tokenPath = join(skillarHome, "token");
  const configPath = join(skillarHome, "config.json");
  if (existsSync(configPath) && existsSync(tokenPath)) {
    const config = loadConfig(env);
    return { config, token: readFileSync(tokenPath, "utf8").trim(), materialize: () => undefined };
  }
  const home = resolveHome(env);
  const d = defaultConfigFile();
  let port = DEFAULT_PORT;
  if (existsSync(configPath)) {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { port?: unknown };
    if (typeof parsed.port === "number") port = parsed.port;
  }
  const config: SkillarConfig = { port, captureLevel: d.captureLevel, retentionDays: d.retentionDays, roots: d.roots.map((r) => ({ id: r.id, path: expandHome(r.path, home) })), runtimes: {} };
  const token = existsSync(tokenPath) ? readFileSync(tokenPath, "utf8").trim() : randomBytes(32).toString("hex");
  return {
    config,
    token,
    materialize() {
      ensureSkillarHome(env);
      if (!existsSync(tokenPath)) {
        writeFileSync(tokenPath, token + "\n", { mode: 0o600, flag: "wx" });
        chmodSync(tokenPath, 0o600);
      }
      loadConfig(env);
    },
  };
}

export function backupsDir(skillarHome: string): string {
  return join(skillarHome, "backups");
}

function newBackupDir(skillarHome: string): string {
  const root = backupsDir(skillarHome);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  let dir = join(root, stamp);
  for (let i = 1; existsSync(dir); i++) dir = join(root, `${stamp}-${String(i).padStart(3, "0")}`);
  mkdirSync(dir, { mode: 0o700 });
  return dir;
}

export function listBackupSets(skillarHome: string): { dir: string; manifest: BackupManifest }[] {
  const root = backupsDir(skillarHome);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .reverse()
    .flatMap((name) => {
      const path = join(root, name, "manifest.json");
      if (!existsSync(path)) return [];
      return [{ dir: join(root, name), manifest: JSON.parse(readFileSync(path, "utf8")) as BackupManifest }];
    });
}

function writeManifest(dir: string, manifest: BackupManifest): void {
  const path = join(dir, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

function run(argv: string[], env: NodeJS.ProcessEnv, io: Io): number | null {
  const r = spawnSync(argv[0]!, argv.slice(1), { env, encoding: "utf8" });
  if (r.stdout) io.out(r.stdout);
  if (r.stderr) io.err(r.stderr);
  if (r.error) io.err(`failed to run ${argv[0]}: ${r.error.message}\n`);
  return r.status;
}

function parseRuntimeIds(ids: string[]): { ok: RuntimePack[]; unknown: string[] } {
  const ok: RuntimePack[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const pack = getPack(id);
    if (pack) ok.push(pack);
    else unknown.push(id);
  }
  return { ok, unknown };
}

export async function runInit(opts: InitOptions, env: NodeJS.ProcessEnv, io: Io, hooks: InitHooks = {}): Promise<number> {
  assertPlatform();
  if (opts.rollback) return runRollback({ all: opts.all ?? false }, env, io);
  const home = resolveHome(env);
  const skillarHome = resolveSkillarHome(env);
  const { config, token, materialize } = readConfigForPlan(env);
  const mask = (t: string) => maskSecrets(t, [token]);
  const ctx: PackCtx = { home, env, port: config.port, token, nodePath: nodePath(), packageRoot: packageRoot(), disableRemote: opts.disableRemote ?? false, mcp: "local" };

  const selected: RuntimePack[] = [];
  if (!opts.serviceOnly) {
    io.out("MCP connections accept revision 2026-07-28 and legacy initialize clients (2024-11-05 to 2025-11-25); skill bodies need a host resource reader.\n");
    const requested = parseRuntimeIds(opts.runtimes ?? []);
    if (requested.unknown.length) {
      io.err(`unknown_runtime: ${requested.unknown.join(", ")} (known: ${PACKS.map((p) => p.id).join(", ")})\n`);
      return 2;
    }
    for (const pack of PACKS) {
      const d = await pack.detect({ home, env });
      io.out(`runtime ${pack.id}: ${d.installed ? `detected (${d.evidence.join(", ")})` : "not detected"}; remoteSkillarRegistered=${d.remoteSkillarRegistered}\n`);
      const wanted = requested.ok.length ? requested.ok.includes(pack) : d.installed && config.runtimes[pack.id]?.enabled !== false;
      if (wanted) selected.push(pack);
    }
  }

  // Connected mode is the default: the final state is the hosted MCP, so planning (and the dry run) shows that state and never registers the local
  // daemon entry first. --local-only, --no-connect, a non-interactive run without --connect, a declined or failed connect all plan the local entry.
  const connectedWanted = opts.localOnly !== true && opts.serviceOnly !== true && opts.connect !== false;
  const alreadyConnected = readConnection(skillarHome) !== null;
  // A real run only plans the hosted end state when a connection is or can be made in this run; a dry run always previews the connected end state.
  const willConnect = connectedWanted && (alreadyConnected || opts.connect === true || io.ask !== undefined);
  const hostedFirst = selected.length > 0 && connectedWanted && (opts.dryRun === true || willConnect);
  const planAll = async (mcp: "local" | "hosted"): Promise<{ id: string; plan: PackPlan }[]> => {
    const out: { id: string; plan: PackPlan }[] = [];
    for (const pack of selected) {
      try {
        out.push({ id: pack.id, plan: await pack.plan({ ...ctx, mcp }) });
      } catch (error) {
        out.push({ id: pack.id, plan: { files: [], commands: [], notes: [], conflicts: [{ path: pack.id, code: "plan_failed", detail: (error as Error).message }] } });
      }
    }
    return out;
  };
  let serviceFile: string | null = null;
  const buildPlans = async (mcp: "local" | "hosted") => {
    const plans = await planAll(mcp);
    serviceFile = null;
    if (!opts.noService) {
      const svc = planService({ home, skillarHome, env, nodePath: ctx.nodePath, packageRoot: ctx.packageRoot, platform: currentServicePlatform(), uid: process.getuid?.() ?? 0 });
      plans.push({ id: "service", plan: { files: [svc.file], commands: svc.commands, notes: svc.notes, conflicts: [] } });
      serviceFile = svc.file.path;
    }
    const files: PackPlanFile[] = plans.flatMap((p) => p.plan.files);
    const commands: PlannedCommand[] = plans.flatMap((p) => p.plan.commands);
    const conflicts = plans.flatMap((p) => p.plan.conflicts.map((c) => ({ ...c, runtime: p.id })));
    for (const f of changedFiles(files)) {
      const why = unparseable(f);
      if (why) conflicts.push({ path: f.path, code: "unparseable_config", detail: why, runtime: "writer" });
    }
    const seen = new Set<string>();
    for (const f of changedFiles(files)) {
      if (seen.has(f.path)) conflicts.push({ path: f.path, code: "duplicate_target", detail: "planned by more than one pack", runtime: "writer" });
      seen.add(f.path);
    }
    return { plans, files, commands, conflicts };
  };
  const show = (plans: { id: string; plan: PackPlan }[]): void => {
    for (const p of plans) {
      for (const f of changedFiles(p.plan.files)) io.out(mask(unifiedDiff(f.path, f.before, f.after)));
      for (const c of p.plan.commands) io.out(mask(`command [${p.id}]: ${c.argv.join(" ")}${c.undo ? `  (undo: ${c.undo.argv.join(" ")})` : ""}\n`));
      for (const n of p.plan.notes) io.out(mask(`note [${p.id}]: ${n}\n`));
    }
  };
  const mcpSummary = (plans: { id: string; plan: PackPlan }[]): void => {
    const hosted = plans.filter((p) => p.id !== "service" && (p.plan.mcp?.state === "hosted" || p.plan.mcp?.state === "already_hosted")).map((p) => p.id);
    const local = plans.filter((p) => p.id !== "service" && p.plan.mcp?.state !== "hosted" && p.plan.mcp?.state !== "already_hosted");
    io.out(`connected mode end state: hosted skillar MCP for ${hosted.length ? hosted.join(", ") : "no runtime"}; session upload consent is separate and unchanged\n`);
    for (const p of local) io.out(`  still local: ${p.id}: ${p.plan.mcp?.reason ?? "local daemon MCP kept (not changed by connected mode)"}\n`);
  };

  let state = await buildPlans(hostedFirst ? "hosted" : "local");
  if (state.conflicts.length) {
    for (const c of state.conflicts) io.err(`conflict [${c.runtime}] ${c.path}: ${c.code}: ${c.detail}\n`);
    io.err(`aborting: ${state.conflicts.length} conflict(s) in ${[...new Set(state.conflicts.map((c) => c.path))].join(", ")}; no files were changed\n`);
    return 1;
  }
  if (hostedFirst) {
    io.out(alreadyConnected
      ? "connected mode: this device is connected, so the plan below ends with the hosted skillar MCP (https://skillar.sh/mcp)\n"
      : opts.dryRun === true && !willConnect
        ? "connected mode (preview): the plan below shows the end state after an approved account connection (hosted skillar MCP, https://skillar.sh/mcp). This non-interactive run would not connect without --connect and would register the local daemon MCP instead. Use --local-only to keep the local daemon.\n"
        : "connected mode: the plan below assumes the account connection is approved and ends with the hosted skillar MCP (https://skillar.sh/mcp). If the connection is declined or fails, the local daemon MCP entries are registered instead. Use --local-only to keep the local daemon.\n");
  } else if (opts.localOnly === true && selected.length > 0) {
    io.out("local-only mode: the local daemon MCP entries are registered; no account connection is attempted\n");
  }
  show(state.plans);
  if (hostedFirst) mcpSummary(state.plans);
  if (opts.dryRun) {
    io.out(`dry run: ${changedFiles(state.files).length} file(s) and ${state.commands.length} command(s) planned; nothing written\n`);
    return 0;
  }

  await hooks.afterPlan?.();
  materialize();

  // Account connection comes before anything is written, so the hosted MCP is written once as the final state and the local entry is never added and then removed.
  let connectFailedExplicit = false;
  let fellBack = false;
  if (connectedWanted) {
    const connectNow = async (): Promise<boolean> => {
      try {
        const connected = await connectCloudDeviceFlow(skillarHome, {
          origin: "https://skillar.sh", uploadIntent: opts.upload, env, io,
          fetcher: hooks.fetcher, wait: hooks.wait,
        });
        io.out(`cloud: connected device ${connected.deviceId}\n`);
        return true;
      } catch (error) {
        io.err(`cloud connect failed: ${error instanceof Error ? error.message : String(error)}\n`);
        return false;
      }
    };
    if (alreadyConnected) {
      if (opts.connect === true) io.out("cloud: already connected; skipping browser approval\n");
    } else if (opts.connect === true) {
      if (!(await connectNow())) { connectFailedExplicit = true; fellBack = true; }
    } else if (io.ask !== undefined) {
      // Interactive TTY offer with default yes. The offer never implies upload consent (browser-side, default off).
      const answer = (await io.ask(
        "skillar.sh 계정에 이 기기를 연결할까요? 업로드 동의는 브라우저에서 직접 선택하며 기본은 로컬 전용입니다. [Y/n] "
      )).trim().toLowerCase();
      if (answer === "" || answer === "y" || answer === "yes") {
        if (!(await connectNow())) {
          // The offer is optional: a failed connect must not fail the install.
          io.out("설치는 완료됩니다. 나중에 `skillar sync connect`로 다시 연결할 수 있습니다.\n");
          fellBack = true;
        }
      } else {
        io.out("나중에 `skillar sync connect`로 연결할 수 있습니다.\n");
        fellBack = true;
      }
    }
  }
  if (fellBack && hostedFirst) {
    io.out("account connection not completed: registering the local daemon MCP entries instead\n");
    state = await buildPlans("local");
    if (state.conflicts.length) {
      for (const c of state.conflicts) io.err(`conflict [${c.runtime}] ${c.path}: ${c.code}: ${c.detail}\n`);
      io.err(`aborting: ${state.conflicts.length} conflict(s); no files were changed\n`);
      return 1;
    }
    show(state.plans);
  }
  const { plans, files, commands } = state;
  const backupDir = newBackupDir(skillarHome);
  if (serviceFile) mkdirSync(join(skillarHome, "logs"), { recursive: true, mode: 0o700 });
  let applied;
  try {
    applied = applyFiles(files, { backupDir, home });
  } catch (error) {
    rmSync(backupDir, { recursive: true, force: true });
    if (error instanceof WriterError) {
      io.err(`${error.message}\naborting: no files were changed (${error.paths.join(", ")})\n`);
      return 1;
    }
    throw error;
  }

  const manifest: BackupManifest = { version: 1, createdAt: new Date().toISOString(), status: "applied", home, runtimes: selected.map((p) => p.id),
    service: serviceFile, files: applied.files, createdDirs: applied.createdDirs, commands: [] };
  for (const c of commands) {
    const exitCode = run(c.argv, { ...env, ...c.env }, io);
    manifest.commands.push({ argv: c.argv, description: c.description, ...(c.undo ? { undo: c.undo } : {}), exitCode, ...(c.allowFailure ? { allowFailure: true } : {}) });
    if (exitCode !== 0 && !c.allowFailure) {
      io.err(mask(`command failed (exit ${exitCode}): ${c.argv.join(" ")}; rolling back this run\n`));
      manifest.status = "failed";
      manifest.rolledBackAt = new Date().toISOString();
      manifest.rollback = undoRun(manifest, backupDir, env, io);
      writeManifest(backupDir, manifest);
      return 1;
    }
  }
  writeManifest(backupDir, manifest);
  if (applied.files.some((f) => f.path === serviceFile)) io.out(`service log: ${daemonLogPath(skillarHome)}\n`);
  io.out(`applied ${applied.files.length} file(s) and ${manifest.commands.length} command(s); backup set ${backupDir}\n`);
  if (hostedFirst && !fellBack) mcpSummary(plans);
  if (hostedFirst && !fellBack) io.out("undo: skillar init --rollback (restores the previous MCP entries)\n");
  if (connectFailedExplicit) return 1;
  // 마지막 줄: 로컬 대시보드 주소(토큰 포함, `skillar open`과 같은 값).
  io.out(`dashboard: ${dashboardUrl(config.port, token)}\n`);
  return 0;
}

function undoRun(manifest: BackupManifest, dir: string, env: NodeJS.ProcessEnv, io: Io): NonNullable<BackupManifest["rollback"]> {
  const commands: RecordedCommand[] = [];
  for (const c of [...manifest.commands].reverse()) {
    if (c.exitCode !== 0 || !c.undo) continue;
    if ((env.SKILLAR_NO_CLI ?? env.GISOOL_NO_CLI)) {
      io.err(`SKILLAR_NO_CLI set: run manually: ${c.undo.argv.join(" ")}\n`);
      commands.push({ argv: c.undo.argv, description: c.undo.description, exitCode: null });
      continue;
    }
    commands.push({ argv: c.undo.argv, description: c.undo.description, exitCode: run(c.undo.argv, env, io) });
  }
  const files = restoreFiles(manifest.files, dir);
  removeEmptyDirs(manifest.createdDirs);
  return { files, commands };
}

export async function runRollback(opts: { all: boolean }, env: NodeJS.ProcessEnv, io: Io): Promise<number> {
  const skillarHome = resolveSkillarHome(env);
  const sets = listBackupSets(skillarHome).filter(
    (s) => s.manifest.status === "applied" && !s.manifest.rolledBackAt && (s.manifest.files.length > 0 || s.manifest.commands.length > 0),
  );
  if (sets.length === 0) {
    io.out("nothing to roll back\n");
    return 0;
  }
  let failed = false;
  for (const s of opts.all ? sets : sets.slice(0, 1)) {
    const result = undoRun(s.manifest, s.dir, env, io);
    for (const c of result.commands) {
      io.out(`undo: ${c.argv.join(" ")} -> ${c.exitCode === null ? "skipped" : `exit ${c.exitCode}`}\n`);
      if (c.exitCode !== 0) failed = true;
    }
    for (const f of result.files) {
      io.out(`${f.action}: ${f.path}\n`);
      if (f.action === "skipped_modified") failed = true;
    }
    s.manifest.rolledBackAt = new Date().toISOString();
    s.manifest.rollback = result;
    writeManifest(s.dir, s.manifest);
    io.out(`rolled back ${s.dir}\n`);
  }
  return failed ? 1 : 0;
}

export async function serviceInstall(opts: { dryRun?: boolean }, env: NodeJS.ProcessEnv, io: Io): Promise<number> {
  return runInit({ dryRun: opts.dryRun ?? false, serviceOnly: true }, env, io);
}

export async function serviceRemove(env: NodeJS.ProcessEnv, io: Io): Promise<number> {
  assertPlatform();
  const home = resolveHome(env);
  const platform = currentServicePlatform();
  const path = servicePath(home, platform);
  if (!existsSync(path)) {
    io.out("service not installed\n");
    return 0;
  }
  const argv = platform === "darwin"
    ? ["launchctl", "bootout", `gui/${process.getuid?.() ?? 0}/${serviceLabel(home, platform)}`]
    : ["systemctl", "--user", "disable", "--now", `${serviceLabel(home, platform)}.service`];
  if ((env.SKILLAR_NO_CLI ?? env.GISOOL_NO_CLI)) io.out(`SKILLAR_NO_CLI set: run manually: ${argv.join(" ")}\n`);
  else run(argv, env, io);
  rmSync(path, { force: true });
  io.out(`removed ${path}\n`);
  return 0;
}
