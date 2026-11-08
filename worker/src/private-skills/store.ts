// SPDX-License-Identifier: AGPL-3.0-only
import {
  privateSkillCatalogSchema, privateSkillDetailSchema, privateSkillManifestSchema,
} from "../../../shared/private-skills.ts";
import type { PrivateSkillPrincipal, PrivateSkillId } from "../../../shared/private-skills.ts";
import { authority, requireAuthority } from "./authority.ts";
import type { PrivateScope } from "./authority.ts";
import { PrivateSkillError, skillRowSchema, versionRowSchema, searchEntrySchema } from "./contracts.ts";
import type { PrivateSkillsEnv, SkillRow, VersionRow } from "./contracts.ts";
import type { SearchEntry } from "../../../shared/private-search.ts";
import { z } from "zod";

/** All directory authority lives in primary D1, never in the object's search projection. */
export class PrivateSkillStore {
  constructor(
    readonly env: PrivateSkillsEnv, readonly principal: PrivateSkillPrincipal,
    readonly scope: PrivateScope,
  ) {}
  identity(skillId: PrivateSkillId) {
    return [this.principal.accountId, this.principal.generation, skillId] as const;
  }
  live() { return requireAuthority(this.env, this.principal, this.scope); }
  fence() { return authority(this.principal, this.scope); }
  async skill(skillId: PrivateSkillId): Promise<SkillRow | null> {
    await this.live();
    const row = await this.env.ACCOUNTS.prepare(`SELECT * FROM private_skills
      WHERE account_id=? AND generation=? AND skill_id=?`).bind(...this.identity(skillId)).first();
    return row === null ? null : skillRowSchema.parse(row);
  }
  async versions(skillId: PrivateSkillId): Promise<readonly VersionRow[]> {
    await this.live();
    const rows = await this.env.ACCOUNTS.prepare(`SELECT * FROM private_skill_versions
      WHERE account_id=? AND generation=? AND skill_id=? ORDER BY created_at DESC,digest`)
      .bind(...this.identity(skillId)).all();
    return z.array(versionRowSchema).parse(rows.results);
  }
  async version(skillId: PrivateSkillId, digest: string): Promise<VersionRow> {
    const skill = await this.skill(skillId);
    if (skill === null || skill.tombstoned) throw new PrivateSkillError(404, "not_found");
    const value = (await this.versions(skillId)).find(row => row.digest === digest && row.deleting_revision === null);
    if (value === undefined) throw new PrivateSkillError(404, "not_found");
    return value;
  }
  summary(row: SkillRow) {
    return {
      skillId: row.skill_id, name: row.name, description: row.description,
      head: { digest: row.digest, revision: row.revision }, updatedAt: row.updated_at,
    };
  }
  async detail(skillId: PrivateSkillId) {
    const row = await this.skill(skillId);
    if (row === null || row.tombstoned) throw new PrivateSkillError(404, "not_found");
    const versions = (await this.versions(skillId)).filter(version => version.deleting_revision === null)
      .map(version => ({ digest: version.digest, createdAt: version.created_at, pinned: version.pinned === 1 }));
    return privateSkillDetailSchema.parse({ skill: this.summary(row), versions });
  }
  async catalog() {
    await this.live();
    const result = await this.env.ACCOUNTS.batch([
      this.env.ACCOUNTS.prepare(`SELECT revision FROM private_skill_catalogs WHERE account_id=? AND generation=?`)
        .bind(this.principal.accountId, this.principal.generation),
      this.env.ACCOUNTS.prepare(`SELECT * FROM private_skills WHERE account_id=? AND generation=?
        AND tombstoned=0 ORDER BY skill_id`).bind(this.principal.accountId, this.principal.generation),
    ]);
    return privateSkillCatalogSchema.parse({
      revision: z.object({ revision: z.number().int().nonnegative() }).optional().parse(result[0]?.results[0])?.revision ?? 0,
      skills: z.array(skillRowSchema).parse(result[1]?.results).map(row => this.summary(row)),
    });
  }
  async projection(): Promise<readonly SearchEntry[]> {
    await this.live();
    const rows = await this.env.ACCOUNTS.prepare(`SELECT v.entry_json FROM private_skill_versions v
      JOIN private_skills s USING(account_id,generation,skill_id)
      WHERE v.account_id=? AND v.generation=? AND s.tombstoned=0
      AND v.deleting_revision IS NULL AND (v.digest=s.digest OR v.pinned=1)
      ORDER BY s.skill_id,v.digest`).bind(this.principal.accountId, this.principal.generation).all();
    return z.array(z.object({ entry_json: z.string() })).parse(rows.results)
      .map(row => searchEntrySchema.parse(JSON.parse(row.entry_json)));
  }
  async manifests(skillId: PrivateSkillId) {
    await this.live();
    const rows = await this.env.ACCOUNTS.prepare(`SELECT digest,manifest_json FROM private_skill_uploads
      WHERE account_id=? AND generation=? AND skill_id=?`).bind(...this.identity(skillId)).all();
    return z.array(z.object({ digest: z.string(), manifest_json: z.string() })).parse(rows.results)
      .map(row => ({ digest: row.digest, manifest: privateSkillManifestSchema.parse(JSON.parse(row.manifest_json)) }));
  }
}
