import type { AccountInvalidation, AccountReplay } from "../../shared/activity-events";
import { ApiError, type SessionListRow } from "./api";
import {
  effectsOf, formatCursor, parseCursor, positionOf,
  type Cursor, type InvalidationEffects, type InvalidationKind,
} from "./cloud-events-protocol";

export type ReplayRest = {
  readonly changes: (since: string | null, signal: AbortSignal) => Promise<AccountReplay>;
  /** Requeries the subscribed session rows; resolves with the rows that changed. */
  readonly sessions: (signal: AbortSignal) => Promise<readonly SessionListRow[]>;
};
export type ReplaySink = {
  readonly onSession: (row: SessionListRow) => void;
  readonly onRefresh: () => void;
};

/** Cursor-ordered application of invalidations: dedupe, gap fill through REST, generation and resync resets. */
export class ReplayEngine {
  private cursor: Cursor | undefined;
  private requerying = false;
  private requeryDirty = false;

  constructor(
    private readonly rest: ReplayRest, private readonly sink: ReplaySink, private readonly signal: AbortSignal,
  ) {}

  get since(): string | null {
    return this.cursor === undefined ? null : formatCursor(this.cursor);
  }

  /** Authenticated head comparison: replays every missing page or resets on an expired cursor. */
  async sync(): Promise<void> {
    let since = this.since;
    for (;;) {
      const replay = await this.rest.changes(since, this.signal);
      if (this.signal.aborted) return;
      this.applyReplay(replay);
      if (replay.state === "resync_required" || !replay.hasMore) return;
      since = replay.cursor;
    }
  }

  reset(cursor: string): void {
    this.resetTo(parseCursor(cursor));
  }

  /** False when the frame cannot be placed: no scope yet, or an SSE id disagreeing with the derived cursor. */
  async apply(frame: AccountInvalidation, id: string | null): Promise<boolean> {
    if (this.cursor === undefined) return false;
    const next: Cursor = { ...this.cursor, generation: frame.generation, seq: frame.seq };
    if (id !== null && id !== formatCursor(next)) return false;
    const position = positionOf(this.cursor, frame);
    switch (position) {
      case "duplicate": return true;
      case "next":
        this.cursor = next;
        this.flush(effectsOf([frame.invalidationKind]));
        return true;
      case "gap":
        await this.sync();
        return true;
      case "generation":
        this.resetTo(next);
        return true;
      default: {
        const exhaustive: never = position;
        return exhaustive;
      }
    }
  }

  private applyReplay(replay: AccountReplay): void {
    const target = parseCursor(replay.cursor);
    if (replay.state === "resync_required") {
      this.resetTo(target);
      return;
    }
    if (this.cursor === undefined) {
      this.cursor = target;
      return;
    }
    let cursor = this.cursor;
    let generationChanged = false;
    const kinds: InvalidationKind[] = [];
    for (const change of replay.changes) {
      const position = positionOf(cursor, change);
      switch (position) {
        case "duplicate": break;
        case "generation":
          generationChanged = true;
          cursor = { ...cursor, generation: change.generation, seq: change.seq };
          this.resetTo(cursor);
          break;
        case "next": case "gap":
          cursor = { ...cursor, seq: change.seq };
          kinds.push(change.invalidationKind);
          break;
        default: {
          const exhaustive: never = position;
          return exhaustive;
        }
      }
    }
    this.cursor = cursor;
    if (!generationChanged) this.flush(effectsOf(kinds));
  }

  private resetTo(cursor: Cursor): void {
    this.cursor = cursor;
    this.flush({ sessions: true, refresh: true });
  }

  private flush(effects: InvalidationEffects): void {
    if (effects.sessions) this.requery();
    else if (effects.refresh) this.sink.onRefresh();
  }

  /** One requery in flight; invalidations arriving meanwhile coalesce into a single trailing run. */
  private requery(): void {
    if (this.requerying) {
      this.requeryDirty = true;
      return;
    }
    this.requerying = true;
    void this.requeryLoop();
  }

  private async requeryLoop(): Promise<void> {
    try {
      do {
        this.requeryDirty = false;
        try {
          for (const row of await this.rest.sessions(this.signal)) this.sink.onSession(row);
        } catch (error) {
          if (this.signal.aborted) return;
          if (!(error instanceof ApiError)) throw error;
        }
        if (this.signal.aborted) return;
        this.sink.onRefresh();
      } while (this.requeryDirty);
    } finally {
      this.requerying = false;
    }
  }
}
