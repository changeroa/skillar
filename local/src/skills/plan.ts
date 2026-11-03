import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  PRIVATE_SKILL_MAX_BYTES, PRIVATE_SKILL_MAX_REQUEST_BYTES, PRIVATE_SKILL_MAX_RESOURCE_BYTES,
  privateSkillExportSchema, privateSkillPathSchema, verifyPrivateSkillPackage,
} from "./package.js";
import {
  ancestors, checkDirectories, directoryIdentity, identitySchema, inside, readJson, readRegular,
  sameState, SkillApplyError, stateSchema, writeExclusive,
} from "./fs.js";
import type { Directory } from "./fs.js";

export const MAX_PLAN_BYTES = 4 * 1024 * 1024;
export const directorySchema = z.strictObject({
  path: z.string().max(4096), identity: identitySchema.nullable(),
}).readonly();
export const planSchema = z.strictObject({
  schemaVersion: z.literal(1), root: z.string().min(1).max(4096),
  allowOverwrite: z.boolean(), exported: privateSkillExportSchema,
  directories: z.array(directorySchema).min(1).max(1024).readonly(),
  files: z.array(z.strictObject({
    path: privateSkillPathSchema, before: stateSchema.nullable(),
  }).readonly()).min(1).max(128).readonly(),
}).readonly();
export type SkillPlan = z.infer<typeof planSchema>;

function plannedDirectories(root: string, paths: readonly string[]): readonly string[] {
  return [...new Set([...ancestors(root), ...paths.flatMap(path => ancestors(dirname(join(root, path))))])]
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
}
export async function verifyPlan(input: unknown): Promise<SkillPlan> {
  const plan = planSchema.parse(input);
  const verified = await verifyPrivateSkillPackage(plan.exported.package);
  if (plan.exported.version.digest !== verified.package.manifestDigest) {
    throw new SkillApplyError("version_digest", "export version differs from package");
  }
  const resources = verified.package.manifest.resources;
  const directories = plannedDirectories(plan.root, resources.map(resource => resource.path));
  if (!isAbsolute(plan.root) || resolve(plan.root) !== plan.root ||
      plan.files.length !== resources.length || directories.length !== plan.directories.length ||
      directories.some((path, index) => path !== plan.directories[index]?.path) ||
      plan.files.some((file, index) => file.path !== resources[index]?.path ||
        (file.before !== null && (!plan.allowOverwrite || file.before.size > PRIVATE_SKILL_MAX_RESOURCE_BYTES))) ||
      plan.files.reduce((sum, file) => sum + (file.before?.size ?? 0), 0) > PRIVATE_SKILL_MAX_BYTES ||
      plan.directories.some(dir => inside(dir.path, plan.root) && dir.identity === null)) {
    throw new SkillApplyError("invalid_plan", "membership, root, ancestors, overwrite permission or quota");
  }
  return plan;
}
export async function loadPlan(path: string): Promise<SkillPlan> {
  return verifyPlan(readJson(path, MAX_PLAN_BYTES));
}
export function checkBefore(plan: SkillPlan, directories: readonly Directory[] = plan.directories): void {
  checkDirectories(directories);
  for (const file of plan.files) {
    const current = readRegular(join(plan.root, file.path), PRIVATE_SKILL_MAX_RESOURCE_BYTES);
    if (!sameState(file.before, current?.state ?? null)) throw new SkillApplyError("target_changed", file.path);
  }
  checkDirectories(directories);
}
export async function previewSkill(opts: {
  readonly packagePath: string; readonly destinationRoot: string;
  readonly planPath: string; readonly allowOverwrite?: boolean;
}): Promise<SkillPlan> {
  const exported = privateSkillExportSchema.parse(readJson(opts.packagePath, PRIVATE_SKILL_MAX_REQUEST_BYTES));
  await verifyPrivateSkillPackage(exported.package);
  if (exported.version.digest !== exported.package.manifestDigest) throw new SkillApplyError("version_digest", opts.packagePath);
  const root = resolve(opts.destinationRoot);
  const planPath = resolve(opts.planPath);
  if (inside(root, planPath)) throw new SkillApplyError("plan_in_destination", planPath);
  const directories = plannedDirectories(root, exported.package.manifest.resources.map(resource => resource.path))
    .map(path => ({ path, identity: directoryIdentity(path) }));
  if (directories.some(dir => inside(dir.path, root) && dir.identity === null)) {
    throw new SkillApplyError("missing_root", root);
  }
  const files = exported.package.manifest.resources.map(resource => ({
    path: resource.path, before: readRegular(join(root, resource.path), PRIVATE_SKILL_MAX_RESOURCE_BYTES)?.state ?? null,
  }));
  if (!opts.allowOverwrite && files.some(file => file.before !== null)) {
    throw new SkillApplyError("overwrite_requires_permission", "preview again with --allow-overwrite");
  }
  const plan = await verifyPlan({ schemaVersion: 1, root, allowOverwrite: opts.allowOverwrite ?? false, exported, directories, files });
  checkBefore(plan);
  const text = JSON.stringify(plan);
  if (Buffer.byteLength(text) > MAX_PLAN_BYTES) throw new SkillApplyError("quota", "plan");
  const parents = ancestors(dirname(planPath)).map(path => ({ path, identity: directoryIdentity(path) }));
  if (parents.some(dir => dir.identity === null)) throw new SkillApplyError("missing_directory", dirname(planPath));
  checkDirectories(parents);
  writeExclusive(planPath, text);
  return plan;
}
