// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { deletionServicePath, deletionTargetSchema } from "../../../shared/activity-deletion.ts";
import type { ContentEnv } from "./content-env.ts";
import { DeletionError, reconcileDeletion } from "./deletion-cleanup.ts";

export async function deletionRequest(request: Request, env: ContentEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== deletionServicePath) return null;
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (url.origin !== "https://activity.internal" || request.method !== "POST") {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  try {
    const input: unknown = await request.json();
    const target = deletionTargetSchema.parse(input);
    return Response.json(await reconcileDeletion(env, target), { headers });
  } catch (error) {
    if (error instanceof DeletionError) {
      return Response.json({ error: error.code }, { status: error.status, headers });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "invalid_request" }, { status: 400, headers });
    }
    if (error instanceof Error) {
      return Response.json({ error: "deletion_unavailable" }, { status: 503, headers });
    }
    throw error;
  }
}
