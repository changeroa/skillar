import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveSkillarHome } from "../config.js";
import type { Io } from "./serve.js";
import { applySkill } from "../skills/apply.js";
import { previewSkill } from "../skills/plan.js";
import { rollbackSkill } from "../skills/rollback.js";
import { previewPrivatePublication } from "../skills/cloud-plan.js";
import { pullPrivateSkill, pushPrivateSkill } from "../skills/transfer.js";

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
      case "push-preview": {
        const values = options(rest, ["--source-dir", "--plan"], [], ["--skill-id"]);
        const plan = await previewPrivatePublication(resolveSkillarHome(env), {
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
        const result = await pushPrivateSkill(resolveSkillarHome(env), required(values, "--plan"),
          values.has("--allow-private-upload"));
        io.out(JSON.stringify(result) + "\n");
        return 0;
      }
      case "pull": {
        const values = options(rest, ["--skill-id", "--output"], [], ["--version"]);
        const version = values.get("--version");
        io.out(JSON.stringify(await pullPrivateSkill(resolveSkillarHome(env), {
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
