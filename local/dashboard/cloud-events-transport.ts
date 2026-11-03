import { eventPaths } from "../../shared/activity-events";

export type LiveTransportKind = "websocket" | "sse";
export type LiveTarget = { readonly kind: LiveTransportKind; readonly url: string };
/** `cursor` is the SSE `id:` field; WebSocket frames carry none and derive it from the message. */
export type LiveFrame = { readonly data: string; readonly cursor: string | null };
export type LiveSocket = { readonly close: () => void };
export type LiveSocketEvents = {
  readonly onFrame: (frame: LiveFrame) => void;
  /** A custom connector temporarily interrupted delivery; a new ready or onClose follows. */
  readonly onInterrupted: () => void;
  /** Closed by the server or the network; never fired for a client close. */
  readonly onClose: () => void;
};
export type LiveConnect = (target: LiveTarget, events: LiveSocketEvents) => LiveSocket;

/** Named SSE events written by the AccountHub: control messages reuse their type, invalidations are `change`. */
const SSE_EVENTS = ["ready", "resync_required", "change"] as const;

export function liveUrl(kind: LiveTransportKind, connectionId: string, since: string): string {
  const path = kind === "websocket" ? eventPaths.websocket : eventPaths.stream;
  return `${path}?${new URLSearchParams({ connectionId, since })}`;
}

export function browserTransports(): readonly LiveTransportKind[] {
  const kinds: LiveTransportKind[] = [];
  if (typeof WebSocket === "function") kinds.push("websocket");
  if (typeof EventSource === "function") kinds.push("sse");
  return kinds;
}

export const browserConnect: LiveConnect = (target, events) => {
  switch (target.kind) {
    case "websocket": return openWebSocket(target.url, events);
    case "sse": return openEventSource(target.url, events);
    default: {
      const exhaustive: never = target.kind;
      return exhaustive;
    }
  }
};

function openWebSocket(url: string, events: LiveSocketEvents): LiveSocket {
  const address = new URL(url, location.href);
  address.protocol = address.protocol === "http:" ? "ws:" : "wss:";
  const socket = new WebSocket(address);
  let open = true;
  // The server closes on any client data, so nothing is ever sent; native ping/pong keeps the socket alive.
  socket.onmessage = (message: MessageEvent<unknown>) => {
    if (open && typeof message.data === "string") events.onFrame({ data: message.data, cursor: null });
  };
  socket.onclose = () => {
    if (!open) return;
    open = false;
    events.onClose();
  };
  return { close() { if (!open) return; open = false; socket.close(); } };
}

function openEventSource(url: string, events: LiveSocketEvents): LiveSocket {
  const source = new EventSource(url);
  let open = true;
  const frame = (event: Event) => {
    if (open && event instanceof MessageEvent && typeof event.data === "string") {
      events.onFrame({ data: event.data, cursor: event.lastEventId === "" ? null : event.lastEventId });
    }
  };
  for (const name of SSE_EVENTS) source.addEventListener(name, frame);
  source.onerror = () => {
    if (!open) return;
    open = false;
    source.close();
    events.onClose();
  };
  return { close() { if (!open) return; open = false; source.close(); } };
}
