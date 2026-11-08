import type { z } from "zod";
import { eventCursor, eventCursorSchema, eventMessageSchema, type AccountInvalidation } from "../../shared/activity-events";

export type EventMessage = z.infer<typeof eventMessageSchema>;
export type InvalidationKind = AccountInvalidation["invalidationKind"];
/** Account-wide replay position: SHA-256 scope, auth generation, then the dense change sequence. */
export type Cursor = { readonly scope: string; readonly generation: number; readonly seq: number };

export function parseCursor(value: string): Cursor {
  const parts = eventCursorSchema.parse(value).split(".");
  return { scope: String(parts[0]), generation: Number(parts[1]), seq: Number(parts[2]) };
}
export function formatCursor(cursor: Cursor): string {
  return eventCursor(cursor.scope, cursor.generation, cursor.seq);
}

export type FramePosition = "duplicate" | "next" | "gap" | "generation";
/** Bare invalidations carry no scope; the cursor established by ready or replay supplies it. */
export function positionOf(cursor: Cursor, frame: AccountInvalidation): FramePosition {
  if (frame.generation !== cursor.generation) return "generation";
  if (frame.seq <= cursor.seq) return "duplicate";
  return frame.seq === cursor.seq + 1 ? "next" : "gap";
}

/** A malformed or over-shaped frame (any entity payload) is a protocol violation, never partially applied. */
export function decodeFrame(data: string): EventMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const parsed = eventMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type InvalidationEffects = { readonly sessions: boolean; readonly refresh: boolean };
/** Report completions are this adapter's own output; reacting to them would regenerate reports forever. */
export function effectsOf(kinds: Iterable<InvalidationKind>): InvalidationEffects {
  let sessions = false;
  let refresh = false;
  for (const kind of kinds) {
    switch (kind) {
      case "activity": case "runtime": case "migration": case "consent": sessions = true; refresh = true; break;
      case "skills": refresh = true; break;
      case "report": break;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  }
  return { sessions, refresh };
}
