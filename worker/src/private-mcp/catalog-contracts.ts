import { z } from "zod";
import {
  privateSkillCatalogSchema, privateSkillManifestSchema, privateSkillResourceSchema,
  privateSkillVersionSchema, privateSkillSearchResultSchema, PRIVATE_SKILL_MAX_URI_LENGTH,
} from "../../../shared/private-skills.ts";
import { searchEntrySchema } from "../private-skills/contracts.ts";

/** Matches Local's search tool input, without altering the P10 transport. */
export const mcpSearchSchema = z.strictObject({
  query: z.string().max(2048).optional(),
  mode: z.enum(["discovery", "automatic", "explicit"]).default("discovery"),
  limit: z.number().int().min(1).max(50).default(5),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
}).readonly();
export const mcpSearchResultSchema = privateSkillSearchResultSchema.unwrap().extend({
  total: z.number().int().nonnegative().safe(),
}).readonly();
export const mcpCatalogVersionSchema = privateSkillVersionSchema.unwrap().extend({
  current: z.boolean(),
  entry: searchEntrySchema,
  manifest: privateSkillManifestSchema,
  resources: z.array(privateSkillResourceSchema.unwrap().extend({
    uri: z.string().min(1).max(PRIVATE_SKILL_MAX_URI_LENGTH),
  }).readonly()).readonly(),
}).readonly();
export const mcpCatalogSchema = z.strictObject({
  revision: privateSkillCatalogSchema.unwrap().shape.revision,
  skills: z.array(privateSkillCatalogSchema.unwrap().shape.skills.unwrap().element.unwrap().extend({
    versions: z.array(mcpCatalogVersionSchema).readonly(),
  }).readonly()).readonly(),
}).readonly();
export type McpCatalog = z.infer<typeof mcpCatalogSchema>;
export type McpSearchResult = z.infer<typeof mcpSearchResultSchema>;
