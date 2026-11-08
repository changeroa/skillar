import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { openDb } from "../store/db.js";
import { CloudBlobs, CloudSyncError } from "./cloud-blobs.js";
import { atomicCloudJson, cloudHome, currentCloudDevice, readConnection } from "./cloud-connection.js";
import { deliverCloudJob } from "./cloud-delivery.js";
import { CloudHttp, CloudRequestError } from "./cloud-http.js";
import { liveStream, requireJob } from "./cloud-jobs.js";
import { bindSource } from "./cloud-prepare.js";
import { migrationPrefix, stageBaseline, stageLive } from "./cloud-stage.js";
import { journalHead } from "./journal.js";
import { SyncError } from "./tables.js";
import { ActivityContractError, authorizeUpload, parseContentBatch } from "./cloud-wire.js";
import type { Consent, UploadScope } from "./cloud-wire.js";

export const cloudProgressSchema = z.strictObject({
  version: z.literal(1), instanceId: z.string(), updatedAtMs: z.number().int(),
  phase: z.enum(["disconnected", "local-only", "metadata-only", "disabled", "busy",
    "queued", "caught-up", "auth-required", "consent-required", "retry", "quarantine", "paused"]),
  sourceDomain: z.string().optional(), acknowledgedCut: z.number().int().nonnegative().optional(),
  excluded: z.number().int().nonnegative().default(0),
  attempts: z.number().int().nonnegative().default(0),
  retryAtMs: z.number().int().optional(), code: z.string().optional(),
  liveTurns: z.number().int().nonnegative().default(0),
});
export type CloudProgress = z.infer<typeof cloudProgressSchema>;

export function cloudStatus(home: string): CloudProgress | null {
  const path = join(cloudHome(home), "status.json");
  return existsSync(path) ? cloudProgressSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : null;
}

export function pauseCloud(home: string, paused = true): void {
  atomicCloudJson(home, "control.json", { paused });
}
function isPaused(home: string): boolean {
  const path = join(cloudHome(home), "control.json");
  return existsSync(path) && z.strictObject({ paused: z.boolean() })
    .parse(JSON.parse(readFileSync(path, "utf8"))).paused;
}

function validatePending(consent: Consent, payload: string): void {
  const job = requireJob(payload);
  const common = job.kind === "migration" ? job.begin : parseContentBatch(JSON.parse(job.body));
  if (consent.mode !== "managed-content") throw new CloudSyncError("content_consent_required");
  const scope: UploadScope = {
    deviceId: common.deviceId, projectId: common.projectId, rootId: common.rootId,
    consentVersion: common.consentVersion, fromMs: common.range.fromMs, toMs: common.range.toMs,
    contentKinds: consent.contentKinds, backfill: common.backfill,
  };
  authorizeUpload(consent, scope);
}

