import { z } from "zod";
import {
  PRIVATE_PACK_SERVICE_PREFIX, privatePackCreateSchema, privatePackUpdateSchema,
  privatePackStatusSchema, privatePackSearchSchema, privatePackLoadSchema,
  privatePackReceiptSchema, privatePackSearchResultSchema, privatePackLoadResultSchema,
} from "../../shared/dist/private-packs.js";
import { privateSkillPrincipalSchema } from "../../shared/dist/private-skills.js";
import type { PrivateSkillPrincipal } from "../../shared/dist/private-skills.js";
import { pkceChallenge } from "./auth.ts";
import { activityConfig, activityError, browserPrincipal, noStore, validActivityOrigin } from "./activity-auth.ts";
import type { ActivityEnv } from "./activity-auth.ts";
import { readDevicePrincipal } from "./device-auth.ts";
import { readBody } from "./activity-body.ts";

const operationSchema = z.enum(["create", "update", "status", "search", "load"]);
const errorSchema = z.strictObject({ error: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/) });
const operations = {
  create: { input: privatePackCreateSchema, output: privatePackReceiptSchema, write: true },
  update: { input: privatePackUpdateSchema, output: privatePackReceiptSchema, write: true },
  status: { input: privatePackStatusSchema, output: privatePackReceiptSchema, write: false },
  search: { input: privatePackSearchSchema, output: privatePackSearchResultSchema, write: false },
  load: { input: privatePackLoadSchema, output: privatePackLoadResultSchema, write: false },
} as const;

async function authority(
  request: Request, env: ActivityEnv, device: boolean, write: boolean,
): Promise<PrivateSkillPrincipal | Response> {
  if (!device) {
    const principal = await browserPrincipal(request, env);
    return principal === null ? activityError(401, "unauthorized") : privateSkillPrincipalSchema.parse({
      ...principal, tokenHash: null, scopes: ["skills:read", "skills:write"],
    });
  }
  const principal = await readDevicePrincipal(request, env);
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (principal === null || token === undefined) return activityError(401, "unauthorized");
  if (!principal.scopes.includes(write ? "skills:write" : "skills:read")) {
    return activityError(403, "insufficient_scope");
  }
  return privateSkillPrincipalSchema.parse({
    ...principal, tokenHash: await pkceChallenge(token),
    scopes: principal.scopes.filter(scope => scope === "skills:read" || scope === "skills:write"),
  });
}

/** Pack writes are separate from skill uploads and public Git-backed publication. */
export async function privatePackPagesRequest(request: Request, env: ActivityEnv): Promise<Response> {
  if (env.PRIVATE_SKILLS_ENABLED !== "true") return activityError(404, "not_found");
  if (activityConfig(request, env) === null) return activityError(403, "invalid_host");
  if (!validActivityOrigin(request)) return activityError(403, "invalid_origin");
  if (env.ACTIVITY_SERVICE === undefined) return activityError(503, "private_packs_unavailable");
  const url = new URL(request.url);
  const device = url.pathname.startsWith("/v1/");
  const prefix = device ? "/v1/packs/" : "/api/packs/";
  const parsed = operationSchema.safeParse(url.pathname.slice(prefix.length));
  if (!url.pathname.startsWith(prefix) || !parsed.success || url.search !== "" || request.method !== "POST") {
    return activityError(404, "not_found");
  }
  if (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity") {
    return activityError(415, "unsupported_encoding");
  }
  const operation = operations[parsed.data];
  const principal = await authority(request, env, device, operation.write);
  if (principal instanceof Response) return principal;
  const input = operation.input.parse(await readBody(request, 256 * 1024));
  const response = await env.ACTIVITY_SERVICE.fetch(new Request(
    `https://activity.internal${PRIVATE_PACK_SERVICE_PREFIX}/${parsed.data}`, {
      method: "POST", signal: request.signal,
      headers: { "content-type": "application/json", "x-skillar-principal": JSON.stringify(principal) },
      body: JSON.stringify(input),
    },
  ));
  const value: unknown = await response.json();
  const current = await authority(request, env, device, operation.write);
  if (current instanceof Response || current.kind !== principal.kind || current.accountId !== principal.accountId ||
      current.generation !== principal.generation || current.sessionId !== principal.sessionId ||
      current.deviceId !== principal.deviceId || current.tokenHash !== principal.tokenHash) {
    return activityError(401, "unauthorized");
  }
  if (!response.ok) {
    const receipt = privatePackReceiptSchema.safeParse(value);
    if (operation.write && receipt.success && receipt.data.status === "failed") {
      return Response.json(receipt.data, { status: response.status, headers: noStore });
    }
    const error = errorSchema.safeParse(value);
    return activityError(response.status, error.success ? error.data.error : "private_packs_unavailable");
  }
  return Response.json(operation.output.parse(value), { status: response.status, headers: noStore });
}
