// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  EVENT_PAGE_SIZE, EVENT_RETENTION_MS, eventCursor, eventCursorSchema, eventCursorScope,
  invalidationSchema, replaySchema,
} from "../../../shared/activity-events.ts";
import type { AccountReplay } from "../../../shared/activity-events.ts";

const metadataSchema = z.object({
  generation: z.number().int().positive().safe(),
  active: z.number().int(),
  head: z.number().int().nonnegative().safe(),
  floor: z.number().int().nonnegative().safe(),
});

/** The floor is the last unavailable sequence; a cursor at the floor is valid. */
export async function readAccountChanges(
  db: D1Database,
  principal: { readonly accountId: string; readonly generation: number },
  since: string | null,
): Promise<AccountReplay> {
  const scope = await eventCursorScope(principal.accountId);
  const parsed = eventCursorSchema.safeParse(since);
  const [cursorScope, generationText, sequenceText] = parsed.success ? parsed.data.split(".") : [];
  const generation = Number(generationText), sequence = Number(sequenceText);
  const valid = parsed.success && cursorScope === scope && Number.isSafeInteger(generation) &&
    Number.isSafeInteger(sequence) && generation === principal.generation;
  const cutoff = Date.now() - EVENT_RETENTION_MS;
  const identity = [principal.accountId, principal.generation];
  // D1 batch is one transaction: head, retention floor and page share a snapshot.
  const results = await db.batch([
    db.prepare(`SELECT COALESCE(f.generation,?) AS generation,
      CASE WHEN f.state='active' THEN 1 ELSE 0 END AS active,
      COALESCE(h.head_seq,0) AS head,
      max(COALESCE(h.min_replay_seq,0),COALESCE((
        SELECT max(seq) FROM account_changes c WHERE c.account_id=?
          AND c.generation=COALESCE(f.generation,?) AND c.created_at<=?
      ),0)) AS floor
      FROM (SELECT 1) LEFT JOIN tenant_fences f ON f.account_id=?
      LEFT JOIN account_heads h ON h.account_id=f.account_id AND h.generation=f.generation`)
      .bind(principal.generation, principal.accountId, principal.generation, cutoff, principal.accountId),
    db.prepare(`SELECT generation,seq,invalidation_kind AS invalidationKind FROM account_changes
      WHERE account_id=? AND generation=? AND seq>? AND created_at>?
        AND ?=1 ORDER BY seq LIMIT ?`)
      .bind(...identity, valid ? sequence : 0, cutoff, since !== null && valid ? 1 : 0, EVENT_PAGE_SIZE + 1),
  ]);
  const metadata = metadataSchema.parse(results[0]?.results[0]);
  const reset = metadata.active !== 1 || metadata.generation !== principal.generation ||
    (since !== null && (!valid || sequence < metadata.floor || sequence > metadata.head));
  if (reset || since === null) {
    return replaySchema.parse({
      state: reset ? "resync_required" : "ok", head: metadata.head,
      cursor: eventCursor(scope, metadata.generation, metadata.head), changes: [], hasMore: false,
    });
  }
  const rows = z.array(invalidationSchema).parse(results[1]?.results);
  const changes = rows.slice(0, EVENT_PAGE_SIZE);
  return replaySchema.parse({
    state: "ok", head: metadata.head,
    cursor: eventCursor(scope, metadata.generation, changes.at(-1)?.seq ?? sequence),
    changes, hasMore: rows.length > EVENT_PAGE_SIZE,
  });
}

/** Cron bounds replay, undeliverable notifications and control retry receipts. */
export async function sweepAccountChanges(db: D1Database): Promise<void> {
  const cutoff = Date.now() - EVENT_RETENTION_MS;
  await db.batch([
    db.prepare(`UPDATE account_heads SET min_replay_seq=max(min_replay_seq,COALESCE((
      SELECT max(seq) FROM account_changes c WHERE c.account_id=account_heads.account_id
        AND c.generation=account_heads.generation AND c.created_at<=?
    ),0))`).bind(cutoff),
    db.prepare(`DELETE FROM account_changes WHERE created_at<=? OR EXISTS(
      SELECT 1 FROM account_heads h WHERE h.account_id=account_changes.account_id
        AND h.generation=account_changes.generation AND account_changes.seq<=h.min_replay_seq
    )`).bind(cutoff),
    db.prepare(`DELETE FROM account_event_outbox WHERE created_at<=? OR EXISTS(
      SELECT 1 FROM account_heads h WHERE h.account_id=account_event_outbox.account_id
        AND h.generation=account_event_outbox.generation AND account_event_outbox.seq<=h.min_replay_seq
    )`).bind(cutoff),
    db.prepare("DELETE FROM account_control_receipts WHERE created_at_ms<=?").bind(cutoff),
  ]);
}
