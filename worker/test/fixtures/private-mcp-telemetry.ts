import { z } from "zod";
import { ReportFlow } from "../../src/activity/report-flow.ts";
import type { ReportEnv } from "../../src/activity/report-types.ts";
import { activityContentRequest } from "../../src/activity/content-api.ts";
import { mcpContextSchema } from "../../../shared/mcp-auth.ts";
import { mcpSourceStatements, recordMcpRead, recordMcpSearch } from "../../src/private-mcp/telemetry.ts";

interface Env extends ReportEnv { readonly TEST_REPORT_URL: string }
const context = mcpContextSchema.parse({
  principal: { kind: "mcp", accountId: "account-a", deviceId: "device-a", generation: 1,
    shardId: "activity-00", issuer: "https://skillar.sh", scopes: ["skills:read"],
    sessionId: null, tokenHash: "a".repeat(64), connectionId: "11111111-1111-4111-8111-111111111111" },
  recordActivity: true, clientName: "Synthetic MCP client",
});
const fenceSchema = z.enum(["connection", "device", "account", "generation", "consent", "scope", "record", "credential"]);
type Fence = z.infer<typeof fenceSchema>;
async function fence(env: Env, target: Fence) {
  const statements = {
    connection: "UPDATE mcp_connections SET revoked_at=1",
    device: "UPDATE devices SET revoked_at=1",
    account: "UPDATE accounts SET state='revoked'",
    generation: "UPDATE accounts SET auth_generation=2",
    consent: `UPDATE device_consents SET consent_json='{"mode":"local-only"}'`,
    scope: `UPDATE mcp_connections SET scopes_json='["skills:read"]'`,
    record: "UPDATE mcp_connections SET record_activity=0",
    credential: "UPDATE mcp_credentials SET revoked_at=1",
  };
  await env.ACCOUNTS.prepare(statements[target]).run();
}
const readSchema = z.object({ uri: z.string(), skillUri: z.string(), path: z.string(),
  bytes: z.number(), manifestDigest: z.string(), traceId: z.string().optional() });
const searchSchema = z.object({ query: z.string(), traceId: z.string(),
  mode: z.enum(["discovery", "automatic", "explicit"]),
  candidates: z.array(z.object({ uri: z.string(), name: z.string(), description: z.string(),
    score: z.number(), rank: z.number(), invocation: z.enum(["automatic", "explicit"]),
    digest: z.string(), matched: z.array(z.string()) })),
  elapsedMs: z.number(), total: z.number() });
export class TestReportFlow extends ReportFlow {
  override async run(event: Parameters<ReportFlow["run"]>[0], step: Parameters<ReportFlow["run"]>[1]) {
    const value = await super.run(event, step);
    const env = this.env;
    if ("TEST_REPORT_URL" in env && typeof env.TEST_REPORT_URL === "string") {
      await fetch(env.TEST_REPORT_URL, { method: "POST", body: JSON.stringify(value) });
    }
    return value;
  }
}
export default {
  async fetch(request: Request, bindings: Env) {
    const env = { ...bindings, ACTIVITY_INGEST_ENABLED: "true" };
    const path = new URL(request.url).pathname;
    if (path.startsWith("/v1/")) return activityContentRequest(request, env);
    const input = z.object({ context: mcpContextSchema.default(context),
      recordActivity: z.boolean().default(true), fence: fenceSchema.optional(),
      connectionKind: z.enum(["pat", "oauth"]).default("pat"),
      boundary: z.enum(["put", "get"]).default("put"), at: z.number().int().positive().default(1),
      observation: z.unknown().optional() })
      .parse(await request.json());
    try {
      if (path === "/setup") {
        const p = input.context.principal;
        const scopes = JSON.stringify(input.recordActivity ? ["skills:read", "activity:record"] : ["skills:read"]);
        const now = Math.floor(Date.now() / 1000);
        await env.ACCOUNTS.batch([
          ...mcpSourceStatements(env.ACCOUNTS, { accountId: p.accountId, deviceId: p.deviceId,
            recordActivity: input.recordActivity, now: Date.now() - 1000 }),
          env.ACCOUNTS.prepare(`INSERT INTO mcp_connections
            (connection_id,account_id,auth_generation,device_id,kind,name,client_id,token_hash,
              scopes_json,record_activity,created_at,expires_at)
            VALUES (?,?,1,?,?,'synthetic',?,?,?,?,?,?)`)
            .bind(p.connectionId, p.accountId, p.deviceId, input.connectionKind,
              input.connectionKind === "oauth" ? "synthetic-client" : null,
              input.connectionKind === "pat" ? p.tokenHash : null,
              scopes, Number(input.recordActivity), now, now + 3600),
          ...(input.connectionKind === "oauth" ? [
            env.ACCOUNTS.prepare(`INSERT INTO mcp_credentials
              (token_hash,connection_id,kind,scopes_json,created_at,expires_at,revoked_at)
              VALUES (?,?,'access',?,?,?,NULL)`)
              .bind(p.tokenHash, p.connectionId, scopes, now, now + 3600),
          ] : []),
        ]);
        return Response.json({ ready: true });
      }
      if (input.fence !== undefined) {
        const targetFence = input.fence, bucket = env.ACTIVITY_RAW;
        let calls = 0;
        env.ACTIVITY_RAW = new Proxy(bucket, {
          get(target, key) {
            const value = Reflect.get(target, key, target);
            if (key === input.boundary) return async (...args: unknown[]) => {
              const result = await value.apply(target, args);
              calls++;
              if (calls === input.at) await fence(env, targetFence);
              return result;
            };
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      }
      const saved = path === "/search"
        ? await recordMcpSearch(env, input.context, searchSchema.parse(input.observation))
        : await recordMcpRead(env, input.context, readSchema.parse(input.observation));
      return Response.json({ saved });
    } catch (error) {
      if (error instanceof Error) return Response.json({ error: error.message }, { status: 403 });
      throw error;
    }
  },
};
