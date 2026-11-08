import { z } from "zod";
import { accountIdSchema, deviceIdSchema } from "./activity-schema.js";
import { deploymentOriginSchema } from "./deployment-origin.js";

export const mcpScopes = ["skills:read", "activity:record", "offline_access"] as const;
export const mcpScopeSchema = z.enum(mcpScopes);
export const mcpConnectionIdSchema = z.string().uuid().brand<"McpConnectionId">();
export const mcpPrivatePrincipalSchema = z.strictObject({
  kind: z.literal("mcp"),
  accountId: accountIdSchema,
  generation: z.number().int().positive().safe(),
  shardId: z.literal("activity-00"),
  issuer: deploymentOriginSchema,
  scopes: z.array(z.enum(["skills:read", "skills:write"])).max(2).readonly(),
  sessionId: z.null(),
  deviceId: deviceIdSchema,
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  connectionId: mcpConnectionIdSchema,
}).readonly();
export const mcpContextSchema = z.strictObject({
  principal: mcpPrivatePrincipalSchema,
  recordActivity: z.boolean(),
  clientName: z.string().min(1).max(200),
}).readonly();
export const mcpClaimsSchema = z.strictObject({
  connectionId: mcpConnectionIdSchema,
  accountId: accountIdSchema,
  generation: z.number().int().positive().safe(),
}).readonly();
export const mcpConnectionSummarySchema = z.strictObject({
  connectionId: mcpConnectionIdSchema,
  kind: z.enum(["oauth", "pat"]),
  name: z.string().min(1).max(200),
  scopes: z.array(mcpScopeSchema).readonly(),
  recordActivity: z.boolean(),
  createdAt: z.number().int().nonnegative().safe(),
  expiresAt: z.number().int().positive().safe(),
  revokedAt: z.number().int().nonnegative().safe().nullable(),
}).readonly();
export const mcpConnectionsSchema = z.strictObject({
  resource: z.url(),
  connections: z.array(mcpConnectionSummarySchema).readonly(),
}).readonly();
export const mcpPatRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(30),
  recordActivity: z.boolean(),
}).readonly();
export const mcpPatResponseSchema = z.strictObject({
  connection: mcpConnectionSummarySchema,
  token: z.string().regex(/^skm_[A-Za-z0-9_-]{43}$/),
}).readonly();

export type McpConnectionId = z.infer<typeof mcpConnectionIdSchema>;
export type McpPrivatePrincipal = z.infer<typeof mcpPrivatePrincipalSchema>;
export type McpContext = z.infer<typeof mcpContextSchema>;
export type McpClaims = z.infer<typeof mcpClaimsSchema>;
export type McpConnectionSummary = z.infer<typeof mcpConnectionSummarySchema>;
