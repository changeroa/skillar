import { activityRequest } from "../../lib/activity-routes.ts";
import type { ActivityEnv } from "../../lib/activity-auth.ts";

export const onRequest: PagesFunction<ActivityEnv> = ({ request, env }) => activityRequest(request, env);