/** One bounded background step. Network backoff is persisted, never slept through. */
export async function runCloudStep(
  home: string, sourcePath: string,
  options: { readonly backfill?: boolean; readonly resume?: boolean; readonly fetcher?: typeof fetch } = {},
): Promise<CloudProgress> {
  const connection = readConnection(home);
  const previous = cloudStatus(home);
  const same = connection !== null && previous?.instanceId === connection.instanceId ? previous : null;
  const save = (phase: CloudProgress["phase"], fields: Partial<CloudProgress> = {}) => {
    const progress = cloudProgressSchema.parse({
      version: 1, instanceId: connection?.instanceId ?? "", updatedAtMs: Date.now(),
      excluded: same?.excluded ?? 0, liveTurns: same?.liveTurns ?? 0, ...fields, phase,
    });
    atomicCloudJson(home, "status.json", progress);
    return progress;
  };
  if (connection === null) return save("disconnected");
  if (options.resume) pauseCloud(home, false);
  if (isPaused(home)) return save("paused");
  if (!options.resume && same?.phase === "quarantine") return same;
  if (!options.resume && same?.phase === "retry" && (same.retryAtMs ?? 0) > Date.now()) return same;
  const blobs = new CloudBlobs(join(cloudHome(home), "spool.sqlite"));
  if (!blobs.acquire()) {
    blobs.close();
    return { version: 1, instanceId: connection.instanceId, updatedAtMs: Date.now(),
      phase: "busy", attempts: 0, excluded: 0, liveTurns: 0 };
  }
  try {
    const self = await currentCloudDevice(connection, options.fetcher, same?.attempts ?? 0);
    if (self.consent.mode === "local-only") return save("local-only");
    if (self.consent.mode === "metadata") return save("metadata-only", { code: "raw_transport_not_enabled" });
    if (!self.ingestEnabled) return save("disabled");
    blobs.prune();
    bindSource(sourcePath, connection);
    const source = openDb(sourcePath);
    try {
      const head = journalHead(source), streamId = liveStream(connection.instanceId, head.sourceDomain);
      let migration = blobs.pendingPrefix(migrationPrefix(connection, head.sourceDomain));
      const cursor = blobs.cursor(streamId);
      const historical = self.consent.backfill;
      const backfillDone = historical !== undefined && (blobs.cursor(
        `${migrationPrefix(connection, head.sourceDomain)}${historical.snapshotId}`)?.ack_sequence ?? 0) > 0;
      if (cursor === null && migration === null) {
        await stageBaseline(home, source, blobs, connection, self.consent, "initial");
        migration = blobs.pendingPrefix(migrationPrefix(connection, head.sourceDomain));
      } else if (cursor !== null && migration === null && !backfillDone &&
          (options.backfill || historical !== undefined)) {
        await stageBaseline(home, source, blobs, connection, self.consent, "backfill");
        migration = blobs.pendingPrefix(migrationPrefix(connection, head.sourceDomain));
      }
      let batch = blobs.pending(streamId);
      const migrationTurn = migration !== null && (cursor === null || (same?.liveTurns ?? 0) >= 5);
      if (cursor !== null && batch === null && !migrationTurn) {
        await stageLive(source, blobs, connection, self.consent);
        batch = blobs.pending(streamId);
      }
      batch = migrationTurn ? migration : batch ?? migration;
      if (batch === null) return save("caught-up", {
        sourceDomain: head.sourceDomain, acknowledgedCut: cursor?.ack_cut ?? 0,
      });
      if (isPaused(home)) return save("paused");
      validatePending(self.consent, batch.payload);
      const job = requireJob(batch.payload);
      const result = await deliverCloudJob(blobs,
        new CloudHttp(connection.origin, connection.token, options.fetcher, 30_000, same?.attempts ?? 0), batch);
      if (result.accepted) {
        if (result.kind === "migration" && job.kind === "migration" && job.begin.purpose === "initial") {
          blobs.initialize({
            streamId, deviceId: connection.deviceId, sourceDomain: head.sourceDomain,
            sequence: result.status.cursor.sequence, cut: result.status.cursor.journalThrough,
          });
        }
        blobs.acknowledge({
          streamId: batch.stream_id, sequence: batch.sequence, payloadHash: batch.payload_hash,
        });
        blobs.prune();
      }
      return save("queued", {
        sourceDomain: head.sourceDomain, acknowledgedCut: blobs.cursor(streamId)?.ack_cut ?? 0,
        excluded: (same?.excluded ?? 0) + (result.accepted ? result.excluded : 0),
        liveTurns: result.kind === "cdc" ? (same?.liveTurns ?? 0) + 1 : 0,
      });
    } finally {
      source.close();
    }
  } catch (error) {
    if (error instanceof CloudRequestError) return save(
      error.state === "quarantined" ? "quarantine" : error.state, {
      code: error.code, retryAtMs: error.retryAtMs ?? undefined, attempts: (same?.attempts ?? 0) + 1,
    });
    if (error instanceof z.ZodError) return save("quarantine", { code: "invalid_contract" });
    if (error instanceof CloudSyncError || error instanceof SyncError || error instanceof ActivityContractError) return save(
      /consent/.test(error.code) ? "consent-required" :
        /credentials|identity/.test(error.code) ? "auth-required" : "quarantine",
      { code: error.code });
    throw error;
  } finally {
    blobs.close();
  }
}
