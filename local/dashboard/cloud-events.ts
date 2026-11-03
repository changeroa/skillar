import { EVENT_LEASE_MS } from "../../shared/activity-events";
import { ApiError, type LiveState } from "./api";
import { decodeFrame, type EventMessage } from "./cloud-events-protocol";
import { ReplayEngine, type ReplayRest, type ReplaySink } from "./cloud-events-replay";
import {
  browserConnect, browserTransports, liveUrl,
  type LiveConnect, type LiveFrame, type LiveSocket, type LiveTransportKind,
} from "./cloud-events-transport";

export type LiveScheduler = {
  readonly now: () => number;
  readonly schedule: (delayMs: number, task: () => void) => () => void;
};
export type LiveVisibility = {
  readonly visible: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
};
export type CloudLiveOptions = {
  readonly connect?: LiveConnect;
  /** Preferred first; a kind that fails its handshake twice in a row falls back to the next one. */
  readonly transports?: readonly LiveTransportKind[];
  readonly scheduler?: LiveScheduler;
  readonly visibility?: LiveVisibility;
  /** Exponential reconnect delay bounds in milliseconds. */
  readonly reconnectMs?: readonly [number, number];
};
/** Authenticated REST reads; the adapter's shared 401 handling tears the controller down through stop(). */
export type CloudLiveRest = ReplayRest & {
  /** Renews the connection lease; resolves with the new expiry in epoch milliseconds. */
  readonly lease: (connectionId: string, signal: AbortSignal) => Promise<number>;
};
export type CloudLiveSink = ReplaySink & { readonly onState: (state: LiveState) => void };
export type CloudLive = { readonly start: () => void; readonly stop: () => void };

const HANDSHAKE_FAILURES_BEFORE_FALLBACK = 2;
const MIN_LEASE_DELAY_MS = 15_000;

