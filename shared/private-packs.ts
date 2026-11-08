import { z } from "zod";
import { parsePrivateSkillUri, PrivateSkillContractError } from "./private-skills.js";

export const PRIVATE_PACK_SERVICE_PREFIX = "/v1/private-packs";
export const privatePackPhases = ["scope", "investigate", "verify", "handoff", "explain"] as const;
export const privatePackNameSchema = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const privatePackDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const privatePackUriSchema = z.string().refine(value =>
  value.startsWith("pack://private/") && privatePackNameSchema.safeParse(value.slice(15)).success);
export const privatePackUri = (name: string) => `pack://private/${name}`;
const text = (max: number) => z.string().min(1).max(max)
  .refine(value => value.trim().length > 0 && !value.includes("\0"));
export const privatePackMemberSchema = z.strictObject({
  uri: z.string().max(1024).refine(value => {
    try { return parsePrivateSkillUri(value).path === "SKILL.md"; }
    catch (error) {
      if (error instanceof PrivateSkillContractError || error instanceof z.ZodError) return false;
      throw error;
    }
  }),
  phase: z.enum(privatePackPhases),
  selection: z.enum(["required", "when_applicable", "when_requested"]),
  when: text(2048),
}).readonly();
export const privatePackDefinitionSchema = z.strictObject({
  schema_version: z.literal(1), kind: z.literal("skill-pack"),
  name: privatePackNameSchema, display_name: text(128), description: text(2048), scope: text(4096),
  members: z.array(privatePackMemberSchema).min(3).max(64).readonly(),
}).superRefine((value, context) => {
  const ids = value.members.map(member => member.uri.split("/")[3]);
  if (new Set(ids).size !== ids.length ||
      ["scope", "verify"].some(phase => {
        const members = value.members.filter(member => member.phase === phase);
        return members.length !== 1 || members[0]?.selection !== "required";
      }) || !value.members.some(member => member.phase === "investigate" && member.selection === "required")) {
    context.addIssue({ code: "custom", message: "Invalid membership or required phases" });
  }
}).readonly();
const write = {
  request_id: z.string().uuid(),
  acknowledge_private_upload: z.literal(true),
  definition: privatePackDefinitionSchema,
};
export const privatePackCreateSchema = z.strictObject(write).readonly();
export const privatePackUpdateSchema = z.strictObject({
  ...write, uri: privatePackUriSchema, expected_digest: privatePackDigestSchema,
}).refine(value => value.uri === privatePackUri(value.definition.name)).readonly();
export const privatePackStatusSchema = z.strictObject({ request_id: z.string().uuid() }).readonly();
export const privatePackSearchSchema = z.strictObject({
  query: z.string().max(2048).optional(), mode: z.enum(["discovery", "explicit"]).default("discovery"),
  offset: z.number().int().nonnegative().safe().default(0),
  limit: z.number().int().min(1).max(50).default(5),
}).refine(value => value.mode === "explicit" || Boolean(value.query?.trim())).readonly();
export const privatePackSelectionSchema = z.strictObject({
  uri: privatePackUriSchema, digest: privatePackDigestSchema,
}).readonly();
export const privatePackLoadSchema = z.strictObject({
  packs: z.array(privatePackSelectionSchema).min(1).max(8).readonly(),
}).refine(value => new Set(value.packs.map(pack => pack.uri)).size === value.packs.length).readonly();
export type PrivatePackDefinition = z.infer<typeof privatePackDefinitionSchema>;
export type PrivatePackMember = z.infer<typeof privatePackMemberSchema>;
export type PrivatePackCreate = z.infer<typeof privatePackCreateSchema>;
export type PrivatePackUpdate = z.infer<typeof privatePackUpdateSchema>;

const receipt = {
  request_id: z.string().uuid(), uri: privatePackUriSchema, digest: privatePackDigestSchema,
  current_digest: privatePackDigestSchema.nullable(),
};
export const privatePackReceiptSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...receipt, status: z.literal("accepted"), revision: z.null(), unchanged: z.literal(false),
    content_durable: z.boolean(), searchable: z.literal(false), error: z.null(),
  }),
  z.strictObject({
    ...receipt, status: z.literal("published"), revision: z.number().int().positive().safe(),
    unchanged: z.boolean(), content_durable: z.literal(true), searchable: z.boolean(), error: z.null(),
  }),
  z.strictObject({
    ...receipt, status: z.literal("failed"), revision: z.null(), unchanged: z.literal(false),
    content_durable: z.boolean(), searchable: z.literal(false), error: z.string().min(1),
  }),
]).readonly();
const registration = {
  created_by: z.string().min(1), created_at: z.number().int().nonnegative().safe(),
  updated_by: z.string().min(1), updated_at: z.number().int().nonnegative().safe(),
};
const publication = {
  uri: privatePackUriSchema, digest: privatePackDigestSchema,
  publication_status: z.enum(["published", "verified_snapshot"]),
};
export const privatePackSearchResultSchema = z.strictObject({
  packs: z.array(privatePackDefinitionSchema.unwrap().safeExtend({
    ...registration, ...publication,
  }).readonly()).max(50).readonly(),
  totalMatches: z.number().int().nonnegative().safe(),
  offset: z.number().int().nonnegative().safe(), limit: z.number().int().min(1).max(50),
  nextOffset: z.number().int().nonnegative().safe().optional(),
}).readonly();
export const privatePackLoadResultSchema = z.strictObject({
  packs: z.array(z.strictObject({
    ...registration, ...publication, definition: privatePackDefinitionSchema,
  }).readonly()).min(1).max(8).readonly(),
  members: z.array(z.strictObject({
    uri: privatePackMemberSchema.unwrap().shape.uri, phase: z.enum(privatePackPhases),
    required: z.boolean(), invocation: z.enum(["automatic", "explicit"]),
    digest: privatePackDigestSchema, manifest_digest: privatePackDigestSchema,
    requirements: z.array(privatePackMemberSchema.unwrap().extend({
      pack_uri: privatePackUriSchema, pack_digest: privatePackDigestSchema,
    }).readonly()).min(1).max(8).readonly(),
  }).readonly()).min(3).max(512).readonly(),
  composition: z.strictObject({
    declared_members: z.number().int().min(3).max(512),
    unique_members: z.number().int().min(3).max(512),
    single_scope_and_verifier: z.literal(true), load_selected_bodies_only: z.literal(true),
  }).readonly(),
  permissions: z.strictObject({
    grants_execution: z.literal(false), grants_delegation: z.literal(false), grants_publication: z.literal(false),
  }).readonly(),
  guidance: z.string(),
}).readonly();
export type PrivatePackReceipt = z.infer<typeof privatePackReceiptSchema>;
export type PrivatePackSearchResult = z.infer<typeof privatePackSearchResultSchema>;
export type PrivatePackLoadResult = z.infer<typeof privatePackLoadResultSchema>;
