import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { openDb } from "../store/db.js";
import { CloudSyncError } from "./cloud-blobs.js";
import {
  atomicCloudJson, cloudHome, readConnection,
} from "./cloud-connection.js";
import type { CloudConnection } from "./cloud-connection.js";
import { journalHead } from "./journal.js";

export const preparedSchema = z.strictObject({
  version: z.literal(1), snapshotId: z.string().uuid(), instanceId: z.string().uuid(),
  deviceId: z.string().min(1), generation: z.number().int().positive(),
  sourceDomain: z.string().min(1), cut: z.number().int().nonnegative(),
  capturedAtMs: z.number().int(), expiresAtMs: z.number().int(),
});
export type PreparedSnapshot = z.infer<typeof preparedSchema>;

export function preparedPath(home: string, snapshotId: string): string {
  return join(cloudHome(home), "prepared", `${z.string().uuid().parse(snapshotId)}.sqlite`);
}

/** A new device binding forks future recording, not the original row vectors. */
export function bindSource(path: string, connection: CloudConnection): void {
  const db = openDb(path);
  try {
    const marker = db.prepare("SELECT value FROM meta WHERE key='cloud.binding'").get();
    if (marker?.["value"] === connection.instanceId) return;
    if (db.prepare("SELECT 1 FROM sync_outbox LIMIT 1").get() !== undefined) {
      throw new CloudSyncError("pending_identity_change");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      // Fork identity without moving the durable clock backwards. Existing row
      // vectors retain their original domains; future marks use this new domain.
      db.prepare("UPDATE recording_clock SET domain=? WHERE singleton=1").run(randomUUID());
      db.prepare("UPDATE sync_identity SET source_domain=? WHERE singleton=1").run(randomUUID());
      db.prepare(`INSERT INTO meta(key,value) VALUES('cloud.binding',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(connection.instanceId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

/**
 * A LOCAL SQLite backup, not a cloud payload or outbox. Prepare exposes only its
 * cut/lineage/id so a later browser backfill grant can bind exactly this snapshot.
 * No request serialization, token transmission or raw upload happens here.
 */
export async function prepareCloudSnapshot(
  home: string, sourcePath: string, backupDatabase: typeof backup = backup,
): Promise<PreparedSnapshot> {
  const connection = readConnection(home);
  if (connection === null) throw new CloudSyncError("not_connected");
  bindSource(sourcePath, connection);
  const snapshotId = randomUUID(), target = preparedPath(home, snapshotId);
  mkdirSync(join(cloudHome(home), "prepared"), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp`;
  closeSync(openSync(temporary, "wx", 0o600));
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backupDatabase(source, temporary);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  } finally {
    source.close();
  }
  renameSync(temporary, target);
  for (const path of [target, join(cloudHome(home), "prepared")]) {
    const fd = openSync(path, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  const frozen = new DatabaseSync(target, { readOnly: true });
  let head: ReturnType<typeof journalHead>;
  try {
    head = journalHead(frozen);
  } finally {
    frozen.close();
  }
  const now = Date.now();
  const prepared = preparedSchema.parse({
    version: 1, snapshotId, instanceId: connection.instanceId,
    deviceId: connection.deviceId, generation: connection.generation,
    sourceDomain: head.sourceDomain, cut: head.cut, capturedAtMs: now,
    expiresAtMs: now + 86_400_000,
  });
  atomicCloudJson(home, "prepared.json", prepared);
  return prepared;
}
