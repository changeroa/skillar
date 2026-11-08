// SPDX-License-Identifier: AGPL-3.0-only
import { AuthorizationError } from "@cloudflare/workers-oauth-provider-v1";
import type { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider-v1";
import { z } from "zod";
import { mcpScopeSchema } from "../../../shared/mcp-auth.ts";
import { privateSkillPrincipalSchema } from "../../../shared/private-skills.ts";
import { requireAuthority } from "../private-skills/authority.ts";
import { readBody } from "../http.ts";
import { sha256 } from "./hash.ts";
import { createConnection } from "./connections.ts";
import { consentPage } from "./consent-page.ts";
import { McpAuthError, mcpNoStore } from "./contracts.ts";
import type { McpAuthEnv, McpBrowserPrincipal } from "./contracts.ts";

export async function requireBrowser(
  request: Request, env: McpAuthEnv, value: unknown,
): Promise<McpBrowserPrincipal> {
  const parsed = privateSkillPrincipalSchema.safeParse(value);
  if (!parsed.success || parsed.data.kind !== "browser" || parsed.data.issuer !== env.PUBLIC_ORIGIN ||
      new URL(request.url).origin !== env.PUBLIC_ORIGIN) throw new McpAuthError(401, "unauthorized");
  if (request.method !== "GET" && request.headers.get("origin") !== env.PUBLIC_ORIGIN) {
    throw new McpAuthError(403, "invalid_origin");
  }
  await requireAuthority(env, parsed.data, "skills:read");
  return parsed.data;
}

export async function authorizeConnection(
  request: Request,
  input: { readonly env: McpAuthEnv; readonly browser: McpBrowserPrincipal },
  server: OAuthAuthorizationServer<McpAuthEnv>,
): Promise<Response> {
  const { env, browser } = input, oauth = server.getOAuthApi(env);
  if (new URL(request.url).pathname !== "/oauth/authorize") throw new McpAuthError(404, "not_found");
  if (request.method === "GET") {
    const parsed = await oauth.parseAuthRequest(request);
    if (!parsed.codeChallenge || parsed.codeChallengeMethod !== "S256") {
      throw new AuthorizationError("invalid_request", { description: "PKCE S256 is required." });
    }
    if (parsed.scope.length > 0 && !parsed.scope.includes("skills:read")) {
      throw new AuthorizationError("invalid_scope", { description: "Private read scope is required." });
    }
    const auth = { ...parsed, scope: parsed.scope.length ? parsed.scope : ["skills:read"] };
    const details = await oauth.describeConsent(auth), consent = await oauth.beginConsent(auth);
    const now = Math.floor(Date.now() / 1000);
    await requireAuthority(env, browser, "skills:read");
    await env.ACCOUNTS.batch([
      env.ACCOUNTS.prepare("DELETE FROM mcp_consents WHERE expires_at<=?").bind(now),
      env.ACCOUNTS.prepare(`INSERT INTO mcp_consents
        (handle_hash,account_id,auth_generation,session_id,scopes_json,expires_at)
        VALUES(?,?,?,?,?,?)`)
        .bind(await sha256(consent.handle), browser.accountId, browser.generation,
          browser.sessionId, JSON.stringify(auth.scope), now + 600),
    ]);
    return consentPage(details, consent.handle, consent.headers);
  }
  if (request.method !== "POST") throw new McpAuthError(405, "method_not_allowed");
  const form = new URLSearchParams(new TextDecoder().decode(await readBody(request, 8192)));
  if ([...form.keys()].some(key => form.getAll(key).length !== 1)) {
    throw new McpAuthError(400, "invalid_request");
  }
  const handle = form.get("handle");
  if (handle === null || handle.length > 2048) throw new McpAuthError(400, "invalid_consent");
  const hash = await sha256(handle), now = Math.floor(Date.now() / 1000);
  const saved = await env.ACCOUNTS.prepare(`SELECT scopes_json FROM mcp_consents
    WHERE handle_hash=? AND account_id=? AND auth_generation=? AND session_id=? AND expires_at>?`)
    .bind(hash, browser.accountId, browser.generation, browser.sessionId, now).first();
  if (saved === null) throw new McpAuthError(400, "invalid_consent");
  const scopesJson = z.object({ scopes_json: z.string() }).parse(saved).scopes_json;
  const requested = z.array(mcpScopeSchema).parse(JSON.parse(scopesJson));
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    await env.ACCOUNTS.prepare("DELETE FROM mcp_consents WHERE handle_hash=?").bind(hash).run();
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const recordActivity = form.get("recordActivity") === "yes";
  const scope = ["skills:read", ...(requested.includes("offline_access") ? ["offline_access"] : []),
    ...(recordActivity ? ["activity:record"] : [])];
  const approved = await oauth.approveConsent(request, handle, { scope });
  const consumed = await env.ACCOUNTS.prepare(`DELETE FROM mcp_consents
    WHERE handle_hash=? AND account_id=? AND auth_generation=? AND session_id=? AND expires_at>?`)
    .bind(hash, browser.accountId, browser.generation, browser.sessionId, now).run();
  if (consumed.meta.changes === 0) throw new McpAuthError(400, "invalid_consent");
  const details = await oauth.describeConsent(approved.request);
  const connection = await createConnection(env, browser, {
    kind: "oauth", name: details.clientName.slice(0, 200), clientId: approved.request.clientId,
    recordActivity, scopes: z.array(mcpScopeSchema).parse(scope),
  });
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request, userId: browser.accountId,
    metadata: { connectionId: connection.connectionId },
    scope, props: {
      connectionId: connection.connectionId, accountId: browser.accountId, generation: browser.generation,
    },
    revokeExistingGrants: false,
  });
  await requireAuthority(env, browser, "skills:read");
  approved.headers.set("location", redirectTo);
  for (const [key, value] of Object.entries(mcpNoStore)) approved.headers.set(key, value);
  return new Response(null, { status: 302, headers: approved.headers });
}
