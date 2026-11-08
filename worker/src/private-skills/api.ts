import { PRIVATE_SKILL_SERVICE_PREFIX } from "../../../shared/private-skills.ts";
import { requestPrincipal, requireAuthority } from "./authority.ts";
import { PrivateSkillError } from "./contracts.ts";
import type { PrivateSkillsEnv } from "./contracts.ts";
import { privateFailure } from "./http.ts";

/** HTTP gateway stays independent of the Durable Object class entrypoint. */
export async function privateSkillsRequest(request: Request, env: PrivateSkillsEnv): Promise<Response | null> {
  const prefix = PRIVATE_SKILL_SERVICE_PREFIX, path = new URL(request.url).pathname;
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return null;
  try {
    if (env.PRIVATE_SKILLS_ENABLED !== "true" || env.PRIVATE_SKILL_CATALOG === undefined) {
      throw new PrivateSkillError(404, "not_found");
    }
    const principal = requestPrincipal(request, env);
    const read = request.method === "GET" ||
      [`${prefix}/search`, `${prefix}/mcp/search`, `${prefix}/resources/read`].includes(path);
    await requireAuthority(env, principal, read ? "skills:read" : "skills:write");
    return await env.PRIVATE_SKILL_CATALOG.get(env.PRIVATE_SKILL_CATALOG.idFromName(principal.accountId)).fetch(request);
  } catch (error) { return privateFailure(error); }
}
