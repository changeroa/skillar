// SPDX-License-Identifier: AGPL-3.0-only
import { privateSkillDeleteSchema, privateSkillManifestSchema } from "../../../shared/private-skills.ts";
import type { PrivateSkillId } from "../../../shared/private-skills.ts";
import { PrivateSkillError } from "./contracts.ts";
import { commitMutation, checkBase } from "./mutations.ts";
import { purgeManifest } from "./objects.ts";
import type { PrivateSkillStore } from "./store.ts";

export async function deleteSkill(store: PrivateSkillStore, skillId: PrivateSkillId, input: unknown) {
  const { base } = privateSkillDeleteSchema.parse(input);
  const row = await store.skill(skillId);
  if (row === null) throw new PrivateSkillError(404, "not_found");
  if (!row.tombstoned) {
    await checkBase(store, skillId, base);
    const fence = store.fence();
    await commitMutation(store, [
      store.env.ACCOUNTS.prepare(`UPDATE private_skills SET tombstoned=1,revision=revision+1,
        updated_at=?,mutation_id=? WHERE account_id=? AND generation=? AND skill_id=?
        AND digest=? AND revision=? AND tombstoned=0 AND EXISTS(${fence.sql}) RETURNING revision`)
        .bind(Date.now(), crypto.randomUUID(), ...store.identity(skillId), base.digest, base.revision, ...fence.args),
    ]);
  } else if (row.digest !== base.digest || row.revision !== base.revision + 1) {
    throw new PrivateSkillError(409, "head_conflict");
  }
  // A failed purge leaves a durable tombstone, retained manifests and a retryable base.
  for (const version of await store.manifests(skillId)) await purgeManifest(store, skillId, version);
  const fence = store.fence(), completed = crypto.randomUUID();
  await commitMutation(store, [
    store.env.ACCOUNTS.prepare(`UPDATE private_skills SET purge_complete=1,mutation_id=?
      WHERE account_id=? AND generation=? AND skill_id=? AND tombstoned=1
      AND digest=? AND revision=? AND EXISTS(${fence.sql}) RETURNING revision`)
      .bind(completed, ...store.identity(skillId), base.digest, base.revision + 1, ...fence.args),
    store.env.ACCOUNTS.prepare(`DELETE FROM private_skill_versions WHERE account_id=? AND generation=?
      AND skill_id=? AND EXISTS(${fence.sql}) AND EXISTS(SELECT 1 FROM private_skills
        WHERE account_id=? AND generation=? AND skill_id=? AND mutation_id=? AND purge_complete=1)`)
      .bind(...store.identity(skillId), ...fence.args, ...store.identity(skillId), completed),
  ]);
}
export async function deleteVersion(
  store: PrivateSkillStore, target: { readonly skillId: PrivateSkillId; readonly digest: string }, input: unknown,
) {
  const { skillId, digest } = target;
  const { base } = privateSkillDeleteSchema.parse(input);
  const skill = await store.skill(skillId);
  if (skill === null || skill.tombstoned) throw new PrivateSkillError(404, "not_found");
  const version = (await store.versions(skillId)).find(row => row.digest === digest);
  if (version === undefined) throw new PrivateSkillError(404, "not_found");
  if (version.digest === skill.digest || version.pinned) throw new PrivateSkillError(409, "version_protected");
  if (version.deleting_revision === null) {
    await checkBase(store, skillId, base);
    const fence = store.fence(), mutation = crypto.randomUUID();
    await commitMutation(store, [
      store.env.ACCOUNTS.prepare(`UPDATE private_skills SET revision=revision+1,updated_at=?,mutation_id=?
        WHERE account_id=? AND generation=? AND skill_id=? AND digest=? AND revision=? AND tombstoned=0
        AND EXISTS(${fence.sql}) AND EXISTS(SELECT 1 FROM private_skill_versions
          WHERE account_id=? AND generation=? AND skill_id=? AND digest=? AND pinned=0
          AND deleting_revision IS NULL AND digest!=private_skills.digest) RETURNING revision`)
        .bind(Date.now(), mutation, ...store.identity(skillId), base.digest, base.revision,
          ...fence.args, ...store.identity(skillId), digest),
      store.env.ACCOUNTS.prepare(`UPDATE private_skill_versions SET deleting_revision=?
        WHERE account_id=? AND generation=? AND skill_id=? AND digest=? AND EXISTS(SELECT 1
          FROM private_skills WHERE account_id=? AND generation=? AND skill_id=? AND mutation_id=?)`)
        .bind(base.revision, ...store.identity(skillId), digest, ...store.identity(skillId), mutation),
    ]);
  } else if (version.deleting_revision !== base.revision ||
      skill.revision !== base.revision + 1 || skill.digest !== base.digest) {
    throw new PrivateSkillError(409, "head_conflict");
  }
  await purgeManifest(store, skillId, {
    digest, manifest: privateSkillManifestSchema.parse(JSON.parse(version.manifest_json)),
  });
  const fence = store.fence();
  const removed = await store.env.ACCOUNTS.prepare(`DELETE FROM private_skill_versions
    WHERE account_id=? AND generation=? AND skill_id=? AND digest=? AND deleting_revision=?
      AND EXISTS(${fence.sql}) RETURNING digest`)
    .bind(...store.identity(skillId), digest, base.revision, ...fence.args).all();
  if (removed.results.length !== 1) {
    await store.live();
    throw new PrivateSkillError(409, "head_conflict");
  }
  return store.detail(skillId);
}
