// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { mcpContextSchema } from "../../../shared/mcp-auth.ts";
import type { PrivateSkillPrincipal } from "../../../shared/private-skills.ts";
import { privateSkillSearchResultSchema } from "../../../shared/private-skills.ts";
import type { PrivateSkillsEnv } from "../private-skills/contracts.ts";
import { PrivateSkillError, privateHeaders } from "../private-skills/contracts.ts";
import { requestPrincipal, requireAuthority } from "../private-skills/authority.ts";
import { privateFailure, privateJson } from "../private-skills/http.ts";
import { recordMcpRead, recordMcpSearch } from "./telemetry.ts";

export const mcpObservationPath = "/v1/private-mcp/observations";
const observationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("search"), context: mcpContextSchema,
    observation: privateSkillSearchResultSchema.unwrap().extend({
      total: z.number().int().nonnegative().safe(),
    }),
  }),
  z.strictObject({
    kind: z.literal("read"), context: mcpContextSchema,
    observation: z.strictObject({
      uri: z.string().max(8192), skillUri: z.string().max(8192), path: z.string().max(512),
      bytes: z.number().int().nonnegative(), manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
      traceId: z.string().max(128).optional(),
    }),
  }),
]);

/** Only this account's existing catalog actor serializes observation stream cuts. */
export async function privateMcpObservationRequest(
  request: Request, env: PrivateSkillsEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== mcpObservationPath) return null;
  try {
    const principal = requestPrincipal(request, env);
    if (env.PRIVATE_SKILLS_ENABLED !== "true" || env.ACTIVITY_INGEST_ENABLED !== "true" ||
        env.PRIVATE_SKILL_CATALOG === undefined) throw new PrivateSkillError(404, "not_found");
    if (principal.kind !== "mcp") throw new PrivateSkillError(403, "forbidden");
    await requireAuthority(env, principal, "skills:read");
    return await env.PRIVATE_SKILL_CATALOG.get(
      env.PRIVATE_SKILL_CATALOG.idFromName(principal.accountId),
    ).fetch(request);
  } catch (error) { return privateFailure(error); }
}

export async function recordMcpObservation(
  request: Request, env: PrivateSkillsEnv, principal: PrivateSkillPrincipal,
): Promise<Response> {
  if (request.method !== "POST" || new URL(request.url).search !== "") {
    throw new PrivateSkillError(405, "method_not_allowed");
  }
  if (principal.kind !== "mcp" || env.ACTIVITY_INGEST_ENABLED !== "true" ||
      env.CONTENT_KEYRING === undefined) throw new PrivateSkillError(403, "forbidden");
  const input = observationSchema.parse(await privateJson(request));
  if (JSON.stringify(input.context.principal) !== JSON.stringify(principal)) {
    throw new PrivateSkillError(403, "forbidden");
  }
  const contentEnv = { ...env, CONTENT_KEYRING: env.CONTENT_KEYRING };
  let recorded: boolean;
  switch (input.kind) {
    case "search":
      recorded = await recordMcpSearch(contentEnv, input.context, {
        ...input.observation, candidates: input.observation.candidates.map(candidate => ({
          ...candidate, matched: [...candidate.matched],
        })),
      });
      break;
    case "read":
      recorded = await recordMcpRead(contentEnv, input.context, input.observation);
      break;
    default: {
      const exhaustive: never = input;
      return exhaustive;
    }
  }
  return Response.json({ recorded }, { headers: privateHeaders });
}
