// SPDX-License-Identifier: AGPL-3.0-only
import { DurableObject } from "cloudflare:workers";
import {
  EVENT_LEASE_MS, EVENT_SSE_LIFETIME_MS, EVENT_SSE_COOLDOWN_MS,
  eventCursorSchema, eventLeaseRequestSchema, eventPrincipalSchema,
  eventServicePaths,
} from "../../../shared/activity-events.ts";
import type { AccountReplay, EventPrincipal } from "../../../shared/activity-events.ts";
import {
  authenticateEventRequest, authenticateEventRevocation, eventFailure, eventHeaders, eventJson,
  eventSessionExpiry, EventRequestError,
} from "./account-event-auth.ts";
import type { EventEnv } from "./account-events.ts";
import { HubConnections } from "./account-hub-connections.ts";
import type { HubAttachment, HubConnection } from "./account-hub-connections.ts";
import { readAccountChanges } from "./event-replay.ts";

const notifySchema = eventPrincipalSchema.unwrap().pick({ accountId: true, generation: true });
type SseWindow = { readonly endsAtMs: number; readonly nextAllowedAtMs: number };

/** One object per principal.accountId; D1, not notify payloads, owns the change history. */
export class AccountHub extends DurableObject<EventEnv> {
  private readonly connections: HubConnections;
  constructor(ctx: DurableObjectState, env: EventEnv) {
    super(ctx, env);
    this.connections = new HubConnections(ctx, () => ctx.waitUntil(this.schedule()));
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  fetch(request: Request): Promise<Response> {
    // Serialize replay cursor updates across async D1 reads, connects, renewals and notifications.
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await this.dispatch(request); }
      catch (error) { return eventFailure(error); }
    });
  }

  private assertAccount(accountId: string): void {
    if (!this.env.ACCOUNT_HUB.idFromName(accountId).equals(this.ctx.id)) {
      throw new EventRequestError(403, "wrong_account");
    }
  }

  private async dispatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin === "https://hub.internal" && url.pathname === "/notify" && request.method === "POST") {
      const scope = notifySchema.parse(await eventJson(request));
      this.assertAccount(scope.accountId);
      const active = await this.env.ACCOUNTS.prepare(`SELECT 1 FROM accounts
        WHERE account_id=? AND auth_generation=? AND state='active' AND shard_id='activity-00'`)
        .bind(scope.accountId, scope.generation).first();
      if (active === null) throw new EventRequestError(403, "account_revoked");
      const head = await readAccountChanges(this.env.ACTIVITY, scope, null);
      for (const connection of this.connections.all()) {
        if (await this.live(connection)) await this.replay(connection);
      }
      // An ACK follows authoritative reads, fanout, attachment updates and a durable checkpoint.
      await this.ctx.storage.put("notification", { ...scope, cursor: head.cursor });
      await this.schedule();
      return Response.json({ ok: true }, { headers: eventHeaders });
    }
    if (url.pathname === eventServicePaths.revoke) {
      const principal = await authenticateEventRevocation(request, this.env.ACCOUNTS, this.env);
      this.assertAccount(principal.accountId);
      for (const connection of this.connections.all()) {
        if (connection.attachment.sessionId === principal.sessionId) connection.close();
      }
      await this.schedule();
      return Response.json({ ok: true }, { headers: eventHeaders });
    }
    const { principal, sessionExpiry } = await authenticateEventRequest(request, this.env.ACCOUNTS, this.env);
    this.assertAccount(principal.accountId);
    if (url.pathname === eventServicePaths.lease) {
      if (request.method !== "POST") throw new EventRequestError(405, "method_not_allowed");
      if (url.search) throw new EventRequestError(400, "invalid_request");
      const { connectionId } = eventLeaseRequestSchema.parse(await eventJson(request));
      const connection = this.connections.all().find(value => value.attachment.connectionId === connectionId);
      if (connection === undefined || connection.attachment.sessionId !== principal.sessionId ||
          connection.attachment.generation !== principal.generation || !await this.live(connection) ||
          this.connections.streams.has(connectionId)) {
        throw new EventRequestError(409, "connection_expired");
      }
      const expiresAtMs = Math.min(Date.now() + EVENT_LEASE_MS, sessionExpiry);
      connection.save({ ...connection.attachment, expiresAtMs });
      await this.replay(connection);
      await this.schedule();
      return Response.json({ connectionId, expiresAtMs }, { headers: eventHeaders });
    }
    if (url.pathname !== eventServicePaths.websocket && url.pathname !== eventServicePaths.stream) {
      throw new EventRequestError(404, "not_found");
    }
    if (request.method !== "GET") throw new EventRequestError(405, "method_not_allowed");
    return this.openConnection(request, principal, sessionExpiry);
  }

  private async openConnection(request: Request, principal: EventPrincipal, sessionExpiry: number): Promise<Response> {
    const url = new URL(request.url);
    for (const key of url.searchParams.keys()) {
      if (!["since", "connectionId"].includes(key) || url.searchParams.getAll(key).length !== 1) {
        throw new EventRequestError(400, "invalid_request");
      }
    }
    const websocket = url.pathname === eventServicePaths.websocket;
    if (websocket && request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      throw new EventRequestError(426, "websocket_required");
    }
    const connectionId = eventLeaseRequestSchema.parse({
      connectionId: url.searchParams.get("connectionId") ?? crypto.randomUUID(),
    }).connectionId;
    const since = (!websocket ? request.headers.get("last-event-id") : null) ?? url.searchParams.get("since");
    if (since !== null) eventCursorSchema.parse(since);
    for (const existing of this.connections.all()) {
      if (existing.attachment.connectionId === connectionId && await this.live(existing)) {
        throw new EventRequestError(409, "connection_exists");
      }
    }
    const replay = await readAccountChanges(this.env.ACTIVITY, principal, since);
    const current = await authenticateEventRequest(request, this.env.ACCOUNTS, this.env);
    let deadline = Date.now() + EVENT_LEASE_MS;
    if (!websocket) {
      // fetch's concurrency gate makes admission atomic across sessions and tabs.
      let window = await this.ctx.storage.get<SseWindow>("sse-window");
      const now = Date.now();
      if (window === undefined || now >= window.nextAllowedAtMs) {
        const endsAtMs = now + EVENT_SSE_LIFETIME_MS;
        window = { endsAtMs, nextAllowedAtMs: endsAtMs + EVENT_SSE_COOLDOWN_MS };
        await this.ctx.storage.put("sse-window", window);
      } else if (now >= window.endsAtMs) {
        throw new EventRequestError(429, "sse_cooldown");
      }
      deadline = window.endsAtMs;
    }
    const attachment: HubAttachment = {
      accountId: principal.accountId, sessionId: principal.sessionId, generation: principal.generation,
      expiresAtMs: Math.min(deadline, sessionExpiry, current.sessionExpiry), connectionId,
      cursor: replay.state === "ok" && since !== null ? since : replay.cursor,
    };
    let connection: HubConnection;
    let response: Response;
    if (websocket) {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      connection = this.connections.websocket(pair[1], attachment);
      connection.save(attachment);
      response = new Response(null, { status: 101, webSocket: pair[0] });
    } else {
      ({ connection, response } = this.connections.sse(request, attachment));
    }
    connection.send({ type: "ready", connectionId, expiresAtMs: attachment.expiresAtMs,
      cursor: attachment.cursor }, attachment.cursor);
    await this.replay(connection, replay);
    await this.schedule();
    return response;
  }

  private async live(connection: HubConnection): Promise<boolean> {
    if (connection.attachment.expiresAtMs <= Date.now() ||
        await eventSessionExpiry(this.env.ACCOUNTS, connection.attachment) === null) {
      connection.close();
      return false;
    }
    return true;
  }

  private async replay(connection: HubConnection, first?: AccountReplay): Promise<void> {
    let page = first ?? await readAccountChanges(this.env.ACTIVITY, connection.attachment, connection.attachment.cursor);
    for (;;) {
      if (!await this.live(connection)) return;
      if (page.state === "resync_required") {
        if (connection.send({ type: "resync_required", cursor: page.cursor }, page.cursor)) {
          connection.save({ ...connection.attachment, cursor: page.cursor });
        }
        return;
      }
      for (const change of page.changes) {
        const scope = page.cursor.split(".")[0];
        const cursor = `${scope}.${change.generation}.${change.seq}`;
        if (!connection.send(change, cursor)) return;
        connection.save({ ...connection.attachment, cursor });
      }
      if (!page.hasMore) return;
      page = await readAccountChanges(this.env.ACTIVITY, connection.attachment, connection.attachment.cursor);
    }
  }

  private async schedule(): Promise<void> {
    const deadlines = this.connections.all().map(connection => connection.attachment.expiresAtMs);
    if (deadlines.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  alarm(): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      for (const connection of this.connections.all()) await this.live(connection);
      await this.schedule();
    });
  }

  webSocketMessage(socket: WebSocket, _message: string | ArrayBuffer): void {
    // Only the native ping/pong autoresponder accepts client data; claimed reauth is never authority.
    socket.close(1008, "Unsupported client message");
  }
  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    // No-status and abnormal-disconnect codes cannot be sent in a Close frame.
    socket.close(code === 1005 || code === 1006 ? 1000 : code);
    await this.schedule();
  }
  async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, "Transport error");
    await this.schedule();
  }
}
