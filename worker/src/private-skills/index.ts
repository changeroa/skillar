// SPDX-License-Identifier: AGPL-3.0-only
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  PRIVATE_SKILL_SERVICE_PREFIX, PRIVATE_SKILL_MAX_URI_LENGTH, privateSkillIdSchema, privateSkillDigestSchema,
} from "../../../shared/private-skills.ts";
import { requestPrincipal, requireAuthority } from "./authority.ts";
import { PrivateSkillError, privateHeaders } from "./contracts.ts";
import type { CatalogEnv } from "./contracts.ts";
import { privateFailure, privateJson } from "./http.ts";
import { PrivateSkillStore } from "./store.ts";
import { publish, changeHead, pinVersion } from "./mutations.ts";
import { deleteSkill, deleteVersion } from "./deletion.ts";
import { exportVersion, readResource } from "./objects.ts";
import { createPrivateSkillSearch } from "./search-index.ts";
import type { PrivateSkillSearch } from "./search-index.ts";
import { admitPrivateSkill } from "./rate-limit.ts";
import { mcpCatalog } from "./mcp.ts";
import { mcpSearchSchema } from "../private-mcp/catalog-contracts.ts";
import { mcpObservationPath, recordMcpObservation } from "../private-mcp/telemetry-api.ts";
import { dispatchAccountControls } from "../activity/event-controls.ts";
export { privateSkillsRequest } from "./api.ts";

const searchSchema = z.strictObject({
  query: z.string().max(4096), mode: z.enum(["discovery", "automatic", "explicit"]),
  limit: z.number().int().min(1).max(50),
}).readonly();
const resourceSchema = z.strictObject({ uri: z.string().min(1).max(PRIVATE_SKILL_MAX_URI_LENGTH) }).readonly();
const prefix = PRIVATE_SKILL_SERVICE_PREFIX;
const handles = (path: string) => path === prefix || path.startsWith(`${prefix}/`);

/** One actor per account, across generations, serializes the complete async operation. */
export class PrivateSkillCatalog extends DurableObject<CatalogEnv> {
  private readonly search: PrivateSkillSearch;
  private projection: string | null = null;
  constructor(ctx: DurableObjectState, env: CatalogEnv) {
    super(ctx, env);
    this.search = createPrivateSkillSearch(ctx.storage);
  }
  fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await this.dispatch(request); }
      catch (error) { return privateFailure(error); }
    });
  }
  private async dispatch(request: Request): Promise<Response> {
    if (this.env.PRIVATE_SKILLS_ENABLED !== "true") throw new PrivateSkillError(404, "not_found");
    const principal = requestPrincipal(request, this.env), url = new URL(request.url);
    const observation = url.pathname === mcpObservationPath;
    if (!handles(url.pathname) && !observation) throw new PrivateSkillError(404, "not_found");
    if (!this.env.PRIVATE_SKILL_CATALOG.idFromName(principal.accountId).equals(this.ctx.id)) {
      throw new PrivateSkillError(403, "wrong_account");
    }
    if (url.search) throw new PrivateSkillError(400, "invalid_request");
    if (observation) {
      await requireAuthority(this.env, principal, "skills:read");
      admitPrivateSkill(this.ctx.storage, principal, "read");
      const response = await recordMcpObservation(request, this.env, principal);
      await requireAuthority(this.env, principal, "skills:read");
      return response;
    }
    const path = url.pathname.slice(prefix.length), method = request.method;
    const mcpSearch = path === "/mcp/search" && method === "POST";
    const search = (path === "/search" && method === "POST") || mcpSearch;
    const resource = path === "/resources/read" && method === "POST";
    const read = method === "GET" || search || resource;
    const store = new PrivateSkillStore(this.env, principal, read ? "skills:read" : "skills:write");
    await store.live();
    admitPrivateSkill(this.ctx.storage, principal, search ? "search" : read ? "read" : "write");
    let output: unknown;
    let deleted = false;
    if (path === "/identity" && method === "GET") output = {
      accountId: principal.accountId, generation: principal.generation,
      deviceId: principal.deviceId, scopes: principal.scopes,
    };
    else if ((path === "" || path === "/") && method === "GET") output = await store.catalog();
    else if (path === "/mcp/catalog" && method === "GET") output = await mcpCatalog(store);
    else if (search) {
      const body = await privateJson(request);
      const value = mcpSearch ? mcpSearchSchema.parse(body) : searchSchema.parse(body);
      const catalog = await store.catalog();
      const revision = `${principal.generation}:${catalog.revision}`;
      if (this.projection !== revision) {
        this.search.rebuild(await store.projection());
        this.projection = revision;
      }
      output = "offset" in value
        ? this.search.page(value.query ?? "", value)
        : this.search.search(value.query, { mode: value.mode, limit: value.limit });
    } else if (resource) output = await readResource(store, resourceSchema.parse(await privateJson(request)).uri);
    else {
      const segments = path.split("/");
      const skillId = privateSkillIdSchema.parse(segments[1]);
      if (segments.length === 2 && method === "GET") output = await store.detail(skillId);
      else if (segments.length === 2 && method === "DELETE") {
        await deleteSkill(store, skillId, await privateJson(request)); deleted = true;
      } else if (segments.length === 3 && method === "POST") {
        const body = await privateJson(request);
        switch (segments[2]) {
          case "versions": output = await publish(store, skillId, body); break;
          case "head": output = await changeHead(store, skillId, body); break;
          case "pins": output = await pinVersion(store, skillId, body); break;
          default: throw new PrivateSkillError(404, "not_found");
        }
      } else if (segments.length === 4 && segments[2] === "versions") {
        const digest = privateSkillDigestSchema.parse(segments[3]);
        if (method === "GET") output = await exportVersion(store, skillId, digest);
        else if (method === "DELETE") output = await deleteVersion(store, { skillId, digest }, await privateJson(request));
        else throw new PrivateSkillError(405, "method_not_allowed");
      } else throw new PrivateSkillError(404, "not_found");
    }
    // The primary outbox survives a failed relay; a successful mutation never loses its event.
    if (!read) await dispatchAccountControls(this.env);
    // Revocation during R2 IO, projection work, or relay must never leak an output.
    await store.live();
    return Response.json(deleted ? { deleted: true } : output, { headers: privateHeaders });
  }
}
