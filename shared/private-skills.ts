import { z } from "zod";
import { accountIdSchema, deviceIdSchema } from "./activity-schema.js";
import { deploymentOriginSchema } from "./deployment-origin.js";

export const PRIVATE_SKILL_MAX_RESOURCE_BYTES = 512 * 1024;
export const PRIVATE_SKILL_MAX_BYTES = 2 * 1024 * 1024;
export const PRIVATE_SKILL_MAX_RESOURCES = 128;
export const PRIVATE_SKILL_MAX_REQUEST_BYTES = 3 * 1024 * 1024;
export const PRIVATE_SKILL_MAX_URI_LENGTH = 8192;
export const PRIVATE_SKILL_SERVICE_PREFIX = "/v1/private-skills";
export const privateSkillIdSchema = z.string().uuid().toLowerCase().brand<"PrivateSkillId">();
export const privateSkillDigestSchema = z.string().regex(/^[a-f0-9]{64}$/).brand<"PrivateSkillDigest">();

/** Portable relative files only. Archives are deliberately not an upload format. */
export const privateSkillPathSchema = z.string().min(1).max(512).refine(value => {
  if (value !== value.normalize("NFC") || /[%\\:\0]/u.test(value) ||
      /\.(?:zip|tar|tgz|gz|bz2|xz|7z|rar)$/i.test(value)) return false;
  return value.split("/").every(segment => segment !== "" && segment !== "." && segment !== ".." &&
    segment === segment.trim() && !segment.endsWith(".") &&
    /^[\p{L}\p{N}._ -]+$/u.test(segment) && !/^\.(?:git|svn|hg)$/i.test(segment) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}).brand<"PrivateSkillPath">();

export const privateSkillResourceSchema = z.strictObject({
  path: privateSkillPathSchema,
  mediaType: z.string().min(3).max(128).regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/),
  bytes: z.number().int().min(0).max(PRIVATE_SKILL_MAX_RESOURCE_BYTES),
  digest: privateSkillDigestSchema,
}).readonly();
export const privateSkillManifestSchema = z.strictObject({
  schemaVersion: z.literal(1), entrypoint: z.literal("SKILL.md"),
  resources: z.array(privateSkillResourceSchema).min(1).max(PRIVATE_SKILL_MAX_RESOURCES).readonly(),
}).superRefine((manifest, context) => {
  const paths = manifest.resources.map(resource => resource.path);
  const folded = paths.map(path => path.toLowerCase());
  if (!paths.some(path => path === "SKILL.md") ||
      new Set(folded).size !== paths.length ||
      folded.some(path => folded.some(other => other.startsWith(`${path}/`))) ||
      manifest.resources.some(resource => resource.path === "SKILL.md" && resource.bytes > 64 * 1024) ||
      paths.some((path, index) => index > 0 && path <= (paths[index - 1] ?? "")) ||
      manifest.resources.reduce((sum, resource) => sum + resource.bytes, 0) > PRIVATE_SKILL_MAX_BYTES) {
    context.addIssue({ code: "custom", message: "invalid resource membership, order or total" });
  }
}).readonly();
export const privateSkillBodySchema = z.string()
  .max(4 * Math.ceil(PRIVATE_SKILL_MAX_RESOURCE_BYTES / 3))
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const privateSkillPackageSchema = z.strictObject({
  manifest: privateSkillManifestSchema,
  manifestDigest: privateSkillDigestSchema,
  contents: z.array(z.strictObject({
    path: privateSkillPathSchema,
    body: privateSkillBodySchema,
  }).readonly()).min(1).max(PRIVATE_SKILL_MAX_RESOURCES).readonly(),
}).superRefine((packet, context) => {
  if (packet.contents.reduce((sum, content) => sum + content.body.length, 0) >
      4 * Math.ceil(PRIVATE_SKILL_MAX_BYTES / 3) + 4 * PRIVATE_SKILL_MAX_RESOURCES) {
    context.addIssue({ code: "custom", message: "encoded resources exceed package quota" });
  }
}).readonly();
export const privateSkillHeadSchema = z.strictObject({
  digest: privateSkillDigestSchema, revision: z.number().int().positive().safe(),
}).readonly();
export const privateSkillPublishSchema = z.strictObject({
  base: privateSkillHeadSchema.nullable(),
  acknowledgePrivateUpload: z.literal(true),
  package: privateSkillPackageSchema,
}).readonly();
export const privateSkillHeadChangeSchema = z.strictObject({
  base: privateSkillHeadSchema, targetDigest: privateSkillDigestSchema,
}).readonly();
export const privateSkillDeleteSchema = z.strictObject({
  base: privateSkillHeadSchema,
}).readonly();
export const privateSkillPinSchema = z.strictObject({
  base: privateSkillHeadSchema, targetDigest: privateSkillDigestSchema, pinned: z.boolean(),
}).readonly();
export const privateSkillSummarySchema = z.strictObject({
  skillId: privateSkillIdSchema, name: z.string().min(1).max(128),
  description: z.string().min(1).max(4096), head: privateSkillHeadSchema,
  updatedAt: z.number().int().nonnegative().safe(),
}).readonly();
export const privateSkillCatalogSchema = z.strictObject({
  revision: z.number().int().nonnegative().safe(),
  skills: z.array(privateSkillSummarySchema).readonly(),
}).readonly();
export const privateSkillVersionSchema = z.strictObject({
  digest: privateSkillDigestSchema, createdAt: z.number().int().nonnegative().safe(),
  pinned: z.boolean(),
}).readonly();
export const privateSkillDetailSchema = z.strictObject({
  skill: privateSkillSummarySchema,
  versions: z.array(privateSkillVersionSchema).readonly(),
}).readonly();
export const privateSkillExportSchema = z.strictObject({
  skillId: privateSkillIdSchema, version: privateSkillVersionSchema,
  package: privateSkillPackageSchema,
}).readonly();
export const privateSkillReadSchema = privateSkillResourceSchema.unwrap().omit({ path: true }).extend({
  uri: z.string().min(1).max(PRIVATE_SKILL_MAX_URI_LENGTH), body: privateSkillBodySchema,
}).readonly();
export const privateSkillSearchResultSchema = z.strictObject({
  traceId: z.string().uuid(), query: z.string().max(4096),
  mode: z.enum(["discovery", "automatic", "explicit"]),
  candidates: z.array(z.strictObject({
    uri: z.string().max(PRIVATE_SKILL_MAX_URI_LENGTH), name: z.string(), description: z.string(),
    score: z.number().finite(), rank: z.number().int().positive(),
    invocation: z.enum(["automatic", "explicit"]), digest: z.string(),
    matched: z.array(z.string()).readonly(),
  }).readonly()).max(50).readonly(),
  abstained: z.strictObject({
    reason: z.enum(["empty_query", "no_overlap", "below_threshold", "explicit_only"]),
    hint: z.string(),
  }).readonly().optional(),
  elapsedMs: z.number().finite().nonnegative(),
}).readonly();
export const privateSkillScopes = ["skills:read", "skills:write"] as const;
export const privateSkillIdentitySchema = z.strictObject({
  accountId: accountIdSchema, generation: z.number().int().positive().safe(),
  deviceId: deviceIdSchema.nullable(),
  scopes: z.array(z.enum(privateSkillScopes)).min(1).max(2).readonly(),
}).readonly();
const principal = {
  accountId: accountIdSchema, generation: z.number().int().positive().safe(),
  shardId: z.literal("activity-00"), issuer: deploymentOriginSchema,
  scopes: z.array(z.enum(privateSkillScopes)).min(1).max(2).readonly(),
};
export const privateSkillPrincipalSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...principal, kind: z.literal("browser"), sessionId: z.string().min(32).max(128),
    deviceId: z.null(), tokenHash: z.null(),
  }),
  z.strictObject({
    ...principal, kind: z.literal("device"), sessionId: z.null(), deviceId: deviceIdSchema,
    tokenHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
]).readonly();

