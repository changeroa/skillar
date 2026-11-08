import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, openSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { openDb } from "../store/db.js";
import type { Db } from "../store/db.js";
import { CloudSyncError } from "./cloud-blobs.js";
import { readConnection } from "./cloud-connection.js";
import { sha256 } from "./cloud-documents.js";
import { downloadSnapshot, exportPageSchema, verifyExportBatch } from "./cloud-export.js";
import { CloudHttp } from "./cloud-http.js";
import { cloudScope } from "./cloud-stage.js";
import { currentCloudDevice } from "./cloud-connection.js";
import { applyCatchup, restoreSnapshot, verify } from "./restore.js";
import { identity, readRows } from "./restore-rows.js";
import { mutationSchema } from "./tables.js";
import type { Mutation } from "./tables.js";
import { migrationReferenceSchema, summarizeSnapshot } from "./cloud-wire.js";
import type { ContentRow } from "./cloud-wire.js";

const asMutation = (row: ContentRow): Mutation => mutationSchema.parse({ ...row, beforeValues: null });
const asContent = ({ beforeValues: _before, ...row }: Mutation): ContentRow => row;

async function verifyDataset(db: Db, rows: readonly ContentRow[], cut: number) {
  const saved = db.prepare("SELECT clock_json FROM sync_restore_state WHERE singleton=1").get();
  const clock = mutationSchema.parse(JSON.parse(String(saved?.["clock_json"])));
  const actual = await summarizeSnapshot(readRows(db, cut, clock).map(asContent));
  const expected = await summarizeSnapshot(rows.map(row => ({ ...row, revision: cut })));
  if (actual.snapshotHash !== expected.snapshotHash ||
      JSON.stringify(actual.counts) !== JSON.stringify(expected.counts)) {
    throw new CloudSyncError("restore_integrity");
  }
}

/** New destination only. Publish a fully verified DB atomically without replacing a file. */
export async function restoreCloud(
  home: string, destination: string, input: unknown, fetcher: typeof fetch = fetch,
) {
  if (existsSync(destination)) throw new CloudSyncError("destination_exists");
  const connection = readConnection(home);
  if (connection === null) throw new CloudSyncError("not_connected");
  const reference = migrationReferenceSchema.parse(input);
  if (reference.deviceId !== connection.deviceId || reference.generation !== connection.generation) {
    throw new CloudSyncError("device_identity_mismatch");
  }
  const self = await currentCloudDevice(connection, fetcher);
  const scope = cloudScope(connection, self.consent, self.consent.mode === "managed-content" &&
    self.consent.backfill !== undefined);
  if (scope.contentKinds.length !== 7) throw new CloudSyncError("full_snapshot_required");
  const http = new CloudHttp(connection.origin, connection.token, fetcher);
  const { manifest, rows } = await downloadSnapshot(http, reference);
  const cut = manifest.migration.cut;
  const records = rows.map(asMutation), payload = JSON.stringify(records);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  closeSync(openSync(temporary, "wx", 0o600));
  let db: Db | undefined;
  try {
    db = openDb(temporary);
    restoreSnapshot(db, { sourceDomain: reference.sourceDomain, cut, counts: manifest.migration.counts }, [{
      snapshotId: reference.snapshotId, sourceDomain: reference.sourceDomain, cut,
      index: 0, records, bytes: Buffer.byteLength(payload), hash: sha256(payload),
    }]);
    await verifyDataset(db, rows, cut);
    const dataset = new Map(records.map(row => [identity(row), asContent(row)]));
    let afterSequence = 0, throughSequence: number | undefined, currentCut = cut;
    for (;;) {
      const page = exportPageSchema.parse(await http.request("/v1/activity/export", {
        body: JSON.stringify({
          ...reference, snapshotId: undefined, consentVersion: scope.consentVersion,
          projectId: scope.projectId, rootId: scope.rootId,
          range: { fromMs: scope.fromMs, toMs: scope.toMs }, backfill: scope.backfill,
          afterSequence, throughSequence, limit: 1,
        }), maxResponseBytes: 18 * 1024 * 1024,
      }));
      if (page.deviceId !== reference.deviceId || page.sourceDomain !== reference.sourceDomain ||
          page.generation !== reference.generation || page.afterSequence !== afterSequence ||
          (throughSequence !== undefined && page.throughSequence !== throughSequence) ||
          page.start?.sequence !== afterSequence || page.start.journalThrough > currentCut) {
        throw new CloudSyncError("restore_history_gap");
      }
      throughSequence ??= page.throughSequence;
      let previousCut = page.start.journalThrough;
      for (const item of page.batches) {
        verifyExportBatch(item);
        const batch = item.batch;
        if (batch.sequence !== afterSequence + 1 || batch.journal.from !== previousCut ||
            batch.deviceId !== reference.deviceId || batch.sourceDomain !== reference.sourceDomain ||
            batch.generation !== reference.generation) throw new CloudSyncError("restore_history_gap");
        afterSequence = batch.sequence;
        previousCut = batch.journal.through;
        if (previousCut <= currentCut) continue;
        const changes = item.document.rows.filter(row => row.revision > currentCut).map(asMutation);
        for (const row of changes) {
          if (row.operation === "delete") dataset.delete(identity(row));
          else dataset.set(identity(row), asContent(row));
        }
        applyCatchup(db, {
          sourceDomain: reference.sourceDomain, after: currentCut, cut: previousCut, records: changes,
        });
        currentCut = previousCut;
        await verifyDataset(db, [...dataset.values()], currentCut);
      }
      if (page.cursor?.sequence !== afterSequence || page.cursor.journalThrough !== previousCut ||
          page.hasMore !== (afterSequence < throughSequence) ||
          (page.hasMore && page.batches.length === 0)) throw new CloudSyncError("restore_history_gap");
      if (!page.hasMore) break;
    }
    const result = verify(db, { sourceDomain: reference.sourceDomain, cut: currentCut });
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    db = undefined;
    const fd = openSync(temporary, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    linkSync(temporary, destination);
    const parent = openSync(dirname(destination), "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
    return { ...result, throughSequence };
  } finally {
    db?.close();
    for (const path of [temporary, `${temporary}-wal`, `${temporary}-shm`]) {
      if (existsSync(path)) unlinkSync(path);
    }
  }
}
