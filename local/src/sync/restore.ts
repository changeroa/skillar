import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "../store/db.js";
import type { SnapshotChunk } from "./snapshot.js";
import { mutationSchema, targetTables } from "./tables.js";
import type { Mutation } from "./tables.js";
import {
  checkDatabase, cutSchema, descriptorSchema, identity, parseRecord, readRows,
  replaceRows, RestoreError, summary,
} from "./restore-rows.js";
import type { RestoreDescriptor } from "./restore-rows.js";

export { RestoreError };
export type { RestoreDescriptor };

const stateSchema = z.object({
  source_domain: z.string(), cut: cutSchema, clock_json: z.string(),
});
const pageSchema = z.strictObject({
  snapshotId: z.string().min(1), sourceDomain: z.string().min(1), cut: cutSchema,
  index: cutSchema, records: z.array(mutationSchema), bytes: cutSchema,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});

function state(db: Db) {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sync_restore_state'").get()) {
    throw new RestoreError("restore_missing");
  }
  return stateSchema.parse(db.prepare("SELECT * FROM sync_restore_state WHERE singleton=1").get());
}

function idle(db: Db): void {
  if (db.isTransaction) throw new RestoreError("destination_busy");
}

function pristine(db: Db): void {
  if (["sync_journal", "sync_streams", "sync_outbox", "meta"].some(table =>
    db.prepare(`SELECT 1 FROM "${table}" LIMIT 1`).get()) ||
      db.prepare("SELECT 1 FROM sqlite_sequence WHERE name='sync_journal' AND seq>0").get() ||
      db.prepare("SELECT 1 FROM recording_clock WHERE position<>0").get()) {
    throw new RestoreError("destination_used");
  }
}

