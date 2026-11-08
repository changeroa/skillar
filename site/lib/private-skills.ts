import { z } from "zod";
import {
  PRIVATE_SKILL_MAX_REQUEST_BYTES, PRIVATE_SKILL_SERVICE_PREFIX,
  privateSkillCatalogSchema, privateSkillDetailSchema, privateSkillExportSchema,
  privateSkillPrincipalSchema, privateSkillReadSchema, privateSkillSearchResultSchema,
  privateSkillIdentitySchema,
} from "../../shared/dist/private-skills.js";
import type { PrivateSkillPrincipal } from "../../shared/dist/private-skills.js";
import { pkceChallenge } from "./auth.ts";
import {
  activityConfig, activityError, browserPrincipal, noStore, validActivityOrigin,
} from "./activity-auth.ts";
import type { ActivityEnv } from "./activity-auth.ts";
import { readDevicePrincipal } from "./device-auth.ts";
import { ActivityRequestError, readBody } from "./activity-body.ts";

const errorSchema = z.strictObject({ error: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/) });
const deletedSchema = z.strictObject({ deleted: z.literal(true) });
type Authority =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "insufficient_scope" }
  | { readonly kind: "authorized"; readonly principal: PrivateSkillPrincipal };

async function authority(
  request: Request, env: ActivityEnv, device: boolean, write: boolean,
): Promise<Authority> {
  if (!device) {
    const principal = await browserPrincipal(request, env);
    return principal === null ? { kind: "unauthorized" } : {
      kind: "authorized", principal: privateSkillPrincipalSchema.parse({
        ...principal, tokenHash: null, scopes: ["skills:read", "skills:write"],
      }),
    };
  }
  const principal = await readDevicePrincipal(request, env);
  if (principal === null) return { kind: "unauthorized" };
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (token === undefined) return { kind: "unauthorized" };
  const scopes = principal.scopes.filter(scope => scope === "skills:read" || scope === "skills:write");
  if (!scopes.includes(write ? "skills:write" : "skills:read")) return { kind: "insufficient_scope" };
  return { kind: "authorized", principal: privateSkillPrincipalSchema.parse({
    ...principal, scopes, tokenHash: await pkceChallenge(token),
  }) };
}

function releasedSchema(method: string, suffix: string): z.ZodType {
  if (suffix === "" && method === "GET") return privateSkillCatalogSchema;
  if (suffix === "/identity" && method === "GET") return privateSkillIdentitySchema;
  if (suffix === "/search") return privateSkillSearchResultSchema;
  if (suffix === "/resources/read") return privateSkillReadSchema;
  if (/^\/[^/]+\/versions\/[^/]+$/.test(suffix) && method === "GET") return privateSkillExportSchema;
  if (/^\/[^/]+$/.test(suffix) && method === "DELETE") return deletedSchema;
  return privateSkillDetailSchema;
}

/** The public boundary replaces credentials and buffers before a live authority recheck. */
export async function privateSkillPagesRequest(request: Request, env: ActivityEnv): Promise<Response> {
  if (env.PRIVATE_SKILLS_ENABLED !== "true") return activityError(404, "not_found");
  const config = activityConfig(request, env);
  if (config === null) return activityError(403, "invalid_host");
  if (!validActivityOrigin(request)) return activityError(403, "invalid_origin");
  if (env.ACTIVITY_SERVICE === undefined) return activityError(503, "private_skills_unavailable");
  const url = new URL(request.url);
  if (url.search !== "" || !["GET", "POST", "DELETE"].includes(request.method)) {
    return activityError(400, "invalid_request");
  }
  if (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity") {
    return activityError(415, "unsupported_encoding");
  }
  const device = url.pathname.startsWith("/v1/");
  const prefix = device ? "/v1/skills" : "/api/skills";
  const suffix = url.pathname.slice(prefix.length).replace(/\/$/, "");
  const readOnly = request.method === "GET" ||
    (request.method === "POST" && (suffix === "/search" || suffix === "/resources/read"));
  const authorized = await authority(request, env, device, !readOnly);
  let principal: PrivateSkillPrincipal;
  switch (authorized.kind) {
    case "unauthorized": return activityError(401, "unauthorized");
    case "insufficient_scope": return activityError(403, "insufficient_scope");
    case "authorized": principal = authorized.principal; break;
    default: {
      const exhaustive: never = authorized;
      return exhaustive;
    }
  }
  let body: string | undefined;
  if (request.method !== "GET") {
    try { body = JSON.stringify(await readBody(request, PRIVATE_SKILL_MAX_REQUEST_BYTES)); }
    catch (error) {
      if (error instanceof ActivityRequestError) {
        return activityError(error.message === "body_too_large" ? 413 : 400, "invalid_request");
      }
      throw error;
    }
  }
  const response = await env.ACTIVITY_SERVICE.fetch(new Request(
    `https://activity.internal${PRIVATE_SKILL_SERVICE_PREFIX}${suffix}`, {
      method: request.method, signal: request.signal,
      headers: { "content-type": "application/json", "x-skillar-principal": JSON.stringify(principal) },
      ...(body === undefined ? {} : { body }),
    },
  ));
  let value: unknown;
  try { value = await response.json(); }
  catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return activityError(503, "private_skills_unavailable");
    throw error;
  }
  const rechecked = await authority(request, env, device, !readOnly);
  let current: PrivateSkillPrincipal;
  switch (rechecked.kind) {
    case "unauthorized":
    case "insufficient_scope": return activityError(401, "unauthorized");
    case "authorized": current = rechecked.principal; break;
    default: {
      const exhaustive: never = rechecked;
      return exhaustive;
    }
  }
  if (current.accountId !== principal.accountId ||
      current.generation !== principal.generation || current.kind !== principal.kind ||
      current.sessionId !== principal.sessionId || current.deviceId !== principal.deviceId ||
      current.tokenHash !== principal.tokenHash) {
    return activityError(401, "unauthorized");
  }
  if (!response.ok) {
    const parsed = errorSchema.safeParse(value);
    return activityError(response.status, parsed.success ? parsed.data.error : "private_skills_unavailable");
  }
  const parsed = releasedSchema(request.method, suffix).safeParse(value);
  return parsed.success ? Response.json(parsed.data, { status: response.status, headers: noStore }) :
    activityError(503, "private_skills_unavailable");
}