export type PrivateSkillId = z.infer<typeof privateSkillIdSchema>;
export type PrivateSkillDigest = z.infer<typeof privateSkillDigestSchema>;
export type PrivateSkillPath = z.infer<typeof privateSkillPathSchema>;
export type PrivateSkillManifest = z.infer<typeof privateSkillManifestSchema>;
export type PrivateSkillPackage = z.infer<typeof privateSkillPackageSchema>;
export type PrivateSkillPrincipal = z.infer<typeof privateSkillPrincipalSchema>;
export type PrivateSkillHead = z.infer<typeof privateSkillHeadSchema>;
export type PrivateSkillSummary = z.infer<typeof privateSkillSummarySchema>;
export type PrivateSkillCatalog = z.infer<typeof privateSkillCatalogSchema>;
export type PrivateSkillDetail = z.infer<typeof privateSkillDetailSchema>;
export type PrivateSkillExport = z.infer<typeof privateSkillExportSchema>;
export type PrivateSkillIdentity = z.infer<typeof privateSkillIdentitySchema>;

export class PrivateSkillContractError extends Error {
  readonly name = "PrivateSkillContractError";
  constructor(readonly code: "invalid_resource" | "package_integrity" | "archive_not_supported") {
    super(code);
  }
}

export function privateSkillUri(
  skillId: PrivateSkillId, digest: PrivateSkillDigest, path: PrivateSkillPath,
): string {
  return `skillar://private/${skillId}/${digest}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function parsePrivateSkillUri(input: string): {
  readonly skillId: PrivateSkillId; readonly digest: PrivateSkillDigest; readonly path: PrivateSkillPath;
} {
  const match = input.length > PRIVATE_SKILL_MAX_URI_LENGTH ? null :
    /^skillar:\/\/private\/([^/]+)\/([a-f0-9]{64})\/(.+)$/.exec(input);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new PrivateSkillContractError("invalid_resource");
  }
  let path: string;
  try { path = match[3].split("/").map(decodeURIComponent).join("/"); }
  catch (error) {
    if (error instanceof URIError) throw new PrivateSkillContractError("invalid_resource");
    throw error;
  }
  const skillId = privateSkillIdSchema.parse(match[1]);
  const digest = privateSkillDigestSchema.parse(match[2]);
  const resource = privateSkillPathSchema.parse(path);
  if (privateSkillUri(skillId, digest, resource) !== input) {
    throw new PrivateSkillContractError("invalid_resource");
  }
  return { skillId, digest, path: resource };
}
