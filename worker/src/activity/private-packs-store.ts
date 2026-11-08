import { z } from "zod";
import { privatePackDefinitionSchema, privatePackDigestSchema } from "../../../shared/private-packs.ts";
import type { PrivatePackDefinition } from "../../../shared/private-packs.ts";
import { parsePrivateSkillUri, privateSkillManifestSchema } from "../../../shared/private-skills.ts";
import type { PrivateSkillPrincipal } from "../../../shared/private-skills.ts";
import { requireAuthority } from "../private-skills/authority.ts";
import type { PrivateScope } from "../private-skills/authority.ts";
import { searchEntrySchema, versionRowSchema } from "../private-skills/contracts.ts";
import type { ContentEnv } from "./content-env.ts";
import { contentDigest } from "./content-db.ts";
import { readContentKey } from "./content-keys.ts";
import { decryptContent, ManagedCryptoError } from "./crypto.ts";

export class PrivatePackError extends Error {
  readonly name = "PrivatePackError";
  constructor(readonly code: string, readonly status: number = 409) { super(code); }
}
export const packJobSchema = z.object({
  request_id: z.string(), request_hash: privatePackDigestSchema, name: z.string(),
  digest: privatePackDigestSchema, expected_digest: privatePackDigestSchema.nullable(),
  operation: z.enum(["create", "update"]), object_key: z.string(), key_version: z.number().int(),
  state: z.enum(["accepted", "published", "failed"]), content_ready: z.number().int(),
  unchanged: z.number().int(), revision: z.number().int().nullable(), error: z.string().nullable(),
  created_at: z.number().int(),
}).readonly();
export type PackJob = z.infer<typeof packJobSchema>;
export const packVersionSchema = z.object({
  name: z.string(), digest: privatePackDigestSchema, object_key: z.string(),
  key_version: z.number().int(), created_at: z.number().int(), created_by: z.string(),
}).readonly();
export type PackVersion = z.infer<typeof packVersionSchema>;
const headSchema = z.object({
  digest: privatePackDigestSchema, revision: z.number().int(), tombstoned: z.number().int(),
  created_at: z.number().int(),
}).readonly();
export const packBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

export class PrivatePackStore {
  constructor(readonly env: ContentEnv, readonly principal: PrivateSkillPrincipal, readonly scope: PrivateScope) {}
  identity() { return [this.principal.accountId, this.principal.generation] as const; }
  async live() {
    await requireAuthority(this.env, this.principal, this.scope);
    // An account can read an empty private catalog before its first skill write.
    // Bootstrap only a missing fence; never reopen a closed or older generation.
    const existing = await this.env.ACTIVITY.prepare("SELECT 1 FROM tenant_fences WHERE account_id=?")
      .bind(this.principal.accountId).first();
    if (existing === null) {
      await this.env.ACTIVITY.prepare(`INSERT INTO tenant_fences(account_id,generation,state)
        VALUES(?,?,'active') ON CONFLICT(account_id) DO NOTHING`).bind(...this.identity()).run();
      await requireAuthority(this.env, this.principal, this.scope);
    }
    if (await this.env.ACTIVITY.prepare(`SELECT 1 FROM tenant_fences
      WHERE account_id=? AND generation=? AND state='active'`).bind(...this.identity()).first() === null) {
      throw new PrivatePackError("tenant_fenced", 403);
    }
  }
  async job(requestId: string): Promise<PackJob | null> {
    const row = await this.env.ACTIVITY.prepare(`SELECT * FROM private_pack_jobs
      WHERE account_id=? AND generation=? AND request_id=?`).bind(...this.identity(), requestId).first();
    return row === null ? null : packJobSchema.parse(row);
  }
  async head(name: string) {
    const row = await this.env.ACTIVITY.prepare(`SELECT * FROM private_pack_heads
      WHERE account_id=? AND generation=? AND name=?`).bind(...this.identity(), name).first();
    return row === null ? null : headSchema.parse(row);
  }
  async version(name: string, digest: string) {
    const row = await this.env.ACTIVITY.prepare(`SELECT v.* FROM private_pack_versions v
      JOIN private_pack_heads h USING(account_id,generation,name)
      WHERE v.account_id=? AND v.generation=? AND v.name=? AND v.digest=? AND h.tombstoned=0`)
      .bind(...this.identity(), name, digest).first();
    if (row === null) throw new PrivatePackError("not_found", 404);
    return packVersionSchema.parse(row);
  }
  async definition(record: Pick<PackVersion, "object_key" | "key_version" | "digest" | "name">) {
    await this.live();
    const object = await this.env.ACTIVITY_RAW.get(record.object_key);
    if (object === null) throw new PrivatePackError("pack_integrity");
    const key = await readContentKey(this.env.ACTIVITY, this.principal, this.env.CONTENT_KEYRING, record.key_version);
    let definition;
    try {
      const bytes = await decryptContent(key, {
        accountId: this.principal.accountId, generation: this.principal.generation,
        objectKey: record.object_key, revision: 0, schemaVersion: 1,
      }, await object.json());
      if (await contentDigest(bytes) !== record.digest) throw new PrivatePackError("pack_integrity");
      definition = privatePackDefinitionSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    } catch (error) {
      if (error instanceof ManagedCryptoError || error instanceof SyntaxError ||
          error instanceof TypeError || error instanceof z.ZodError) throw new PrivatePackError("pack_integrity");
      throw error;
    }
    if (definition.name !== record.name) throw new PrivatePackError("pack_integrity");
    if ((await this.head(record.name))?.tombstoned) throw new PrivatePackError("pack_tombstoned", 410);
    await this.live();
    return definition;
  }
  async members(definition: PrivatePackDefinition) {
    await this.live();
    const refs = definition.members.map(member => parsePrivateSkillUri(member.uri));
    // One primary query for the entire bounded membership, not three reads per skill/version.
    const rows = await this.env.ACCOUNTS.prepare(`SELECT v.* FROM private_skill_versions v
      JOIN private_skills s USING(account_id,generation,skill_id)
      JOIN json_each(?) r ON v.skill_id=json_extract(r.value,'$.skillId')
        AND v.digest=json_extract(r.value,'$.digest')
      WHERE v.account_id=? AND v.generation=? AND s.tombstoned=0 AND v.deleting_revision IS NULL`)
      .bind(JSON.stringify(refs), ...this.identity()).all();
    const versions = new Map(rows.results.map(row => {
      const id = z.object({ skill_id: z.string() }).parse(row).skill_id;
      const version = versionRowSchema.parse(row);
      return [`${id}/${version.digest}`, version] as const;
    }));
    const resolved = [];
    for (const member of definition.members) {
      const ref = parsePrivateSkillUri(member.uri);
      const version = versions.get(`${ref.skillId}/${ref.digest}`);
      if (version === undefined) throw new PrivatePackError("member_unavailable");
      if (version.pinned !== 1) throw new PrivatePackError("member_not_pinned");
      const manifest = privateSkillManifestSchema.parse(JSON.parse(version.manifest_json));
      const entry = searchEntrySchema.parse(JSON.parse(version.entry_json));
      const resource = manifest.resources.find(item => item.path === "SKILL.md");
      if (await contentDigest(packBytes(manifest)) !== ref.digest ||
          resource === undefined || entry.uri !== member.uri || entry.digest !== resource.digest) {
        throw new PrivatePackError("member_integrity");
      }
      resolved.push({ ...member, skill_id: ref.skillId, manifest_digest: ref.digest,
        digest: resource.digest, invocation: entry.invocation, name: entry.name });
    }
    await this.live();
    return resolved;
  }
}
