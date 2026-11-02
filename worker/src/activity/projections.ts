import type { MetadataMutation } from "../../../shared/activity-schema.ts";
import type { StreamIdentity } from "./types.ts";

type SqlValue = string | number | null;
const identityWhere = "account_id=? AND generation=? AND device_id=? AND source_domain=?";
export const commitGuard = `EXISTS (SELECT 1 FROM ingest_receipts
  WHERE commit_id=? AND state='projecting')`;

export function projectMutation(
  db: D1Database,
  stream: StreamIdentity & { readonly commitId: string },
  mutation: MetadataMutation,
): readonly D1PreparedStatement[] {
  const identity = [stream.accountId, stream.generation, stream.deviceId, stream.sourceDomain];
  const table = {
    session: "session_facts", event: "event_facts", span: "span_facts",
  } as const;
  if (mutation.entity === "tombstone") {
    const target = table[mutation.target];
    const sourceKey = mutation.target === "event" ?
      `(SELECT source_key FROM event_facts WHERE ${identityWhere} AND entity_key=?)` : "NULL";
    return [
      db.prepare(`INSERT INTO entity_tombstones
        (account_id,generation,device_id,source_domain,entity_type,entity_key,revision,source_key)
        SELECT ?,?,?,?,?,?,?,${sourceKey} WHERE ${commitGuard}
        ON CONFLICT(account_id,generation,device_id,source_domain,entity_type,entity_key)
        DO UPDATE SET revision=excluded.revision,
          source_key=COALESCE(excluded.source_key,entity_tombstones.source_key)
        WHERE excluded.revision>entity_tombstones.revision`)
        .bind(...identity, mutation.target, mutation.key, mutation.revision,
          ...(mutation.target === "event" ? [...identity, mutation.key] : []), stream.commitId),
      db.prepare(`DELETE FROM ${target} WHERE ${identityWhere} AND entity_key=?
        AND revision<=? AND ${commitGuard}`)
        .bind(...identity, mutation.key, mutation.revision, stream.commitId),
    ];
  }
  let columns: readonly string[];
  let values: readonly SqlValue[];
  let sourceKey: string | null = null;
  switch (mutation.entity) {
    case "session":
      columns = ["runtime", "started_ms", "ended_ms"];
      values = [mutation.facts.runtime, mutation.facts.startedMs, mutation.facts.endedMs];
      break;
    case "event":
      columns = ["timestamp_ms", "source_order", "source_key", "recording_orders_json"];
      sourceKey = mutation.facts.sourceKey;
      values = [mutation.facts.timestampMs, mutation.facts.sourceOrder, sourceKey,
        JSON.stringify(mutation.facts.recordingOrders)];
      break;
    case "span":
      columns = ["trace_id", "span_id", "start_ms", "end_ms", "recording_orders_json"];
      values = [mutation.facts.traceId, mutation.facts.spanId, mutation.facts.startMs,
        mutation.facts.endMs, JSON.stringify(mutation.facts.recordingOrders)];
      break;
    default: {
      const exhaustive: never = mutation;
      return exhaustive;
    }
  }
  const target = table[mutation.entity];
  const updates = ["revision", "facts_json", ...columns].map(column => `${column}=excluded.${column}`).join(",");
  // Table/column identifiers come exclusively from the exhaustive server-side cases.
  return [db.prepare(`INSERT INTO ${target}
    (account_id,generation,device_id,source_domain,entity_key,revision,facts_json,${columns.join(",")})
    SELECT ${Array(7 + values.length).fill("?").join(",")}
    WHERE ${commitGuard} AND NOT EXISTS (
      SELECT 1 FROM entity_tombstones WHERE ${identityWhere} AND entity_type=?
        AND (entity_key=? OR (? IS NOT NULL AND source_key=?)) AND revision>=?
    )
    ON CONFLICT(account_id,generation,device_id,source_domain,entity_key)
    DO UPDATE SET ${updates} WHERE excluded.revision>${target}.revision
    ${mutation.entity === "event" ? "ON CONFLICT(account_id,generation,device_id,source_domain,source_key) DO NOTHING" : ""}`)
    .bind(...identity, mutation.key, mutation.revision, JSON.stringify(mutation.facts), ...values,
      stream.commitId, ...identity, mutation.entity, mutation.key, sourceKey, sourceKey, mutation.revision)];
}
