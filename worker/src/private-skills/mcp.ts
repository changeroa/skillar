import { z } from "zod";
import {
  privateSkillIdSchema, privateSkillManifestSchema, privateSkillUri,
} from "../../../shared/private-skills.ts";
import { mcpCatalogSchema } from "../private-mcp/catalog-contracts.ts";
import { searchEntrySchema, versionRowSchema } from "./contracts.ts";
import type { PrivateSkillStore } from "./store.ts";

/** One primary D1 snapshot; metadata listing never opens resource bodies in R2. */
export async function mcpCatalog(store: PrivateSkillStore) {
  await store.live();
  const { accountId, generation } = store.principal;
  const result = await store.env.ACCOUNTS.batch([
    store.env.ACCOUNTS.prepare(`SELECT revision FROM private_skill_catalogs WHERE account_id=? AND generation=?`)
      .bind(accountId, generation),
    store.env.ACCOUNTS.prepare(`SELECT s.skill_id,s.digest AS head_digest,s.revision,s.updated_at,
      s.name AS head_name,s.description AS head_description,v.*
      FROM private_skills s JOIN private_skill_versions v USING(account_id,generation,skill_id)
      WHERE s.account_id=? AND s.generation=? AND s.tombstoned=0
      AND v.deleting_revision IS NULL AND (v.digest=s.digest OR v.pinned=1)
      ORDER BY s.skill_id,v.digest`).bind(accountId, generation),
  ]);
  const rows = z.array(versionRowSchema.unwrap().extend({
    skill_id: privateSkillIdSchema, head_digest: z.string(), revision: z.number(),
    updated_at: z.number(), head_name: z.string(), head_description: z.string(),
  })).parse(result[1]?.results);
  const skills = new Map<string, {
    skillId: z.infer<typeof privateSkillIdSchema>; name: string; description: string;
    head: { digest: string; revision: number }; updatedAt: number;
    versions: z.infer<typeof mcpCatalogSchema>["skills"][number]["versions"][number][];
  }>();
  for (const row of rows) {
    let skill = skills.get(row.skill_id);
    if (skill === undefined) {
      skill = { skillId: row.skill_id, name: row.head_name, description: row.head_description,
        head: { digest: row.head_digest, revision: row.revision }, updatedAt: row.updated_at, versions: [] };
      skills.set(row.skill_id, skill);
    }
    const manifest = privateSkillManifestSchema.parse(JSON.parse(row.manifest_json));
    skill.versions.push({
      digest: row.digest, createdAt: row.created_at, pinned: row.pinned === 1,
      current: row.digest === row.head_digest, entry: searchEntrySchema.parse(JSON.parse(row.entry_json)),
      manifest, resources: manifest.resources.map(resource => ({
        ...resource, uri: privateSkillUri(row.skill_id, row.digest, resource.path),
      })),
    });
  }
  return mcpCatalogSchema.parse({
    revision: z.object({ revision: z.number() }).optional().parse(result[0]?.results[0])?.revision ?? 0,
    skills: [...skills.values()],
  });
}
