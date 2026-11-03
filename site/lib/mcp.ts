import { z } from "zod";
import {
  mcpConnectionsSchema, mcpPatResponseSchema,
} from "../../shared/dist/mcp-auth.js";
import { privateSkillPrincipalSchema } from "../../shared/dist/private-skills.js";
import {
  activityConfig, activityError, browserPrincipal, noStore,
} from "./activity-auth.ts";
import type { ActivityEnv, BrowserPrincipal } from "./activity-auth.ts";
import { loginReturnPathSchema } from "./auth.ts";

interface AuthorizationBinding extends Fetcher {
  authorize(request: Request, principal: unknown): Promise<Response>;
  manage(request: Request, principal: unknown): Promise<Response>;
}
export interface McpPagesEnv extends ActivityEnv {
  readonly MCP_ENABLED?: string;
  readonly MCP_AUTH?: AuthorizationBinding;
  readonly MCP_RESOURCE?: Fetcher;
}
const revokedSchema = z.strictObject({ revoked: z.literal(true) });
const errorSchema = z.object({ error: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/) });

/** Browser credentials stop here; the AS receives only its own bound consent cookie. */
function forwardedRequest(request: Request, consent: boolean): Request {
  const headers = new Headers(request.headers);
  for (const name of ["x-skillar-principal", "x-skillar-account", "x-skillar-user"]) headers.delete(name);
  if (consent) {
    const cookies = headers.get("cookie")?.split(";").map(value => value.trim())
      .filter(value => value.startsWith("__Host-skillar-mcp-")).join("; ");
    headers.delete("authorization");
    headers.delete("cookie");
    if (cookies) headers.set("cookie", cookies);
  } else headers.delete("cookie");
  return new Request(request, { headers });
}
function principalForAuth(browser: BrowserPrincipal) {
  return privateSkillPrincipalSchema.parse({
    ...browser, scopes: ["skills:read"], tokenHash: null,
  });
}
async function sameBrowser(request: Request, env: McpPagesEnv, before: BrowserPrincipal): Promise<boolean> {
  const after = await browserPrincipal(request, env);
  return after !== null && after.accountId === before.accountId &&
    after.generation === before.generation && after.sessionId === before.sessionId;
}

export async function mcpPagesRequest(request: Request, env: McpPagesEnv): Promise<Response> {
  if (env.MCP_ENABLED !== "true") return activityError(404, "not_found");
  const config = activityConfig(request, env);
  if (config === null || new URL(request.url).origin !== env.PUBLIC_ORIGIN) {
    return activityError(421, "invalid_host");
  }
  if (env.MCP_AUTH === undefined || env.MCP_RESOURCE === undefined) {
    return activityError(503, "mcp_unavailable");
  }
  const url = new URL(request.url), path = url.pathname;
  if (path === "/oauth/authorize" || path === "/api/mcp/connections" ||
      path.startsWith("/api/mcp/connections/")) {
    if (request.method !== "GET" && request.headers.get("origin") !== config.PUBLIC_ORIGIN) {
      return activityError(403, "invalid_origin");
    }
    const browser = await browserPrincipal(request, env);
    if (browser === null) {
      if (path === "/oauth/authorize" && request.method === "GET") {
        const target = loginReturnPathSchema.safeParse(path + url.search);
        return target.success ? new Response(null, {
          status: 303, headers: {
            ...noStore, location: `/auth/google?returnTo=${encodeURIComponent(target.data)}`,
          },
        }) : activityError(400, "invalid_request");
      }
      return activityError(401, "unauthorized");
    }
    const response = path === "/oauth/authorize" ?
      await env.MCP_AUTH.authorize(forwardedRequest(request, true), principalForAuth(browser)) :
      await env.MCP_AUTH.manage(forwardedRequest(request, false), principalForAuth(browser));
    const bytes = await response.arrayBuffer();
    if (!await sameBrowser(request, env, browser)) return activityError(401, "unauthorized");
    if (path === "/oauth/authorize") {
      return new Response(bytes, { status: response.status, headers: response.headers });
    }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); }
    catch (error) {
      if (error instanceof SyntaxError) return activityError(503, "mcp_unavailable");
      throw error;
    }
    if (!response.ok) {
      const parsed = errorSchema.safeParse(value);
      return activityError(response.status, parsed.success ? parsed.data.error : "mcp_unavailable");
    }
    const schema = request.method === "GET" ? mcpConnectionsSchema :
      request.method === "POST" ? mcpPatResponseSchema : revokedSchema;
    const parsed = schema.safeParse(value);
    return parsed.success ? Response.json(parsed.data, { status: response.status, headers: noStore }) :
      activityError(503, "mcp_unavailable");
  }
  if (path === "/mcp" || path === "/.well-known/oauth-protected-resource" ||
      path === "/.well-known/oauth-protected-resource/mcp") {
    return env.MCP_RESOURCE.fetch(forwardedRequest(request, false));
  }
  if (["/.well-known/oauth-authorization-server", "/oauth/token", "/oauth/register"].includes(path)) {
    return env.MCP_AUTH.fetch(forwardedRequest(request, false));
  }
  return activityError(404, "not_found");
}

export async function mcpPagesBoundary(request: Request, env: McpPagesEnv): Promise<Response> {
  try { return await mcpPagesRequest(request, env); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error("skillar.mcp.bridge_unavailable", { name: error.name });
    return activityError(503, "mcp_unavailable");
  }
}
