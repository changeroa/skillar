// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { PRIVATE_SKILL_MAX_REQUEST_BYTES, PrivateSkillContractError } from "../../../shared/private-skills.ts";
import { PrivateSkillError, privateHeaders } from "./contracts.ts";

export async function privateJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json") || request.body === null) {
    throw new PrivateSkillError(415, "json_required");
  }
  const reader = request.body.getReader(), parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > PRIVATE_SKILL_MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new PrivateSkillError(413, "request_too_large");
      }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export function privateFailure(error: unknown): Response {
  if (error instanceof PrivateSkillError) {
    return Response.json({ error: error.code }, { status: error.status, headers: {
      ...privateHeaders, ...(error.status === 429 ? { "retry-after": String(60 - Math.floor(Date.now() / 1000) % 60) } : {}),
    } });
  }
  if (error instanceof PrivateSkillContractError) {
    return Response.json({ error: error.code }, { status: 400, headers: privateHeaders });
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: privateHeaders });
  }
  if (error instanceof Error) {
    return Response.json({ error: "private_skills_unavailable" }, { status: 503, headers: privateHeaders });
  }
  throw error;
}
