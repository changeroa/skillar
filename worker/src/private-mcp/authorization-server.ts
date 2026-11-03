// SPDX-License-Identifier: AGPL-3.0-only
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  AuthorizationError, CimdFetchError, OAuthError,
} from "@cloudflare/workers-oauth-provider-v1";
import type { ValidatedAccessToken } from "@cloudflare/workers-oauth-provider-v1";
import { z } from "zod";
import { mcpClaimsSchema, mcpConnectionIdSchema, mcpPatRequestSchema } from "../../../shared/mcp-auth.ts";
import type { McpContext } from "../../../shared/mcp-auth.ts";
import { BodyTooLargeError, readBody } from "../http.ts";
import { sha256 } from "./hash.ts";
import { PrivateSkillError } from "../private-skills/contracts.ts";
import {
  activeConnection, connectionContext, connectionSummary, createConnection,
  listConnections, opaqueMcpToken, revokeConnection,
} from "./connections.ts";
import { credentialRecord, credentialScopesSchema, liveCredential } from "./credentials.ts";
import { authorizeConnection, requireBrowser } from "./consent.ts";
import { createAuthorizationServer, mcpResource, protocolRequest } from "./oauth-protocol.ts";
import { McpAuthError, mcpNoStore } from "./contracts.ts";
import type { McpAuthEnv } from "./contracts.ts";

export default class McpAuthorizationServer extends WorkerEntrypoint<McpAuthEnv> {
  readonly #provider = createAuthorizationServer(this.env);

