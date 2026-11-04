// SPDX-License-Identifier: AGPL-3.0-only
import { OAuthResourceServer, insufficientScope } from "@cloudflare/workers-oauth-provider-v1";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { mcpContextSchema } from "../../../shared/mcp-auth.ts";
import type { McpContext } from "../../../shared/mcp-auth.ts";
import { createPrivateMcpServer } from "./handler.ts";
import { mcpNoStore } from "./contracts.ts";
import type { McpResourceEnv } from "./contracts.ts";

export default {
  async fetch(request: Request, env: McpResourceEnv, ctx: ExecutionContext): Promise<Response> {
    if (env.MCP_ENABLED !== "true") {
      return Response.json({ error: "not_found" }, { status: 404, headers: mcpNoStore });
    }
    const url = new URL(request.url);
    if (url.origin !== env.PUBLIC_ORIGIN ||
        (request.headers.has("origin") && request.headers.get("origin") !== env.PUBLIC_ORIGIN)) {
      return Response.json({ error: "invalid_origin" }, { status: 403, headers: mcpNoStore });
    }
    if (!["/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]
      .includes(url.pathname)) {
      return Response.json({ error: "not_found" }, { status: 404, headers: mcpNoStore });
    }
    // Tokens and tenant selectors are never accepted in query strings.
    if (url.search !== "") {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: mcpNoStore });
    }
    const resource = new OAuthResourceServer<McpResourceEnv, McpContext>({
      resourceMetadata: {
        resource: `${env.PUBLIC_ORIGIN}/mcp`, authorization_servers: [env.PUBLIC_ORIGIN],
        bearer_methods_supported: ["header"], resource_name: "Skillar private skills",
      },
      requiredScopes: ["skills:read"],
      validateToken: current => (audience, token) => current.MCP_AUTH.validateToken(audience, token),
      handler: {
        async fetch(authorizedRequest, current, authorized) {
          if (!authorized.auth.scope.includes("skills:read")) {
            return insufficientScope(authorized.auth, ["skills:read"]);
          }
          const context = mcpContextSchema.parse(authorized.props);
          const handler = createMcpHandler(() => {
            const verified = mcpContextSchema.parse(getMcpAuthContext()?.props);
            return createPrivateMcpServer(current, verified);
          }, {
            route: "/mcp", allowedHostnames: [new URL(current.PUBLIC_ORIGIN).hostname],
            allowedOriginHostnames: [new URL(current.PUBLIC_ORIGIN).hostname],
            corsOptions: false, keepAliveMs: 0, authContext: { props: context },
          });
          return handler.fetch(authorizedRequest);
        },
      },
    });
    const response = await resource.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(mcpNoStore)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};
