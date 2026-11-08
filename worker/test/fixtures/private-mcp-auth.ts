// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import type McpAuthorizationServer from "../../src/private-mcp/authorization-server.ts";
import type { McpAuthEnv } from "../../src/private-mcp/contracts.ts";
import { createAuthorizationServer } from "../../src/private-mcp/oauth-protocol.ts";
import { requireAuthority } from "../../src/private-skills/authority.ts";
import { PrivateSkillError } from "../../src/private-skills/contracts.ts";
import { privateSkillPrincipalSchema } from "../../../shared/private-skills.ts";

interface Env extends McpAuthEnv {
  readonly AUTH: Service<McpAuthorizationServer>;
}

const envelope = z.object({
  operation: z.enum(["public", "authorize", "manage", "validate", "nativeValidate", "authority"]),
  url: z.url(),
  method: z.string().default("GET"),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional(),
  principal: z.unknown().optional(),
  token: z.string().default(""),
  resource: z.string().default("https://skillar.sh/mcp"),
});

// This is a private test driver, not a public authentication adapter. The outer
// HTTP bridge carries an envelope so workerd receives the canonical URL/Origin,
// not Miniflare's loopback URL. Identity is a separate RPC argument, never a
// principal extracted from the canonical request's headers, body or cookies.
export default {
  async fetch(outer: Request, env: Env): Promise<Response> {
    const input = envelope.parse(await outer.json());
    const request = new Request(input.url, {
      method: input.method, headers: input.headers,
      ...(input.body === undefined ? {} : { body: input.body }),
    });
    switch (input.operation) {
      case "public": return env.AUTH.fetch(request);
      case "authorize": return env.AUTH.authorize(request, input.principal);
      case "manage": return env.AUTH.manage(request, input.principal);
      case "validate": return Response.json(await env.AUTH.validateToken(input.resource, input.token));
      case "nativeValidate":
        return Response.json(await createAuthorizationServer(env).validateToken(input.resource, input.token, env));
      case "authority":
        try {
          await requireAuthority(env, privateSkillPrincipalSchema.parse(input.principal), "skills:read");
          return Response.json({ allowed: true });
        } catch (error) {
          if (error instanceof PrivateSkillError) {
            return Response.json({ error: error.code }, { status: error.status });
          }
          throw error;
        }
      default: {
        const exhaustive: never = input.operation;
        return exhaustive;
      }
    }
  },
};
