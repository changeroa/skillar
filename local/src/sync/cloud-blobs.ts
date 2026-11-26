import { randomUUID, createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { z } from "zod";
import { CLOUD_SCHEMA } from "./cloud-schema.js";
import { acknowledgeBatch, pendingBatch } from "./outbox.js";
import { initializeQueue, spoolRequest } from "./spool-request.js";

export class CloudSyncError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CloudSyncError";
  }
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const leaseSchema = z.object({ owner: z.string(), epoch: z.number().int(), until_ms: z.number().int() });

/** Separate durable blob DB keeps large serialization/fsync out of source commits. */
export class CloudBlobs {
  readonly #db: Database;
  readonly #owner = randomUUID();
  #epoch: number | null = null;
  constructor(path: string, readonly maxBytes = 64 * 1024 * 1024) {
    z.number().int().positive().parse(maxBytes);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new Database(path, { strict: true });
    chmodSync(path, 0o600);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON`);
    const version = z.object({ user_version: z.number() })
      .parse(this.#db.prepare("PRAGMA user_version").get()).user_version;
    if (version === 0) {
      this.#db.exec(`BEGIN IMMEDIATE;
        ${CLOUD_SCHEMA}
        PRAGMA user_version=1;
        COMMIT`);
    } else if (version !== 1) {
      this.#db.close(true);
      throw new CloudSyncError("unsupported_spool_version");
    }
  }
  acquire(now = Date.now(), ttlMs = 60_000): boolean {
    z.number().int().positive().parse(ttlMs);
    const row = this.#db.prepare(`UPDATE lease SET
      epoch=CASE WHEN owner=? THEN epoch ELSE epoch+1 END,owner=?,until_ms=?
      WHERE id=1 AND (owner=? OR until_ms<=?) RETURNING owner,epoch,until_ms`)
      .get(this.#owner, this.#owner, now + ttlMs, this.#owner, now);
    if (row === null) return false;
    this.#epoch = leaseSchema.parse(row).epoch;
    return true;
  }
  assertLease(now = Date.now()): void {
    const row = leaseSchema.parse(this.#db.prepare("SELECT * FROM lease WHERE id=1").get());
    if (row.owner !== this.#owner || row.epoch !== this.#epoch || row.until_ms <= now) {
      throw new CloudSyncError("spool_lease_lost");
    }
  }
  renew(now = Date.now(), ttlMs = 60_000): void {
    const changed = this.#db.prepare(`UPDATE lease SET until_ms=?
      WHERE id=1 AND owner=? AND epoch=? AND until_ms>?`)
      .run(now + ttlMs, this.#owner, this.#epoch, now);
    if (changed.changes !== 1) throw new CloudSyncError("spool_lease_lost");
  }
  release(): void {
    if (this.#epoch !== null) {
      this.#db.prepare("UPDATE lease SET until_ms=0 WHERE id=1 AND owner=? AND epoch=?")
        .run(this.#owner, this.#epoch);
      this.#epoch = null;
    }
  }
  #transaction<T>(run: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.assertLease();
      const result = run();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  put(bytes: Uint8Array): { readonly hash: string; readonly bytes: number } {
    return this.#transaction(() => {
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (this.#db.prepare("SELECT 1 FROM blobs WHERE hash=?").get(hash) !== null) {
        return { hash, bytes: bytes.byteLength };
      }
      const used = z.object({ bytes: z.number() }).parse(
        this.#db.prepare(`SELECT COALESCE((SELECT sum(nbytes) FROM blobs),0)+
          COALESCE((SELECT sum(payload_bytes) FROM sync_outbox),0) AS bytes`).get());
      if (used.bytes + bytes.byteLength > this.maxBytes) throw new CloudSyncError("outbox_pressure");
      this.#db.prepare("INSERT INTO blobs VALUES(?,?,?)").run(hash, bytes, bytes.byteLength);
      return { hash, bytes: bytes.byteLength };
    });
  }
  get(hash: string): Uint8Array {
    digest.parse(hash);
    const row = this.#db.prepare("SELECT bytes,nbytes FROM blobs WHERE hash=?").get(hash);
    if (row === null) throw new CloudSyncError("spool_blob_missing");
    const saved = z.object({
      bytes: z.instanceof(Uint8Array), nbytes: z.number().int().nonnegative(),
    }).parse(row);
    if (saved.bytes.byteLength !== saved.nbytes ||
        createHash("sha256").update(saved.bytes).digest("hex") !== hash) {
      throw new CloudSyncError("spool_blob_corrupt");
    }
    return saved.bytes;
  }
  prune(retained: ReadonlySet<string> = new Set()): number {
    return this.#transaction(() => {
      const rows = z.array(z.object({ hash: digest }))
        .parse(this.#db.prepare(`SELECT hash FROM blobs b WHERE NOT EXISTS
          (SELECT 1 FROM sync_outbox_blobs r WHERE r.hash=b.hash)`).all());
      const remove = this.#db.prepare("DELETE FROM blobs WHERE hash=?");
      let deleted = 0;
      for (const row of rows) if (!retained.has(row.hash)) {
        remove.run(row.hash);
        deleted++;
      }
      return deleted;
    });
  }
  initialize(input: Parameters<typeof initializeQueue>[1]): void {
    this.#transaction(() => initializeQueue(this.#db, input));
  }
  enqueue(input: Omit<Parameters<typeof spoolRequest>[1], "assertLease" | "storedBlobBytes">) {
    return spoolRequest(this.#db, {
      ...input,
      quota: {
        maxBatches: input.quota?.maxBatches ?? 1024,
        maxBytes: Math.min(input.quota?.maxBytes ?? this.maxBytes, this.maxBytes),
      },
      assertLease: () => this.assertLease(),
      storedBlobBytes: () => z.object({ bytes: z.number().int().nonnegative() })
        .parse(this.#db.prepare("SELECT COALESCE(sum(nbytes),0) AS bytes FROM blobs").get()).bytes,
    });
  }
  pending(streamId: string) {
    return pendingBatch(this.#db, streamId);
  }
  pendingPrefix(prefix: string) {
    const row = this.#db.prepare(`SELECT stream_id FROM sync_outbox
      WHERE substr(stream_id,1,length(?))=? ORDER BY rowid LIMIT 1`).get(prefix, prefix);
    if (row === null) return null;
    const { stream_id: streamId } = z.object({ stream_id: z.string() }).parse(row);
    const batch = pendingBatch(this.#db, streamId);
    if (batch === null) throw new CloudSyncError("spool_sequence_gap");
    return batch;
  }
  /** Stream identity is the device+source, not one connection instance: a
   * re-approval mints a new instanceId for the same device, and the existing
   * stream must be found again instead of staging a second baseline. */
  liveStreamFor(deviceId: string, sourceDomain: string): string | null {
    const row = this.#db.prepare(`SELECT stream_id FROM sync_streams
      WHERE device_id=? AND source_domain=? AND stream_id GLOB 'cloud-live:*'
      ORDER BY ack_sequence DESC, rowid DESC LIMIT 1`).get(deviceId, sourceDomain);
    return row === null ? null : z.object({ stream_id: z.string() }).parse(row).stream_id;
  }
  runtimeStreamFor(deviceId: string, sourceDomain: string): string | null {
    const row = this.#db.prepare(`SELECT stream_id FROM sync_streams
      WHERE device_id=? AND source_domain=? AND stream_id GLOB 'cloud-runtime:*'
      ORDER BY ack_sequence DESC, rowid DESC LIMIT 1`).get(deviceId, sourceDomain);
    return row === null ? null : z.object({ stream_id: z.string() }).parse(row).stream_id;
  }
  pendingMigration(deviceId: string, sourceDomain: string) {
    const row = this.#db.prepare(`SELECT o.stream_id FROM sync_outbox o
      JOIN sync_streams s ON s.stream_id=o.stream_id
      WHERE s.device_id=? AND s.source_domain=? AND o.stream_id GLOB 'cloud-migration:*'
      ORDER BY o.rowid LIMIT 1`).get(deviceId, sourceDomain);
    if (row === null) return null;
    const { stream_id: streamId } = z.object({ stream_id: z.string() }).parse(row);
    const batch = pendingBatch(this.#db, streamId);
    if (batch === null) throw new CloudSyncError("spool_sequence_gap");
    return batch;
  }
  backfillAcked(sourceDomain: string, snapshotId: string): boolean {
    return this.#db.prepare(`SELECT 1 FROM sync_streams
      WHERE source_domain=? AND stream_id GLOB 'cloud-migration:*'
        AND substr(stream_id, 0 - length(?)) = ? AND ack_sequence > 0`)
      .get(sourceDomain, snapshotId, snapshotId) !== null;
  }
  /** A staged batch that was never acked never left this device; dropping it is
   * local-only cleanup of a stale spool entry, never a server change. */
  discardStream(streamId: string): void {
    z.string().min(1).max(512).parse(streamId);
    this.#transaction(() => {
      this.assertLease();
      this.#db.prepare("DELETE FROM sync_outbox WHERE stream_id=?").run(streamId);
      this.#db.prepare("DELETE FROM sync_streams WHERE stream_id=?").run(streamId);
    });
  }
  acknowledge(receipt: Parameters<typeof acknowledgeBatch>[1]): void {
    acknowledgeBatch(this.#db, receipt, () => this.assertLease());
  }
  cursor(streamId: string) {
    const row = this.#db.prepare("SELECT ack_sequence,ack_cut FROM sync_streams WHERE stream_id=?").get(streamId);
    return row === null ? null : z.object({
      ack_sequence: z.number().int().nonnegative(), ack_cut: z.number().int().nonnegative(),
    }).parse(row);
  }
  close(): void {
    this.release();
    this.#db.close(true);
  }
}
