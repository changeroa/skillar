import { z } from "zod";
import {
  PRIVATE_PACK_SERVICE_PREFIX, privatePackCreateSchema, privatePackUpdateSchema,
  privatePackSearchSchema, privatePackLoadSchema, privatePackStatusSchema,
} from "../../../shared/private-packs.ts";
import { requestPrincipal } from "../private-skills/authority.ts";
import { privateHeaders, PrivateSkillError } from "../private-skills/contracts.ts";
import { privateJson } from "../private-skills/http.ts";
import { PrivateSkillContractError } from "../../../shared/private-skills.ts";
import type { ContentEnv } from "./content-env.ts";
import { ContentStorageError } from "./content-keys.ts";
import { ManagedCryptoError } from "./crypto.ts";
import { PrivatePackError, PrivatePackStore } from "./private-packs-store.ts";
import { packWriteStatus, writePrivatePack } from "./private-packs-write.ts";
import { searchPrivatePacks, loadPrivatePacks } from "./private-packs-read.ts";

/** Service-binding only. The public adapter replaces all identity headers. */
export async function privatePacksRequest(request: Request, env: ContentEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname, prefix = PRIVATE_PACK_SERVICE_PREFIX;
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return null;
  try {
    if (env.PRIVATE_SKILLS_ENABLED !== "true" || request.method !== "POST") {
      throw new PrivatePackError("not_found", 404);
    }
    const action = path.slice(prefix.length);
    if (!["/create", "/update", "/status", "/search", "/load"].includes(action)) {
      throw new PrivatePackError("not_found", 404);
    }
    const principal = requestPrincipal(request, env);
    const store = new PrivatePackStore(env, principal,
      action === "/create" || action === "/update" ? "skills:write" : "skills:read");
    await store.live();
    const input = await privateJson(request);
    switch (action) {
      case "/create":
      case "/update": {
        const value = action === "/create" ? privatePackCreateSchema.parse(input) : privatePackUpdateSchema.parse(input);
        const result = await writePrivatePack(store, value);
        return Response.json(result, {
          status: result.status === "failed" ? 409 : result.status === "accepted" ? 202 : 200,
          headers: privateHeaders,
        });
      }
      case "/status":
        return Response.json(await packWriteStatus(store, privatePackStatusSchema.parse(input).request_id), { headers: privateHeaders });
      case "/search":
        return Response.json(await searchPrivatePacks(store, privatePackSearchSchema.parse(input)), { headers: privateHeaders });
      case "/load":
        return Response.json(await loadPrivatePacks(store, privatePackLoadSchema.parse(input)), { headers: privateHeaders });
      default: throw new PrivatePackError("not_found", 404);
    }
  } catch (error) {
    if (error instanceof PrivatePackError || error instanceof PrivateSkillError || error instanceof ContentStorageError) {
      return Response.json({ error: error.code }, { status: error.status, headers: privateHeaders });
    }
    if (error instanceof ManagedCryptoError) {
      return Response.json({ error: "pack_integrity" }, { status: 409, headers: privateHeaders });
    }
    if (error instanceof PrivateSkillContractError || error instanceof z.ZodError ||
        error instanceof SyntaxError || error instanceof TypeError) {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: privateHeaders });
    }
    if (error instanceof Error) {
      const fenced = error.message.includes("tenant_fenced");
      return Response.json({ error: fenced ? "tenant_fenced" : "private_packs_unavailable" },
        { status: fenced ? 403 : 503, headers: privateHeaders });
    }
    throw error;
  }
}
