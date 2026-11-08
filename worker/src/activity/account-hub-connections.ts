// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { accountIdSchema } from "../../../shared/activity-schema.ts";
import { eventCursorSchema, eventMessageSchema } from "../../../shared/activity-events.ts";
import { eventHeaders } from "./account-event-auth.ts";

const attachmentSchema = z.strictObject({
  accountId: accountIdSchema, sessionId: z.string().min(32).max(128),
  generation: z.number().int().positive(), expiresAtMs: z.number().int().nonnegative(),
  cursor: eventCursorSchema, connectionId: z.string().uuid(),
});
export type HubAttachment = z.infer<typeof attachmentSchema>;
export type HubMessage = z.infer<typeof eventMessageSchema>;
export interface HubConnection {
  /** Mutable delivery position and lease; WebSocket copies are serialized after every update. */
  attachment: HubAttachment;
  send(message: HubMessage, cursor: string): boolean;
  save(attachment: HubAttachment): void;
  close(): void;
}

export class HubConnections {
  /** SSE keeps the object awake. This map deliberately has no hibernation claim. */
  readonly streams = new Map<string, HubConnection>();
  constructor(private readonly ctx: DurableObjectState, private readonly disconnected: () => void) {}

  all(): HubConnection[] {
    return [
      ...this.ctx.getWebSockets().filter(socket => socket.readyState === WebSocket.OPEN)
        .map(socket => this.websocket(socket, attachmentSchema.parse(socket.deserializeAttachment()))),
      ...this.streams.values(),
    ];
  }

  websocket(socket: WebSocket, attachment: HubAttachment): HubConnection {
    const connection: HubConnection = {
      attachment,
      send(message) {
        try { socket.send(JSON.stringify(message)); return true; }
        catch (error) {
          if (!(error instanceof Error)) throw error;
          connection.close();
          return false;
        }
      },
      save(next) { socket.serializeAttachment(next); connection.attachment = next; },
      close() { socket.close(1008, "Session ended"); },
    };
    return connection;
  }

  sse(request: Request, attachment: HubAttachment): { connection: HubConnection; response: Response } {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (cancelled: boolean) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      this.streams.delete(attachment.connectionId);
      request.signal.removeEventListener("abort", aborted);
      if (!cancelled) controller?.close();
      this.disconnected();
    };
    const aborted = () => finish(false);
    const connection: HubConnection = {
      attachment,
      send(message, cursor) {
        if (closed || controller === undefined) return false;
        if ((controller.desiredSize ?? 0) <= 0) { finish(false); return false; }
        const event = "type" in message ? message.type : "change";
        controller.enqueue(encoder.encode(`event: ${event}\nid: ${cursor}\ndata: ${JSON.stringify(message)}\n\n`));
        return true;
      },
      save(next) { connection.attachment = next; },
      close() { finish(false); },
    };
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() { finish(true); },
    }, { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength });
    this.streams.set(attachment.connectionId, connection);
    timer = setTimeout(() => finish(false), Math.max(0, attachment.expiresAtMs - Date.now()));
    request.signal.addEventListener("abort", aborted, { once: true });
    if (request.signal.aborted) aborted();
    return { connection, response: new Response(stream, {
      headers: { ...eventHeaders, "content-type": "text/event-stream", "x-accel-buffering": "no" },
    }) };
  }
}
