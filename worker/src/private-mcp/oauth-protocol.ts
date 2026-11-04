// SPDX-License-Identifier: AGPL-3.0-only
import { OAuthAuthorizationServer, OAuthError } from "@cloudflare/workers-oauth-provider-v1";
import { z } from "zod";
import { mcpClaimsSchema, mcpScopes } from "../../../shared/mcp-auth.ts";
import { readBody } from "../http.ts";
import { sha256 } from "./hash.ts";
import { activeConnection, connectionSummary } from "./connections.ts";
import { credentialRecord, liveCredential, revokeCredential, storeCredentials } from "./credentials.ts";
import type { McpAuthEnv } from "./contracts.ts";

const responseSchema = z.object({
  access_token: z.string().min(1).max(8192),
  refresh_token: z.string().min(1).max(8192).optional(),
});
export const mcpResource = (env: McpAuthEnv) => `${env.PUBLIC_ORIGIN}/mcp`;

export function createAuthorizationServer(env: McpAuthEnv): OAuthAuthorizationServer<McpAuthEnv> {
  return new OAuthAuthorizationServer<McpAuthEnv>({
    issuer: env.PUBLIC_ORIGIN, resources: [mcpResource(env)], defaultResource: mcpResource(env),
    authorizeEndpoint: "/oauth/authorize", tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    clientIdMetadataDocumentEnabled: true, cookiePrefix: "__Host-skillar-mcp-",
    scopesSupported: [...mcpScopes], accessTokenTTL: 900, refreshTokenTTL: 30 * 86400,
    async tokenExchangeCallback(options) {
      const parsed = mcpClaimsSchema.safeParse(options.props);
      const row = parsed.success ?
        await activeConnection(options.env, { kind: "oauth", claims: parsed.data }) : null;
      if (row === null || row.clientId !== options.clientId ||
          options.subjectClientId !== options.clientId || options.userId !== row.accountId) {
        throw new OAuthError("invalid_grant", { description: "Connection is no longer active." });
      }
      const allowed = connectionSummary(row).scopes;
      if (options.requestedScope.some(scope => !allowed.some(value => value === scope))) {
        throw new OAuthError("invalid_scope", { description: "Connection does not grant this scope." });
      }
      const changed = await options.env.ACCOUNTS.prepare(`UPDATE mcp_connections
        SET oauth_grant_id=? WHERE connection_id=? AND account_id=?
        AND revoked_at IS NULL AND (oauth_grant_id IS NULL OR oauth_grant_id=?)`)
        .bind(options.grantId, row.connectionId, row.accountId, options.grantId).run();
      if (changed.meta.changes === 0) {
        throw new OAuthError("invalid_grant", { description: "Connection is no longer active." });
      }
      return { accessTokenProps: mcpClaimsSchema.parse(options.props) };
    },
  });
}

function requestingClient(request: Request, form: URLSearchParams): string | null {
  const supplied = form.get("client_id");
  if (supplied !== null) return supplied;
  const basic = /^Basic (\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (basic === undefined) return null;
  try { return decodeURIComponent(atob(basic).split(":")[0] ?? ""); }
  catch (error) {
    if (error instanceof DOMException || error instanceof URIError) return null;
    throw error;
  }
}

/** Capture only hashes of credentials that the native provider actually issued. */
export async function protocolRequest(
  request: Request, runtime: { readonly env: McpAuthEnv; readonly ctx: ExecutionContext },
  server: OAuthAuthorizationServer<McpAuthEnv>,
): Promise<Response> {
  const { env, ctx } = runtime;
  const path = new URL(request.url).pathname;
  if (path === "/oauth/register" && request.method === "POST") {
    return server.fetch(new Request(request, { body: await readBody(request, 64 * 1024) }), env, ctx);
  }
  if (path !== "/oauth/token" || request.method !== "POST") {
    return server.fetch(request, env, ctx);
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded") {
    return Response.json({ error: "invalid_request" }, { status: 415 });
  }
  const bytes = await readBody(request, 16 * 1024);
  const forwarded = new Request(request, { body: bytes });
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  if ([...form.keys()].some(key => form.getAll(key).length !== 1)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const previous = form.get("grant_type") === "refresh_token" ? form.get("refresh_token") : null;
  if (previous !== null && !liveCredential(await credentialRecord(env, await sha256(previous)), "refresh")) {
    return Response.json({ error: "invalid_grant" }, {
      status: 400, headers: { "cache-control": "no-store" },
    });
  }
  const response = await server.fetch(forwarded, env, ctx);
  if (!response.ok) return response;
  if (!form.has("grant_type") && form.has("token")) {
    const clientId = requestingClient(request, form), token = form.get("token");
    if (clientId !== null && token !== null) await revokeCredential(env, { clientId, token });
    return response;
  }
  const tokens = responseSchema.parse(await response.clone().json());
  const native = await server.validateToken<unknown>(mcpResource(env), tokens.access_token, env);
  const claims = mcpClaimsSchema.safeParse(native?.props);
  const connection = claims.success ? await activeConnection(env, { kind: "oauth", claims: claims.data }) : null;
  if (native === null || connection === null) {
    throw new OAuthError("invalid_grant", { description: "Connection is no longer active." });
  }
  await storeCredentials(env, {
    connectionId: connection.connectionId, accessToken: tokens.access_token,
    accessExpiresAt: native.expiresAt, connectionExpiresAt: connection.expiresAt, scopes: native.scope,
    ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }),
    ...(previous === null ? {} : { previousRefreshToken: previous }),
  });
  if (!liveCredential(await credentialRecord(env, await sha256(tokens.access_token)), "access")) {
    throw new OAuthError("invalid_grant", { description: "Connection is no longer active." });
  }
  return response;
}
