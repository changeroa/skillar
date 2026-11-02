import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "../store/db.js";
import { mutationSchema, scalarSchema, targetTables } from "./tables.js";
import type { Mutation, TargetTable } from "./tables.js";

export class RestoreError extends Error {
  constructor(readonly code:
    | "destination_busy" | "destination_used" | "invalid_snapshot" | "invalid_record"
    | "verification_failed" | "invalid_catchup" | "restore_missing") {
    super(code);
    this.name = "RestoreError";
  }
}

export const cutSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const descriptorSchema = z.strictObject({
  sourceDomain: z.string().min(1),
  cut: cutSchema,
  counts: z.record(z.enum(targetTables), cutSchema).optional(),
  hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).readonly();
export type RestoreDescriptor = z.infer<typeof descriptorSchema>;

export function shape(db: Db, table: TargetTable) {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map(row =>
    z.object({ name: z.string(), pk: z.number() }).parse(row));
  return { columns: columns.map(c => c.name),
    keys: columns.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name) };
}

export const identity = (row: Mutation): string => JSON.stringify([row.table, row.key]);

/** Parse the complete typed SQL image, never a partial projection/defaulted import. */
export function parseRecord(db: Db, input: unknown): Mutation {
  const row = mutationSchema.parse(input);
  const { columns, keys } = shape(db, row.table);
  const key = z.array(scalarSchema).parse(JSON.parse(row.key));
  if (key.length !== keys.length || key.some(v => v === null) ||
      JSON.stringify(key) !== row.key ||
      (row.table === "load_candidates" ? row.sourceOrder !== null :
        row.sourceOrder === null || !Number.isSafeInteger(row.sourceOrder))) {
    throw new RestoreError("invalid_record");
  }
  switch (row.operation) {
    case "delete":
      if (row.values !== null) throw new RestoreError("invalid_record");
      break;
    case "upsert": {
      const values = row.values;
      if (values === null || Object.keys(values).length !== columns.length ||
          columns.some(c => !Object.hasOwn(values, c)) ||
          keys.some((k, i) => values[k] !== key[i])) throw new RestoreError("invalid_record");
      break;
    }
    default: {
      const unreachable: never = row.operation;
      throw unreachable;
    }
  }
  return row;
}

export function readRows(db: Db, cut: number, clock?: Mutation): Mutation[] {
  const rows: Mutation[] = [];
  for (const table of targetTables) {
    if (table === "recording_clock" && clock) {
      rows.push({ ...clock, revision: cut });
      continue;
    }
    const { columns, keys } = shape(db, table);
    const order = table === "load_candidates" ? keys.map(c => `"${c}"`).join(",") : "rowid";
    for (const raw of db.prepare(`SELECT *, ${table === "load_candidates" ? "NULL" : "rowid"}
        AS restore_source_order FROM "${table}" ORDER BY ${order}`).all()) {
      const values = Object.fromEntries(columns.map(c => [c, scalarSchema.parse(raw[c])]));
      rows.push(mutationSchema.parse({ table, key: JSON.stringify(keys.map(k => values[k])),
        revision: cut, operation: "upsert", sourceOrder: raw.restore_source_order, values }));
    }
  }
  return rows;
}

export function summary(rows: readonly Mutation[]) {
  const counts = Object.fromEntries(targetTables.map(t => [t, rows.filter(r => r.table === t).length]));
  return { counts, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}

/** All trigger DDL and writes share the caller's transaction, including rollback. */
export function replaceRows(db: Db, rows: readonly Mutation[]): void {
  const triggers = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY rowid")
    .all().map(row => z.object({ name: z.string(), sql: z.string() }).parse(row));
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
  db.exec("PRAGMA defer_foreign_keys = ON");
  // Delete children first so foreign-key cascades cannot remove restored images.
  for (const table of [...targetTables].reverse()) {
    if (table !== "recording_clock") db.exec(`DELETE FROM "${table}"`);
  }
  for (const row of rows) {
    if (row.table === "recording_clock") continue;
    const { columns } = shape(db, row.table);
    const values = row.values;
    if (values === null) throw new RestoreError("invalid_record");
    const withRowid = row.table !== "load_candidates";
    const names = [...(withRowid ? ["rowid"] : []), ...columns];
    db.prepare(`INSERT INTO "${row.table}" (${names.map(c => `"${c}"`).join(",")})
      VALUES (${names.map(() => "?").join(",")})`)
      .run(...(withRowid ? [row.sourceOrder] : []), ...columns.map(c => values[c] ?? null));
  }
  // FTS is derived state, not source history; do not copy source virtual-table internals.
  db.exec(`DELETE FROM skills_fts;
    INSERT INTO skills_fts(uri,name,description,when_to_use,examples,aliases_ko,body_head)
      SELECT uri,name,description,when_to_use,examples_json,aliases_ko_json,body_head
      FROM skills WHERE removed_at IS NULL`);
  for (const trigger of triggers) db.exec(trigger.sql);
  const clock = rows.find(row => row.table === "recording_clock");
  const expected = new Map(rows.map(row => [identity(row), row]));
  const stored = readRows(db, 0, clock);
  if (stored.length !== rows.length || stored.some(row => {
    const original = expected.get(identity(row));
    return !original || original.sourceOrder !== row.sourceOrder ||
      Object.entries(row.values ?? {}).some(([name, value]) => original.values?.[name] !== value);
  })) throw new RestoreError("verification_failed");
}

export function checkDatabase(db: Db): void {
  if (db.prepare("PRAGMA foreign_key_check").all().length > 0 ||
      db.prepare("PRAGMA integrity_check").all().some(row => row.integrity_check !== "ok")) {
    throw new RestoreError("verification_failed");
  }
}
