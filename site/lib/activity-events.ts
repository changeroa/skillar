import {
  eventCursorSchema, eventLeaseRequestSchema, eventLeaseSchema, eventPaths,
  eventServicePaths, replaySchema,
} from "../../shared/dist/activity-events.js";
import {
  activityError, browserPrincipal, noStore,
} from "./activity-auth.ts";
import type { ActivityEnv, BrowserPrincipal } from "./activity-auth.ts";
import { readBody } from "./activity-body.ts";

const routes = new Map<string, string>([
  [eventPaths.changes, eventServicePaths.changes],
  [eventPaths.websocket, eventServicePaths.websocket],
  [eventPaths.stream, eventServicePaths.stream],
  [eventPaths.lease, eventServicePaths.lease],
]);

/** Credentials and authority headers are replaced, never copied to the private service. */
export async function eventRequest(
  request: Request, env: ActivityEnv, principal: BrowserPrincipal,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const route = routes.get(path);
  if (route === undefined) return activityError(404, "not_found");
  if (env.ACTIVITY_SERVICE === undefined) return activityError(503, "events_unavailable");
  if (!principal.scopes.includes("activity:read")) return activityError(403, "insufficient_scope");
  const websocket = path === eventPaths.websocket;
  const lease = path === eventPaths.lease;
  if (request.method !== (lease ? "POST" : "GET")) return activityError(405, "method_not_allowed");
  if (websocket && (request.headers.get("origin") !== url.origin ||
      request.headers.get("upgrade")?.toLowerCase() !== "websocket")) {
    return activityError(403, "invalid_origin");
  }
  const allowed = path === eventPaths.changes ? ["since"] : lease ? [] : ["since", "connectionId"];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) {
      return activityError(400, "invalid_request");
    }
  }
  const since = url.searchParams.get("since");
  if (since !== null) eventCursorSchema.parse(since);
  if (!lease && path !== eventPaths.changes) {
    eventLeaseRequestSchema.parse({ connectionId: url.searchParams.get("connectionId") });
  }
  const headers = new Headers({
    "x-skillar-principal": JSON.stringify(principal),
    "content-type": "application/json",
  });
  if (websocket) headers.set("upgrade", "websocket");
  const last = request.headers.get("last-event-id");
  if (path === eventPaths.stream && last !== null) {
    headers.set("last-event-id", eventCursorSchema.parse(last));
  }
  const body = lease ? JSON.stringify(eventLeaseRequestSchema.parse(await readBody(request))) : undefined;
  const response = await env.ACTIVITY_SERVICE.fetch(new Request(
    `https://activity.internal${route}${url.search}`, {
      method: request.method, headers, signal: request.signal,
      ...(body === undefined ? {} : { body }),
    },
  ));
  // Streaming authority is leased and rechecked by AccountHub. Buffer only JSON.
  if (websocket || path === eventPaths.stream) return response;
  const value: unknown = await response.json();
  const current = await browserPrincipal(request, env);
  if (current === null || current.accountId !== principal.accountId ||
      current.sessionId !== principal.sessionId || current.generation !== principal.generation) {
    return activityError(401, "unauthorized");
  }
  if (!response.ok) return activityError(response.status, "events_unavailable");
  return Response.json((lease ? eventLeaseSchema : replaySchema).parse(value), { headers: noStore });
}

/** D1 session deletion is authoritative; a lost RPC is bounded by the five-minute lease. */
export async function revokeEventSession(
  env: ActivityEnv, principal: BrowserPrincipal,
): Promise<boolean> {
  if (env.ACTIVITY_SERVICE === undefined) return false;
  try {
    const response = await env.ACTIVITY_SERVICE.fetch(new Request(
      `https://activity.internal${eventServicePaths.revoke}`, {
        method: "POST", headers: {
          "content-type": "application/json", "x-skillar-principal": JSON.stringify(principal),
        }, body: JSON.stringify({ sessionId: principal.sessionId }),
      },
    ));
    return response.ok;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return false;
  }
}
