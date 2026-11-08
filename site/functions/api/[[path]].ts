import { activityRequest } from "../../lib/activity-routes.ts";
import type { ActivityEnv } from "../../lib/activity-auth.ts";
import { mcpPagesBoundary } from "../../lib/mcp.ts";
import type { McpPagesEnv } from "../../lib/mcp.ts";

export const onRequest: PagesFunction<ActivityEnv & McpPagesEnv> = ({ request, env }) =>
  new URL(request.url).pathname.startsWith("/api/mcp/") ?
    mcpPagesBoundary(request, env) : activityRequest(request, env);
