// SPDX-License-Identifier: AGPL-3.0-only
import {
  privateSkillHeadChangeSchema, privateSkillPinSchema, privateSkillPublishSchema,
  privateSkillUri, privateSkillPathSchema,
} from "../../../shared/private-skills.ts";
import type { PrivateSkillHead, PrivateSkillId } from "../../../shared/private-skills.ts";
import { verifyPrivateSkillPackage } from "../../../shared/private-skill-package.ts";
import { splitSkillMarkdown, extractFields } from "../../../shared/skill-fields.ts";
import type { SearchEntry } from "../../../shared/private-search.ts";
import { PrivateSkillError, searchEntrySchema } from "./contracts.ts";
import { putPackage, exportVersion } from "./objects.ts";
import type { PrivateSkillStore } from "./store.ts";

export async function checkBase(store: PrivateSkillStore, skillId: PrivateSkillId, base: PrivateSkillHead | null) {
  const row = await store.skill(skillId);
  if (row?.tombstoned) throw new PrivateSkillError(409, "skill_tombstoned");
  if (base === null ? row !== null : row === null || row.digest !== base.digest || row.revision !== base.revision) {
    throw new PrivateSkillError(409, "head_conflict");
  }
  if ((await store.versions(skillId)).some(version => version.deleting_revision !== null)) {
    throw new PrivateSkillError(409, "purge_pending");
  }
}

