// SPDX-License-Identifier: AGPL-3.0-only
import { eventCursorSchema, eventServicePaths } from "../../../shared/activity-events.ts";
import {
  authenticateEventRequest, authenticateEventRevocation, eventFailure, eventHeaders, EventRequestError,
} from "./account-event-auth.ts";
import { readAccountChanges } from "./event-replay.ts";
import type { DeploymentOrigins } from "../../../shared/deployment-origin.ts";

export interface EventEnv extends DeploymentOrigins {
  readonly ACTIVITY: D1Database;
  readonly ACCOUNTS: D1Database;
  readonly ACCOUNT_HUB: DurableObjectNamespace;
}

/** Private service binding only; the public Pages boundary replaces all authority headers. */
export async function accountEventsRequest(request: Request, env: EventEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = Object.values(eventServicePaths).find(value => value === url.pathname);
  if (path === undefined) return null;
  try {
    if (path === eventServicePaths.revoke) {
      const principal = await authenticateEventRevocation(request, env.ACCOUNTS, env);
      return await env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(principal.accountId)).fetch(request);
    }
    const { principal } = await authenticateEventRequest(request, env.ACCOUNTS, env);
    const post = path === eventServicePaths.lease;
    if (request.method !== (post ? "POST" : "GET")) throw new EventRequestError(405, "method_not_allowed");
    if (path === eventServicePaths.changes) {
      for (const key of url.searchParams.keys()) {
        if (key !== "since" || url.searchParams.getAll(key).length !== 1) {
          throw new EventRequestError(400, "invalid_request");
        }
      }
      const since = url.searchParams.get("since");
      if (since !== null) eventCursorSchema.parse(since);
      const replay = await readAccountChanges(env.ACTIVITY, principal, since);
      await authenticateEventRequest(request, env.ACCOUNTS, env);
      return Response.json(replay, { headers: eventHeaders });
    }
    return await env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(principal.accountId)).fetch(request);
  } catch (error) { return eventFailure(error); }
}
