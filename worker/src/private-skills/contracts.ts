// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { privateSkillDigestSchema, privateSkillIdSchema } from "../../../shared/private-skills.ts";

export interface PrivateSkillsEnv {
  readonly ACCOUNTS: D1Database;
  readonly ACTIVITY: D1Database;
  readonly ACTIVITY_RAW: R2Bucket;
  readonly PRIVATE_SKILL_CATALOG?: DurableObjectNamespace;
  readonly PRIVATE_SKILLS_ENABLED?: string;
  readonly PUBLIC_ORIGIN?: string;
  readonly PUBLIC_ORIGIN_ALIAS?: string;
}
export type CatalogEnv = PrivateSkillsEnv & {
  readonly PRIVATE_SKILL_CATALOG: DurableObjectNamespace;
};
export class PrivateSkillError extends Error {
  readonly name = "PrivateSkillError";
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export const privateHeaders = {
  "cache-control": "no-store", "x-content-type-options": "nosniff",
};
export const skillRowSchema = z.object({
  skill_id: privateSkillIdSchema, digest: privateSkillDigestSchema,
  revision: z.number().int().positive().safe(),
  name: z.string(), description: z.string(), updated_at: z.number().int().nonnegative(),
  tombstoned: z.number().int(), purge_complete: z.number().int(), mutation_id: z.string(),
}).readonly();
export type SkillRow = z.infer<typeof skillRowSchema>;
export const versionRowSchema = z.object({
  digest: privateSkillDigestSchema, manifest_json: z.string(), entry_json: z.string(),
  created_at: z.number().int().nonnegative(), pinned: z.number().int(),
  deleting_revision: z.number().int().nullable(),
}).readonly();
export type VersionRow = z.infer<typeof versionRowSchema>;
export const searchEntrySchema = z.object({
  uri: z.string(), name: z.string(), description: z.string(),
  whenToUse: z.string().optional(), examples: z.array(z.string()).readonly(),
  aliasesKo: z.array(z.string()).readonly(), invocation: z.enum(["automatic", "explicit"]),
  bodyHead: z.string(), digest: privateSkillDigestSchema,
}).readonly();
