// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { eventPrincipalSchema } from "../../../shared/activity-events.ts";
import type { EventPrincipal } from "../../../shared/activity-events.ts";
import { isDeploymentOrigin } from "../../../shared/deployment-origin.ts";
import type { DeploymentOrigins } from "../../../shared/deployment-origin.ts";

export const eventHeaders = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
export class EventRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "EventRequestError";
  }
}

/** D1 is authoritative; an attachment or a supplied principal is never a session lease renewal. */
export async function eventSessionExpiry(
  db: D1Database,
  principal: Pick<EventPrincipal, "accountId" | "generation" | "sessionId">,
): Promise<number | null> {
  const row = await db.prepare(`SELECT s.expires_at FROM accounts a
    JOIN sessions s ON s.user_sub=a.user_sub
    WHERE a.account_id=? AND a.auth_generation=? AND a.shard_id='activity-00'
      AND a.state='active' AND s.id=? AND s.expires_at>?`)
    .bind(principal.accountId, principal.generation, principal.sessionId, Date.now() / 1000).first();
  return row === null ? null : z.object({ expires_at: z.number().int().positive() })
    .parse(row).expires_at * 1000;
}

function eventPrincipal(request: Request, origins: DeploymentOrigins): EventPrincipal {
  const url = new URL(request.url);
  if (url.origin !== "https://activity.internal" || url.username || url.password) {
    throw new EventRequestError(404, "not_found");
  }
  const raw = request.headers.get("x-skillar-principal");
  if (raw === null) throw new EventRequestError(401, "unauthorized");
  const principal = eventPrincipalSchema.parse(JSON.parse(raw));
  if (!isDeploymentOrigin(principal.issuer, origins)) throw new EventRequestError(403, "invalid_issuer");
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== principal.issuer) throw new EventRequestError(403, "invalid_origin");
  if (!principal.scopes.includes("activity:read")) throw new EventRequestError(403, "insufficient_scope");
  return principal;
}

export async function authenticateEventRequest(request: Request, db: D1Database, origins: DeploymentOrigins) {
  const principal = eventPrincipal(request, origins);
  const sessionExpiry = await eventSessionExpiry(db, principal);
  if (sessionExpiry === null) throw new EventRequestError(401, "unauthorized");
  return { principal, sessionExpiry };
}

/** Logout deletes D1's sid first. Private authority may only revoke its own sid, never renew it. */
export async function authenticateEventRevocation(
  request: Request, db: D1Database, origins: DeploymentOrigins,
): Promise<EventPrincipal> {
  const principal = eventPrincipal(request, origins);
  if (request.method !== "POST") throw new EventRequestError(405, "method_not_allowed");
  if (new URL(request.url).search) throw new EventRequestError(400, "invalid_request");
  const { sessionId } = z.strictObject({ sessionId: z.string().min(32).max(128) })
    .parse(await eventJson(request.clone()));
  if (sessionId !== principal.sessionId) throw new EventRequestError(403, "wrong_session");
  const active = await db.prepare(`SELECT 1 FROM accounts
    WHERE account_id=? AND auth_generation=? AND shard_id=? AND state='active'`)
    .bind(principal.accountId, principal.generation, principal.shardId).first();
  if (active === null) throw new EventRequestError(401, "unauthorized");
  return principal;
}

export async function eventJson(request: Pick<Request, "headers" | "body">): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json") || request.body === null) {
    throw new EventRequestError(415, "json_required");
  }
  const reader = request.body.getReader();
  const bytes = new Uint8Array(4096);
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (length + part.value.byteLength > bytes.length) {
        await reader.cancel();
        throw new EventRequestError(413, "request_too_large");
      }
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
}

export function eventFailure(error: unknown): Response {
  if (error instanceof EventRequestError) {
    return Response.json({ error: error.code }, { status: error.status, headers: eventHeaders });
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: eventHeaders });
  }
  if (error instanceof Error) {
    return Response.json({ error: "events_unavailable" }, { status: 503, headers: eventHeaders });
  }
  throw error;
}
