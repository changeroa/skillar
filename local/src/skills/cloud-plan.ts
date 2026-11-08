import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { CloudRequestError, cloudOriginSchema } from "../sync/cloud-http.js";
import { capturePrivateSkill } from "./capture.js";
import { identitySchema, inside, readJson, SkillApplyError, writeExclusive } from "./fs.js";
import { privateSkillCloud } from "./cloud.js";
import {
  PRIVATE_SKILL_MAX_REQUEST_BYTES, privateSkillDetailSchema, privateSkillHeadSchema,
  privateSkillIdSchema, privateSkillPackageSchema, verifyPrivateSkillPackage,
} from "./package.js";
import type { PrivateSkillHead } from "./package.js";

export const privatePublicationPlanSchema = z.strictObject({
  kind: z.literal("private-skill-publication"), schemaVersion: z.literal(1),
  origin: cloudOriginSchema, instanceId: z.string().uuid(),
  accountId: z.string().min(1), generation: z.number().int().positive().safe(),
  deviceId: z.string().min(1), skillId: privateSkillIdSchema,
  sourceRoot: z.string().max(4096).refine(isAbsolute), rootIdentity: identitySchema,
  base: privateSkillHeadSchema.nullable(), package: privateSkillPackageSchema,
}).readonly();
export type PrivatePublicationPlan = z.infer<typeof privatePublicationPlanSchema>;
function artifactPath(path: string): string {
  const absolute = resolve(path);
  return join(realpathSync(dirname(absolute)), basename(absolute));
}

export async function readPublicationPlan(path: string): Promise<PrivatePublicationPlan> {
  const plan = privatePublicationPlanSchema.parse(readJson(artifactPath(path), PRIVATE_SKILL_MAX_REQUEST_BYTES + 8192));
  await verifyPrivateSkillPackage(plan.package);
  return plan;
}

/** Reads current metadata only. No document bytes leave the machine during preview. */
export async function previewPrivatePublication(
  home: string, input: { readonly sourceRoot: string; readonly skillId: string; readonly planPath: string },
  fetcher: typeof fetch = fetch,
): Promise<PrivatePublicationPlan> {
  const skillId = privateSkillIdSchema.parse(input.skillId);
  const captured = await capturePrivateSkill(input.sourceRoot);
  const target = artifactPath(input.planPath);
  if (inside(captured.sourceRoot, target)) {
    throw new SkillApplyError("artifact_inside_source", "save the publication plan outside its source directory");
  }
  const client = await privateSkillCloud(home, true, fetcher);
  let base: PrivateSkillHead | null = null;
  try {
    const detail = privateSkillDetailSchema.parse(await client.request(`/${skillId}`));
    if (detail.skill.skillId !== skillId) throw new SkillApplyError("identity_mismatch", "unexpected skill metadata");
    base = detail.skill.head;
  } catch (error) {
    if (!(error instanceof CloudRequestError && error.status === 404 && error.message === "not_found")) throw error;
  }
  const plan = privatePublicationPlanSchema.parse({
    kind: "private-skill-publication", schemaVersion: 1, ...client.identity,
    skillId, sourceRoot: captured.sourceRoot, rootIdentity: captured.rootIdentity, base, package: captured.package,
  });
  if (Buffer.byteLength(JSON.stringify({
    base: plan.base, acknowledgePrivateUpload: true, package: plan.package,
  })) > PRIVATE_SKILL_MAX_REQUEST_BYTES) {
    throw new SkillApplyError("quota", "the encoded publication exceeds the request limit");
  }
  writeExclusive(target, JSON.stringify(plan));
  return plan;
}
