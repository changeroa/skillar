import { mcpPagesBoundary } from "../lib/mcp.ts";
import type { McpPagesEnv } from "../lib/mcp.ts";

export const onRequest: PagesFunction<McpPagesEnv> = ({ request, env }) => mcpPagesBoundary(request, env);
