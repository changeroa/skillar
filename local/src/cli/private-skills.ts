import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveSkillarHome } from "../config.js";
import type { Io } from "./serve.js";
import { applySkill } from "../skills/apply.js";
import { previewSkill } from "../skills/plan.js";
import { rollbackSkill } from "../skills/rollback.js";
import { previewPrivatePublication } from "../skills/cloud-plan.js";
import { pullPrivateSkill, pushPrivateSkill } from "../skills/transfer.js";
import { ensurePrivateSkillAccess } from "../skills/cloud.js";

class SkillsUsageError extends Error {
  readonly code = "usage";
}

function options(
  args: readonly string[], names: readonly string[], flags: readonly string[] = [], optional: readonly string[] = [],
): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined || values.has(arg)) throw new SkillsUsageError("duplicate option");
    if (flags.includes(arg)) { values.set(arg, "true"); continue; }
    if (!names.includes(arg) && !optional.includes(arg)) throw new SkillsUsageError(`unexpected argument ${arg}`);
    const value = args[++index];
    if (value === undefined || value === "" || value.startsWith("--")) throw new SkillsUsageError(`${arg} needs a value`);
    values.set(arg, value);
  }
  for (const name of names) if (!values.has(name)) throw new SkillsUsageError(`missing ${name}`);
  return values;
}
function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined) throw new SkillsUsageError(`missing ${name}`);
  return value;
}

/** Local apply and explicit private transfer are separate commands and acknowledgements. */
export async function runPrivateSkills(
  args: readonly string[], io: Io, env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const [command, ...rest] = args;
  try {
    switch (command) {
      case "sync-plan": {
        // Read-only dry run: no network, no consent change, no writes.
        const json = rest.includes("--json");
        const include: string[] = [];
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === "--json") continue;
          if (rest[i] === "--include" && rest[i + 1] && !rest[i + 1]!.startsWith("--")) { include.push(rest[++i]!); continue; }
          throw new SkillsUsageError("sync-plan only accepts --json and --include <rootId>/<dir>");
        }
        const { defaultConfigFile, expandHome, resolveHome, resolveSkillarHome: skHome } = await import("../config.js");
        const { existsSync, readFileSync } = await import("node:fs");
        const { readConnection } = await import("../sync/cloud-connection.js");
        const { planSkillSync, renderSyncPlan } = await import("../skills/sync-plan.js");
        const conn = readConnection(skHome(env));
        // Read config without loadConfig(): that creates SKILLAR_HOME, config.json and a token, and a dry run writes nothing.
        const home = resolveHome(env);
        const configPath = join(skHome(env), "config.json");
        let rawRoots: { id: string; path: string }[] | undefined;
        if (existsSync(configPath)) rawRoots = (JSON.parse(readFileSync(configPath, "utf8")) as { roots?: { id: string; path: string }[] }).roots;
        const roots = (rawRoots ?? defaultConfigFile().roots).map((r) => ({ id: r.id, path: expandHome(r.path, home) }));
        const plan = await planSkillSync(roots, { deviceId: conn?.deviceId ?? null, include });
        io.out(json ? JSON.stringify(plan) + "\n" : renderSyncPlan(plan));
        return 0;
      }
      case "push-preview": {
        const values = options(rest, ["--source-dir", "--plan"], [], ["--skill-id"]);
        const home = resolveSkillarHome(env);
        // Preview reads the current head, so the same one browser approval that
        // later publishes covers it — ask once, before any cloud call.
        await ensurePrivateSkillAccess(home, { write: true, io, env });
        const plan = await previewPrivatePublication(home, {
          sourceRoot: required(values, "--source-dir"), planPath: required(values, "--plan"),
          skillId: values.get("--skill-id") ?? randomUUID(),
        });
        io.out(JSON.stringify({
          status: "publication-preview", skillId: plan.skillId, base: plan.base, plan: required(values, "--plan"),
          manifestDigest: plan.package.manifestDigest, resources: plan.package.manifest.resources,
        }) + "\n");
        return 0;
      }
      case "push": {
        const values = options(rest, ["--plan"], ["--allow-private-upload"]);
        const home = resolveSkillarHome(env);
        // Missing connection or skills scopes: one browser approval, then the
        // publish continues — no grant file, no path pasting.
        await ensurePrivateSkillAccess(home, { write: true, io, env });
        const result = await pushPrivateSkill(home, required(values, "--plan"),
          values.has("--allow-private-upload"));
        io.out(JSON.stringify(result) + "\n");
        return 0;
      }
      case "pull": {
        const values = options(rest, ["--skill-id", "--output"], [], ["--version"]);
        const version = values.get("--version");
        const home = resolveSkillarHome(env);
        await ensurePrivateSkillAccess(home, { write: false, io, env });
        io.out(JSON.stringify(await pullPrivateSkill(home, {
          skillId: required(values, "--skill-id"), outputPath: required(values, "--output"),
          ...(version === undefined ? {} : { digest: version }),
        })) + "\n");
        return 0;
      }
      case "preview": {
        const values = options(rest, ["--package", "--destination-root", "--plan"], ["--allow-overwrite"]);
        const plan = await previewSkill({
          packagePath: required(values, "--package"), destinationRoot: required(values, "--destination-root"),
          planPath: required(values, "--plan"), allowOverwrite: values.has("--allow-overwrite"),
        });
        io.out(JSON.stringify({
          status: "preview", root: plan.root, plan: required(values, "--plan"),
          digest: plan.exported.package.manifestDigest,
          files: plan.files.map((file, index) => ({
            path: join(plan.root, file.path), action: file.before === null ? "create" : "overwrite",
            beforeDigest: file.before?.digest ?? null,
            afterDigest: plan.exported.package.manifest.resources[index]?.digest,
          })),
        }) + "\n");
        return 0;
      }
      case "apply": {
        const values = options(rest, ["--plan"]);
        const report = await applySkill(required(values, "--plan"));
        io.out(JSON.stringify(report) + "\n");
        return report.status === "applied" ? 0 : 1;
      }
      case "rollback": {
        const values = options(rest, ["--receipt"]);
        const report = await rollbackSkill(required(values, "--receipt"));
        io.out(JSON.stringify(report) + "\n");
        return report.status === "rolled_back" ? 0 : 1;
      }
      default: throw new SkillsUsageError("skills needs push-preview, push, pull, preview, apply, or rollback");
    }
  } catch (error) {
    if (error instanceof SkillsUsageError) {
      io.err(`usage: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}
