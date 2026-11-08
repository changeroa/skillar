// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import type { ReportEnv } from "../../src/activity/report-types.ts";
import { activityContentRequest } from "../../src/activity/content-api.ts";
import { mcpPagesBoundary } from "../../../site/lib/mcp.ts";
import type { McpPagesEnv } from "../../../site/lib/mcp.ts";
import { signCookie } from "../../../site/lib/auth.ts";
import { onRequest as authRequest } from "../../../site/functions/auth/[[path]].ts";
import { onRequest as apiRequest } from "../../../site/functions/api/[[path]].ts";
import resourceServer from "../../src/private-mcp/resource-server.ts";
import type { McpResourceEnv } from "../../src/private-mcp/contracts.ts";
export { PrivateSkillCatalog } from "../../src/private-skills/index.ts";
export { AccountHub } from "../../src/activity/account-hub.ts";

type Env = ReportEnv & McpPagesEnv & McpResourceEnv & { readonly RESOURCE: Fetcher };
const envelope = z.strictObject({
  target: z.enum(["resource", "activity", "pages", "session", "web", "cancel"]), url: z.url(), method: z.string().default("POST"),
  headers: z.record(z.string(), z.string()).default({}), body: z.string().optional(),
});
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname !== "/__test/forward") return activityContentRequest(request, env);
    // Test-only canonical URL bridge; it is not an authentication shortcut in the resource Worker.
    const input = envelope.parse(await request.json());
    if (input.target === "cancel") {
      const probe = z.strictObject({ token: z.string(), uri: z.string() }).parse(JSON.parse(input.body ?? "{}"));
      const entered = Promise.withResolvers<void>();
      const aborted = Promise.withResolvers<boolean>();
      const controller = new AbortController();
      const bounded = AbortSignal.timeout(10_000);
      const backend = new Proxy(env.ACTIVITY_SERVICE, { get(target, key) {
        if (key === "fetch") return async (current: Request) => {
          // Subscribe before signaling entry: cancellation must interrupt real SDK work.
          return new Promise<Response>((_resolve, reject) => {
            const stop = () => { aborted.resolve(current.signal.aborted); reject(current.signal.reason); };
            if (current.signal.aborted) stop();
            else current.signal.addEventListener("abort", stop, { once: true });
            bounded.addEventListener("abort", () => reject(bounded.reason), { once: true });
            entered.resolve();
          });
        };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const current = new Request(`${env.PUBLIC_ORIGIN}/mcp`, {
        method: "POST", signal: controller.signal,
        headers: { host: new URL(env.PUBLIC_ORIGIN).host, authorization: `Bearer ${probe.token}`,
          "content-type": "application/json", accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "resources/read", "Mcp-Name": probe.uri },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: {
          uri: probe.uri, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "Cancellation probe", version: "1" },
            "io.modelcontextprotocol/clientCapabilities": {} },
        } }),
      });
      const operation = resourceServer.fetch(current, { ...env, ACTIVITY_SERVICE: backend }, ctx)
        .then(response => { void response.body?.cancel(); return response.status; }, () => null);
      const timeout = new Promise<never>((_resolve, reject) =>
        bounded.addEventListener("abort", () => reject(bounded.reason), { once: true }));
      await Promise.race([entered.promise, operation.then(() => { throw new Error("SDK never entered resource read"); }), timeout]);
      controller.abort(new DOMException("Synthetic client cancelled", "AbortError"));
      const backendAborted = await Promise.race([aborted.promise, timeout]);
      await Promise.race([operation, timeout]);
      return Response.json({ backendAborted });
    }
    if (input.target === "session") {
      return Response.json({ cookie: `__Host-skillar_session=${await signCookie({
        sub: "google-a", sid: "a".repeat(32),
      }, "session", env, Math.floor(Date.now() / 1000))}` });
    }
    const forwarded = new Request(input.url, {
      method: input.method, headers: { host: new URL(input.url).host, ...input.headers },
      ...(input.body === undefined ? {} : { body: input.body }),
    });
    switch (input.target) {
      case "web": {
        const path = new URL(forwarded.url).pathname;
        // This synthesized inbound request has no optional CF edge metadata.
        const incoming = (value: Request): value is Request<unknown, IncomingRequestCfProperties> =>
          value.cf === undefined;
        if (!incoming(forwarded)) throw new Error("Unexpected fixture edge metadata");
        const pageContext = {
          request: forwarded,
          env: { ...env, ASSETS: { async fetch(): Promise<Response> {
            throw new Error("API contract fixture does not serve Pages assets");
          } } },
          params: {}, data: {}, functionPath: path,
          waitUntil: ctx.waitUntil.bind(ctx),
          passThroughOnException: ctx.passThroughOnException.bind(ctx),
          next: () => Promise.reject(new Error("Unexpected Pages middleware continuation")),
        };
        if (path.startsWith("/api/")) {
          return apiRequest(pageContext);
        }
        if (path.startsWith("/auth/")) {
          return authRequest(pageContext);
        }
        return mcpPagesBoundary(forwarded, env);
      }
      case "pages": return mcpPagesBoundary(forwarded, env);
      case "resource": return env.RESOURCE.fetch(forwarded);
      case "activity": return activityContentRequest(forwarded, env);
      default: {
        const exhaustive: never = input.target;
        return exhaustive;
      }
    }
  },
};