/** RETURNING rows, not trigger-inflated meta.changes, decide whether this writer won. */
export async function commitMutation(store: PrivateSkillStore, statements: readonly D1PreparedStatement[]) {
  const result = await store.env.ACCOUNTS.batch([...statements]);
  if (result[0]?.results.length !== 1) {
    await store.live();
    throw new PrivateSkillError(409, "head_conflict");
  }
}
export async function publish(store: PrivateSkillStore, skillId: PrivateSkillId, input: unknown) {
  const value = privateSkillPublishSchema.parse(input);
  const packet = await verifyPrivateSkillPackage(value.package);
  const entrypoint = packet.files.get(privateSkillPathSchema.parse("SKILL.md"));
  const entryResource = packet.package.manifest.resources.find(resource => resource.path === "SKILL.md");
  if (entrypoint === undefined || entryResource === undefined) throw new PrivateSkillError(400, "invalid_skill");
  const markdown = splitSkillMarkdown(new TextDecoder("utf-8", { fatal: true }).decode(entrypoint), { rejectAliases: true });
  const fields = markdown.frontmatter === null ? null : extractFields(markdown.frontmatter, markdown.body);
  if (fields === null) throw new PrivateSkillError(400, "invalid_skill");
  const entry: SearchEntry = searchEntrySchema.parse({
    uri: privateSkillUri(skillId, value.package.manifestDigest, privateSkillPathSchema.parse("SKILL.md")),
    name: fields.name, description: fields.description, examples: fields.examples,
    aliasesKo: fields.aliasesKo, invocation: fields.invocation, bodyHead: fields.bodyHead,
    ...(fields.whenToUse === undefined ? {} : { whenToUse: fields.whenToUse }),
    digest: entryResource.digest,
  });
  await checkBase(store, skillId, value.base);
  await putPackage(store, skillId, packet);
  const fence = store.fence(), mutation = crypto.randomUUID(), now = Date.now();
  const head = value.base === null ?
    store.env.ACCOUNTS.prepare(`INSERT INTO private_skills
      (account_id,generation,skill_id,digest,revision,name,description,updated_at,mutation_id)
      SELECT ?,?,?,?,1,?,?,?,? WHERE EXISTS(${fence.sql})
      ON CONFLICT(account_id,generation,skill_id) DO NOTHING RETURNING revision`)
      .bind(...store.identity(skillId), value.package.manifestDigest, entry.name, entry.description, now, mutation, ...fence.args) :
    store.env.ACCOUNTS.prepare(`UPDATE private_skills SET digest=?,revision=revision+1,
      name=?,description=?,updated_at=?,mutation_id=? WHERE account_id=? AND generation=? AND skill_id=?
      AND digest=? AND revision=? AND tombstoned=0 AND EXISTS(${fence.sql})
      AND NOT EXISTS(SELECT 1 FROM private_skill_versions WHERE account_id=? AND generation=?
        AND skill_id=? AND deleting_revision IS NOT NULL) RETURNING revision`)
      .bind(value.package.manifestDigest, entry.name, entry.description, now, mutation, ...store.identity(skillId),
        value.base.digest, value.base.revision, ...fence.args, ...store.identity(skillId));
  await commitMutation(store, [
    head,
    store.env.ACCOUNTS.prepare(`INSERT INTO private_skill_versions
      (account_id,generation,skill_id,digest,manifest_json,entry_json,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM private_skills
        WHERE account_id=? AND generation=? AND skill_id=? AND mutation_id=?)
      ON CONFLICT(account_id,generation,skill_id,digest) DO NOTHING`)
      .bind(...store.identity(skillId), value.package.manifestDigest, JSON.stringify(value.package.manifest),
        JSON.stringify(entry), now, ...store.identity(skillId), mutation),
  ]);
  return store.detail(skillId);
}
export async function changeHead(store: PrivateSkillStore, skillId: PrivateSkillId, input: unknown) {
  const value = privateSkillHeadChangeSchema.parse(input);
  await checkBase(store, skillId, value.base);
  // A missing/tampered retained version can never become the advertised head.
  await exportVersion(store, skillId, value.targetDigest);
  const target = await store.version(skillId, value.targetDigest);
  const entry = searchEntrySchema.parse(JSON.parse(target.entry_json));
  const fence = store.fence();
  await commitMutation(store, [
    store.env.ACCOUNTS.prepare(`UPDATE private_skills SET digest=?,revision=revision+1,
      name=?,description=?,updated_at=?,mutation_id=?
      WHERE account_id=? AND generation=? AND skill_id=? AND digest=? AND revision=? AND tombstoned=0
      AND EXISTS(${fence.sql}) AND EXISTS(SELECT 1 FROM private_skill_versions
        WHERE account_id=? AND generation=? AND skill_id=? AND digest=? AND deleting_revision IS NULL)
      RETURNING revision`)
      .bind(value.targetDigest, entry.name, entry.description, Date.now(), crypto.randomUUID(),
        ...store.identity(skillId), value.base.digest, value.base.revision, ...fence.args,
        ...store.identity(skillId), value.targetDigest),
  ]);
  return store.detail(skillId);
}
export async function pinVersion(store: PrivateSkillStore, skillId: PrivateSkillId, input: unknown) {
  const value = privateSkillPinSchema.parse(input);
  await checkBase(store, skillId, value.base);
  await store.version(skillId, value.targetDigest);
  const fence = store.fence(), mutation = crypto.randomUUID();
  await commitMutation(store, [
    store.env.ACCOUNTS.prepare(`UPDATE private_skills SET revision=revision+1,updated_at=?,mutation_id=?
      WHERE account_id=? AND generation=? AND skill_id=? AND digest=? AND revision=? AND tombstoned=0
      AND EXISTS(${fence.sql}) AND EXISTS(SELECT 1 FROM private_skill_versions
        WHERE account_id=? AND generation=? AND skill_id=? AND digest=? AND deleting_revision IS NULL)
      RETURNING revision`)
      .bind(Date.now(), mutation, ...store.identity(skillId), value.base.digest, value.base.revision,
        ...fence.args, ...store.identity(skillId), value.targetDigest),
    store.env.ACCOUNTS.prepare(`UPDATE private_skill_versions SET pinned=?
      WHERE account_id=? AND generation=? AND skill_id=? AND digest=? AND EXISTS(SELECT 1
        FROM private_skills WHERE account_id=? AND generation=? AND skill_id=? AND mutation_id=?)`)
      .bind(value.pinned ? 1 : 0, ...store.identity(skillId), value.targetDigest, ...store.identity(skillId), mutation),
  ]);
  return store.detail(skillId);
}
