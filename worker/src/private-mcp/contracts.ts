// SPDX-License-Identifier: AGPL-3.0-only
import type { McpContext } from "../../../shared/mcp-auth.ts";
import type { PrivateSkillPrincipal } from "../../../shared/private-skills.ts";
import type { AuthorizationServerBinding } from "@cloudflare/workers-oauth-provider-v1";

export interface McpAuthEnv {
  readonly ACCOUNTS: D1Database;
  readonly OAUTH_KV: KVNamespace;
  readonly OAUTH_RATE_LIMITER: RateLimit;
  readonly PUBLIC_ORIGIN: string;
  readonly PUBLIC_ORIGIN_ALIAS?: string;
  readonly MCP_ENABLED?: string;
}
export interface McpResourceEnv {
  readonly MCP_AUTH: AuthorizationServerBinding<McpContext>;
  readonly ACTIVITY_SERVICE: Fetcher;
  readonly PUBLIC_ORIGIN: string;
  readonly MCP_ENABLED?: string;
}
export type McpBrowserPrincipal = Extract<PrivateSkillPrincipal, { readonly kind: "browser" }>;
export class McpAuthError extends Error {
  readonly name = "McpAuthError";
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export const mcpNoStore = {
  "cache-control": "no-store", "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