export const browserScheduler: LiveScheduler = {
  now: () => Date.now(),
  schedule(delayMs, task) {
    const timer = setTimeout(task, delayMs);
    return () => clearTimeout(timer);
  },
};
export const browserVisibility: LiveVisibility = {
  visible: () => document.visibilityState === "visible",
  subscribe(listener) {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

type Deps = Required<CloudLiveOptions> & { readonly rest: CloudLiveRest; readonly sink: CloudLiveSink };
type Socket = { readonly connectionId: string; readies: number };
type Ready = Extract<EventMessage, { type: "ready" }>;

/** One start()..stop() lifetime: a single connection with its lease and reconnect timers. */
class LiveRun {
  private readonly abort = new AbortController();
  private readonly engine: ReplayEngine;
  private readonly unsubscribe: () => void;
  private transport: LiveTransportKind | undefined;
  private handshakeFailures = 0;
  private attempts = 0;
  private socket: Socket | undefined;
  private handle: LiveSocket | undefined;
  private cancelLease: (() => void) | undefined;
  private cancelReconnect: (() => void) | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: Deps) {
    this.engine = new ReplayEngine(deps.rest, deps.sink, this.abort.signal);
    this.transport = deps.transports[0];
    this.unsubscribe = deps.visibility.subscribe(() => this.onVisibility());
    deps.sink.onState(this.transport === undefined ? "offline" : "connecting");
    if (this.transport !== undefined) this.enqueue(() => this.connect());
  }
  private get signal(): AbortSignal { return this.abort.signal; }

  stop(): void {
    this.abort.abort();
    this.unsubscribe();
    this.cancelLease?.();
    this.cancelReconnect?.();
    this.handle?.close();
    this.handle = undefined;
    this.socket = undefined;
  }

  /** Frames and REST replay run serialized so a gap fill cannot interleave with later frames. */
  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(() => (this.signal.aborted ? undefined : task().catch((error: unknown) => this.recover(error))));
  }
  private recover(error: unknown): void {
    if (this.signal.aborted) return;
    if (!(error instanceof ApiError)) throw error;
    this.disconnect();
  }

  private async connect(): Promise<void> {
    await this.engine.sync();
    const since = this.engine.since;
    if (this.signal.aborted || this.transport === undefined || since === null) return;
    const socket: Socket = { connectionId: crypto.randomUUID(), readies: 0 };
    this.socket = socket;
    const current = (): boolean => this.socket === socket && !this.signal.aborted;
    this.handle = this.deps.connect({ kind: this.transport, url: liveUrl(this.transport, socket.connectionId, since) }, {
      onFrame: (frame) => this.enqueue(async () => { if (current()) await this.onFrame(socket, frame); }),
      onInterrupted: () => {
        if (!current()) return;
        this.cancelLease?.();
        this.deps.sink.onState("connecting");
      },
      onClose: () => { if (current()) this.disconnect(); },
    });
  }

  private async onFrame(socket: Socket, frame: LiveFrame): Promise<void> {
    const message = decodeFrame(frame.data);
    if (message === null) {
      this.disconnect();
      return;
    }
    if (!("type" in message)) {
      if (!await this.engine.apply(message, frame.cursor)) this.disconnect();
      return;
    }
    if (message.type === "resync_required") this.engine.reset(message.cursor);
    else await this.onReady(socket, message);
  }
  private async onReady(socket: Socket, ready: Ready): Promise<void> {
    if (ready.connectionId !== socket.connectionId) {
      this.disconnect();
      return;
    }
    socket.readies++;
    this.handshakeFailures = 0;
    this.attempts = 0;
    this.scheduleLease(ready.expiresAtMs);
    // A reopened EventSource replayed from Last-Event-ID; the head is compared through REST, never trusted from the socket.
    if (socket.readies > 1) await this.engine.sync();
    if (this.socket === socket && !this.signal.aborted) this.deps.sink.onState("live");
  }

  private scheduleLease(expiresAtMs: number): void {
    this.cancelLease?.();
    const half = Math.floor((expiresAtMs - this.deps.scheduler.now()) / 2);
    const delay = Math.min(EVENT_LEASE_MS / 2, Math.max(MIN_LEASE_DELAY_MS, half));
    this.cancelLease = this.deps.scheduler.schedule(delay, () => {
      this.cancelLease = undefined;
      this.enqueue(() => this.renewLease());
    });
  }
  private async renewLease(): Promise<void> {
    const socket = this.socket;
    if (socket === undefined) return;
    const expiresAtMs = await this.deps.rest.lease(socket.connectionId, this.signal);
    if (this.socket !== socket || this.signal.aborted) return;
    this.scheduleLease(expiresAtMs);
    await this.engine.sync();
  }

  private disconnect(): void {
    if (this.socket?.readies === 0 && ++this.handshakeFailures >= HANDSHAKE_FAILURES_BEFORE_FALLBACK) {
      const fallback = this.deps.transports[this.deps.transports.indexOf(this.transport ?? "websocket") + 1];
      if (fallback !== undefined) this.transport = fallback;
      this.handshakeFailures = 0;
    }
    this.cancelLease?.();
    this.cancelLease = undefined;
    this.handle?.close();
    this.handle = undefined;
    this.socket = undefined;
    this.deps.sink.onState("connecting");
    this.scheduleReconnect();
  }
  private scheduleReconnect(): void {
    this.cancelReconnect?.();
    const [min, max] = this.deps.reconnectMs;
    const delay = Math.min(max, min * 2 ** this.attempts);
    this.attempts++;
    this.cancelReconnect = this.deps.scheduler.schedule(delay, () => {
      this.cancelReconnect = undefined;
      this.enqueue(() => this.connect());
    });
  }
  private onVisibility(): void {
    if (this.signal.aborted || !this.deps.visibility.visible()) return;
    if (this.cancelReconnect !== undefined) {
      this.cancelReconnect();
      this.cancelReconnect = undefined;
      this.attempts = 0;
      this.enqueue(() => this.connect());
    } else if ((this.socket?.readies ?? 0) > 0) this.enqueue(() => this.engine.sync());
  }
}

export function createCloudLive(rest: CloudLiveRest, sink: CloudLiveSink, options: CloudLiveOptions = {}): CloudLive {
  const deps: Deps = {
    rest, sink,
    connect: options.connect ?? browserConnect,
    transports: options.transports ?? browserTransports(),
    scheduler: options.scheduler ?? browserScheduler,
    visibility: options.visibility ?? browserVisibility,
    reconnectMs: options.reconnectMs ?? [1_000, 30_000],
  };
  let run: LiveRun | undefined;
  return {
    start() { run ??= new LiveRun(deps); },
    stop() {
      run?.stop();
      run = undefined;
    },
  };
}