  async #boundary(action: () => Promise<Response>): Promise<Response> {
    try {
      const response = await action(), headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(mcpNoStore)) headers.set(name, value);
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo !== undefined) {
        return new Response(null, { status: 302, headers: { ...mcpNoStore, location: error.redirectTo } });
      }
      if (error instanceof McpAuthError) return Response.json({ error: error.code }, {
        status: error.status,
        headers: { ...mcpNoStore, ...(error.status === 429 ? { "retry-after": "60" } : {}) },
      });
      if (error instanceof PrivateSkillError) {
        return Response.json({ error: error.code }, { status: error.status, headers: mcpNoStore });
      }
      if (error instanceof BodyTooLargeError) {
        return Response.json({ error: "invalid_request" }, { status: 413, headers: mcpNoStore });
      }
      if (error instanceof AuthorizationError || error instanceof OAuthError) {
        return Response.json({ error: error.code }, { status: 400, headers: mcpNoStore });
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        return Response.json({ error: "invalid_request" }, { status: 400, headers: mcpNoStore });
      }
      if (!(error instanceof Error)) throw error;
      console.error("skillar.mcp.authorization_unavailable", {
        name: error instanceof CimdFetchError ? "CimdFetchError" : error.name,
      });
      return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: mcpNoStore });
    }
  }
  #enabled(request: Request): void {
    if (this.env.MCP_ENABLED !== "true") throw new McpAuthError(404, "not_found");
    if (new URL(request.url).origin !== this.env.PUBLIC_ORIGIN) {
      throw new McpAuthError(421, "invalid_host");
    }
  }
  async #admit(request: Request, accountId?: string): Promise<void> {
    const key = accountId === undefined ?
      `anonymous:${await sha256(request.headers.get("cf-connecting-ip") ?? "unknown")}` : `account:${accountId}`;
    if (!(await this.env.OAUTH_RATE_LIMITER.limit({ key })).success) {
      throw new McpAuthError(429, "rate_limited");
    }
  }
  fetch(request: Request): Promise<Response> {
    return this.#boundary(async () => {
      this.#enabled(request);
      const path = new URL(request.url).pathname;
      if (!["/.well-known/oauth-authorization-server", "/oauth/token", "/oauth/register"].includes(path)) {
        throw new McpAuthError(404, "not_found");
      }
      await this.#admit(request);
      return protocolRequest(request, { env: this.env, ctx: this.ctx }, this.#provider);
    });
  }
  /** Only a private Pages Service Binding supplies the independently verified Google principal. */
  authorize(request: Request, principal: unknown): Promise<Response> {
    return this.#boundary(async () => {
      this.#enabled(request);
      const browser = await requireBrowser(request, this.env, principal);
      await this.#admit(request, browser.accountId);
      return authorizeConnection(request, { env: this.env, browser }, this.#provider);
    });
  }
  manage(request: Request, principal: unknown): Promise<Response> {
    return this.#boundary(async () => {
      this.#enabled(request);
      const browser = await requireBrowser(request, this.env, principal);
      await this.#admit(request, browser.accountId);
      const url = new URL(request.url), prefix = "/api/mcp/connections";
      if (url.search !== "") throw new McpAuthError(400, "invalid_request");
      if (url.pathname === prefix && request.method === "GET") {
        return Response.json(await listConnections(this.env, browser));
      }
      if (url.pathname === prefix && request.method === "POST") {
        const body = mcpPatRequestSchema.parse(JSON.parse(
          new TextDecoder().decode(await readBody(request, 4096)),
        ));
        const token = `skm_${opaqueMcpToken()}`;
        const connection = await createConnection(this.env, browser, {
          kind: "pat", name: body.name, expiresInDays: body.expiresInDays,
          recordActivity: body.recordActivity, tokenHash: await sha256(token),
        });
        return Response.json({ connection, token }, { status: 201 });
      }
      if (url.pathname.startsWith(`${prefix}/`) && request.method === "DELETE") {
        const id = mcpConnectionIdSchema.parse(url.pathname.slice(prefix.length + 1));
        const { grantId } = await revokeConnection(this.env, browser, id);
        if (grantId !== null) this.ctx.waitUntil(this.#cleanupGrant(id, browser.accountId, grantId));
        return Response.json({ revoked: true });
      }
      throw new McpAuthError(405, "method_not_allowed");
    });
  }
  async validateToken(resource: string, token: string): Promise<ValidatedAccessToken<McpContext> | null> {
    if (this.env.MCP_ENABLED !== "true" || resource !== mcpResource(this.env) || token.length > 8192) return null;
    const tokenHash = await sha256(token);
    if (/^skm_[A-Za-z0-9_-]{43}$/.test(token)) {
      const row = await activeConnection(this.env, { kind: "pat", tokenHash });
      if (row === null) return null;
      const scope = [...connectionSummary(row).scopes];
      return {
        audience: resource, expiresAt: row.expiresAt, userId: row.accountId,
        clientId: `pat-${row.connectionId}`, scope,
        props: connectionContext(this.env, row, { scopes: scope, tokenHash }),
      };
    }
    const credential = await credentialRecord(this.env, tokenHash);
    if (!liveCredential(credential, "access")) return null;
    const native = await this.#provider.validateToken<unknown>(resource, token, this.env);
    const claims = mcpClaimsSchema.safeParse(native?.props);
    if (native === null || !claims.success || claims.data.connectionId !== credential.connectionId ||
        claims.data.accountId !== credential.accountId || claims.data.generation !== credential.generation ||
        native.clientId !== credential.clientId) return null;
    const row = await activeConnection(this.env, { kind: "oauth", claims: claims.data });
    if (row === null) return null;
    const issued = credentialScopesSchema.parse(JSON.parse(credential.scopesJson));
    const scope = native.scope.filter(value => issued.some(allowed => allowed === value));
    return {
      ...native, scope, expiresAt: Math.min(native.expiresAt, credential.expiresAt, row.expiresAt),
      props: connectionContext(this.env, row, { scopes: scope, tokenHash }),
    };
  }
  async #cleanupGrant(id: string, accountId: string, grantId: string): Promise<void> {
    await this.#provider.getOAuthApi(this.env).revokeGrant(grantId, accountId);
    await this.env.ACCOUNTS.prepare(`UPDATE mcp_connections SET oauth_cleanup_pending=0
      WHERE connection_id=? AND account_id=? AND revoked_at IS NOT NULL`).bind(id, accountId).run();
  }
  async scheduled(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.env.ACCOUNTS.batch([
      this.env.ACCOUNTS.prepare("DELETE FROM mcp_credentials WHERE expires_at<=?").bind(now),
      this.env.ACCOUNTS.prepare("DELETE FROM mcp_consents WHERE expires_at<=?").bind(now),
      this.env.ACCOUNTS.prepare("DELETE FROM google_login_returns WHERE expires_at<=?").bind(now),
    ]);
    const rows = await this.env.ACCOUNTS.prepare(`SELECT connection_id,account_id,oauth_grant_id
      FROM mcp_connections WHERE oauth_cleanup_pending=1 LIMIT 20`).all();
    const schema = z.object({ connection_id: z.string(), account_id: z.string(), oauth_grant_id: z.string() });
    for (const value of rows.results) {
      const row = schema.parse(value);
      await this.#cleanupGrant(row.connection_id, row.account_id, row.oauth_grant_id);
    }
    await this.#provider.purgeExpiredData(this.env);
  }
}
