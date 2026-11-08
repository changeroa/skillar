import { capturePrivateSkill } from "./capture.js";
import { privateSkillCloud } from "./cloud.js";
import { readPublicationPlan } from "./cloud-plan.js";
import { sameIdentity, SkillApplyError, writeExclusive } from "./fs.js";
import {
  privateSkillDetailSchema, privateSkillDigestSchema, privateSkillExportSchema,
  privateSkillIdSchema, verifyPrivateSkillPackage,
} from "./package.js";
import type { PrivateSkillDigest } from "./package.js";

/** Only explicit confirmation can upload the exact reviewed, unchanged package. */
export async function pushPrivateSkill(
  home: string, planPath: string, acknowledgePrivateUpload: boolean, fetcher: typeof fetch = fetch,
) {
  if (!acknowledgePrivateUpload) throw new SkillApplyError("private_upload_ack_required", "review and confirm the publication plan");
  const plan = await readPublicationPlan(planPath);
  const captured = await capturePrivateSkill(plan.sourceRoot);
  if (!sameIdentity(captured.rootIdentity, plan.rootIdentity) ||
      captured.package.manifestDigest !== plan.package.manifestDigest) {
    throw new SkillApplyError("source_changed", plan.sourceRoot);
  }
  const client = await privateSkillCloud(home, true, fetcher);
  if (client.identity.accountId !== plan.accountId || client.identity.generation !== plan.generation ||
      client.identity.origin !== plan.origin || client.identity.instanceId !== plan.instanceId ||
      client.identity.deviceId !== plan.deviceId) {
    throw new SkillApplyError("connection_changed", "create a new publication preview");
  }
  const detail = privateSkillDetailSchema.parse(await client.request(`/${plan.skillId}/versions`, {
    base: plan.base, acknowledgePrivateUpload: true, package: plan.package,
  }));
  if (detail.skill.skillId !== plan.skillId || detail.skill.head.digest !== plan.package.manifestDigest ||
      detail.skill.head.revision !== (plan.base?.revision ?? 0) + 1) {
    throw new SkillApplyError("publication_unverified", "the server did not acknowledge the reviewed head");
  }
  return { status: "published", skillId: plan.skillId, head: detail.skill.head } as const;
}

/** A verified immutable export is saved privately for a separate local apply preview. */
export async function pullPrivateSkill(
  home: string, input: { readonly skillId: string; readonly digest?: string; readonly outputPath: string },
  fetcher: typeof fetch = fetch,
) {
  const skillId = privateSkillIdSchema.parse(input.skillId);
  const client = await privateSkillCloud(home, false, fetcher);
  let digest: PrivateSkillDigest;
  if (input.digest === undefined) {
    const detail = privateSkillDetailSchema.parse(await client.request(`/${skillId}`));
    if (detail.skill.skillId !== skillId) throw new SkillApplyError("identity_mismatch", "unexpected skill metadata");
    digest = detail.skill.head.digest;
  } else digest = privateSkillDigestSchema.parse(input.digest);
  const exported = privateSkillExportSchema.parse(await client.request(`/${skillId}/versions/${digest}`));
  await verifyPrivateSkillPackage(exported.package);
  if (exported.skillId !== skillId || exported.version.digest !== digest || exported.package.manifestDigest !== digest) {
    throw new SkillApplyError("export_unverified", "the returned version did not match the requested pin");
  }
  writeExclusive(input.outputPath, JSON.stringify(exported));
  return { status: "downloaded", skillId, digest, file: input.outputPath } as const;
}
