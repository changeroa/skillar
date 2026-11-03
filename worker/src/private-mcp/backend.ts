// SPDX-License-Identifier: AGPL-3.0-only
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { McpContext } from "../../../shared/mcp-auth.ts";
import {
  parsePrivateSkillUri, privateSkillReadSchema,
} from "../../../shared/private-skills.ts";
import type { McpResourceEnv } from "./contracts.ts";
import { mcpCatalogSchema, mcpSearchResultSchema } from "./catalog-contracts.ts";
import type { McpSearchObservation, McpReadObservation } from "./telemetry.ts";

/** MCP uses the existing clients' skill:// scheme; storage keeps its private URI. */
export function mcpUri(uri: string): string {
  parsePrivateSkillUri(uri);
  return uri.replace(/^skillar:/, "skill:");
}
export function storageUri(uri: string): string {
  if (!uri.startsWith("skill://private/")) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Invalid private skill URI");
  }
  const value = uri.replace(/^skill:/, "skillar:");
  try { parsePrivateSkillUri(value); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Invalid private skill URI");
  }
  return value;
}

export function mcpBackend(env: McpResourceEnv, context: McpContext) {
  async function call(path: string, signal: AbortSignal, input?: unknown) {
    signal.throwIfAborted();
    const response = await env.ACTIVITY_SERVICE.fetch(new Request(`https://activity.internal${path}`, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-skillar-principal": JSON.stringify(context.principal),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal,
    }));
    signal.throwIfAborted();
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProtocolError(
        response.status === 400 || response.status === 404 ? ProtocolErrorCode.InvalidParams :
          ProtocolErrorCode.InternalError,
        response.status === 429 ? "Private catalog rate limit reached" :
          response.status === 401 || response.status === 403 ? "Private authorization expired" :
            "Private catalog unavailable; refresh before retrying",
      );
    }
    const value: unknown = await response.json();
    signal.throwIfAborted();
    return value;
  }
  return {
    async catalog(signal: AbortSignal) {
      return mcpCatalogSchema.parse(await call("/v1/private-skills/mcp/catalog", signal));
    },
    async search(input: unknown, signal: AbortSignal) {
      return mcpSearchResultSchema.parse(await call("/v1/private-skills/mcp/search", signal, input));
    },
    async read(uri: string, signal: AbortSignal) {
      return privateSkillReadSchema.parse(await call("/v1/private-skills/resources/read", signal, {
        uri: storageUri(uri),
      }));
    },
    async observe(kind: "search" | "read", observation: McpSearchObservation | McpReadObservation,
      signal: AbortSignal) {
      if (!context.recordActivity) return;
      z.strictObject({ recorded: z.boolean() }).parse(await call(
        "/v1/private-mcp/observations", signal, { context, kind, observation },
      ));
    },
  };
}