function transaction<T>(db: Db, run: () => T): T {
  idle(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function saveState(db: Db, descriptor: RestoreDescriptor, rows: readonly Mutation[]): void {
  const clocks = rows.filter(r => r.table === "recording_clock");
  const clock = clocks[0];
  if (clocks.length !== 1 || !clock || clock.key !== "[1]" || clock.sourceOrder !== 1 ||
      clock.values?.singleton !== 1 ||
      !z.string().min(1).safeParse(clock.values.domain).success ||
      !cutSchema.safeParse(clock.values.position).success) throw new RestoreError("invalid_snapshot");
  const local = z.object({ domain: z.string() }).parse(
    db.prepare("SELECT domain FROM recording_clock WHERE singleton=1").get());
  const sync = z.object({ source_domain: z.string() }).parse(
    db.prepare("SELECT source_domain FROM sync_identity WHERE singleton=1").get());
  if (descriptor.sourceDomain === sync.source_domain || clock.values.domain === local.domain) {
    throw new RestoreError("destination_used");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS sync_restore_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), source_domain TEXT NOT NULL,
    cut INTEGER NOT NULL, clock_json TEXT NOT NULL)`);
  db.prepare(`INSERT INTO sync_restore_state VALUES(1,?,?,?)
    ON CONFLICT(singleton) DO UPDATE SET source_domain=excluded.source_domain,
    cut=excluded.cut,clock_json=excluded.clock_json`)
    .run(descriptor.sourceDomain, descriptor.cut, JSON.stringify(clock));
}

function verifyRows(db: Db, descriptor: RestoreDescriptor) {
  const saved = state(db);
  if (saved.source_domain !== descriptor.sourceDomain || saved.cut !== descriptor.cut) {
    throw new RestoreError("verification_failed");
  }
  const rows = readRows(db, saved.cut, mutationSchema.parse(JSON.parse(saved.clock_json)));
  const result = summary(rows);
  if ((descriptor.hash !== undefined && descriptor.hash !== result.hash) ||
      (descriptor.counts !== undefined &&
        targetTables.some(table => descriptor.counts?.[table] !== result.counts[table]))) {
    throw new RestoreError("verification_failed");
  }
  checkDatabase(db);
  return { sourceDomain: saved.source_domain, cut: saved.cut, ...result };
}

/** Hash/count verification uses canonical logicalSnapshot order, substituting source clock provenance. */
export function verify(db: Db, input: RestoreDescriptor) {
  const descriptor = descriptorSchema.parse(input);
  idle(db);
  db.exec("BEGIN");
  try {
    return verifyRows(db, descriptor);
  } finally {
    db.exec("ROLLBACK");
  }
}

/** Fresh migrated database only. Iterator, parsing, SQL and verification failures roll back together. */
export function restoreSnapshot(db: Db, input: RestoreDescriptor, pages: Iterable<SnapshotChunk>) {
  const descriptor = descriptorSchema.parse(input);
  return transaction(db, () => {
    pristine(db);
    if (targetTables.some(table => table !== "recording_clock" &&
        db.prepare(`SELECT 1 FROM "${table}" LIMIT 1`).get()) ||
        db.prepare("SELECT 1 FROM skills_fts LIMIT 1").get() ||
        db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sync_restore_state'").get()) {
      throw new RestoreError("destination_used");
    }
    const rows = new Map<string, Mutation>();
    let index = 0;
    let snapshotId: string | undefined;
    for (const inputPage of pages) {
      const page = pageSchema.parse(inputPage);
      const payload = JSON.stringify(page.records);
      snapshotId ??= page.snapshotId;
      if (page.index !== index++ || page.snapshotId !== snapshotId ||
          page.sourceDomain !== descriptor.sourceDomain || page.cut !== descriptor.cut ||
          page.bytes !== Buffer.byteLength(payload) ||
          page.hash !== createHash("sha256").update(payload).digest("hex")) {
        throw new RestoreError("invalid_snapshot");
      }
      for (const inputRow of page.records) {
        const row = parseRecord(db, inputRow);
        const key = identity(row);
        if (row.operation !== "upsert" || row.revision !== descriptor.cut || rows.has(key)) {
          throw new RestoreError("invalid_snapshot");
        }
        rows.set(key, row);
      }
    }
    if (index === 0) throw new RestoreError("invalid_snapshot");
    const records = [...rows.values()];
    saveState(db, descriptor, records);
    replaceRows(db, records);
    return verifyRows(db, descriptor);
  });
}

export type Catchup = {
  readonly sourceDomain: string;
  readonly after: number;
  readonly cut: number;
  readonly records: Iterable<Mutation>;
  readonly counts?: RestoreDescriptor["counts"];
  readonly hash?: string;
};

/** One complete committed source range; gather readJournal pages before calling. */
export function applyCatchup(db: Db, input: Catchup) {
  const descriptor = descriptorSchema.parse({
    sourceDomain: input.sourceDomain, cut: input.cut, counts: input.counts, hash: input.hash,
  });
  const after = cutSchema.parse(input.after);
  return transaction(db, () => {
    pristine(db);
    const saved = state(db);
    if (saved.source_domain !== descriptor.sourceDomain || saved.cut !== after ||
        descriptor.cut < after) throw new RestoreError("invalid_catchup");
    const rows = new Map(readRows(db, descriptor.cut,
      mutationSchema.parse(JSON.parse(saved.clock_json))).map(row => [identity(row), row]));
    let previous = after;
    const seen = new Set<string>();
    for (const inputRow of input.records) {
      const row = parseRecord(db, inputRow);
      const key = identity(row);
      if (row.revision <= previous || row.revision > descriptor.cut || seen.has(key)) {
        throw new RestoreError("invalid_catchup");
      }
      previous = row.revision;
      seen.add(key);
      switch (row.operation) {
        case "delete": rows.delete(key); break;
        case "upsert": rows.set(key, { ...row, revision: descriptor.cut }); break;
        default: {
          const unreachable: never = row.operation;
          throw unreachable;
        }
      }
    }
    const records = [...rows.values()];
    saveState(db, descriptor, records);
    replaceRows(db, records);
    return verifyRows(db, descriptor);
  });
}
