import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MessagePort } from "node:worker_threads";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { activeRequests } from "../request-status.js";
import { openDb } from "../store/db.js";
import { readIngestCounters } from "../store/writes.js";
import { CloudBlobs, CloudSyncError } from "./cloud-blobs.js";
import { atomicCloudJson, cloudHome, currentCloudDevice, readConnection } from "./cloud-connection.js";
import { blobReferenceSchema, sha256 } from "./cloud-documents.js";
import type { BlobReference } from "./cloud-documents.js";
import { CloudHttp, CloudRequestError } from "./cloud-http.js";
import { cloudScope } from "./cloud-stage.js";
import type { CloudProgress } from "./cloud.js";
import { journalHead } from "./journal.js";
import { SyncError } from "./tables.js";
import {
  ActivityContractError, analysisRuntimeSchema, authorizeUpload, contentChunkRefSchema,
  contentKinds, MAX_CONTENT_CHUNK_BYTES, parseContentChunkUpload, runtimeCommitSchema,
} from "./cloud-wire.js";
import type { AnalysisRuntime, Consent, RuntimeCommit } from "./cloud-wire.js";

export type RuntimeCapture = {
  readonly sourceDomain: string; readonly sourceCut: number; readonly context: AnalysisRuntime;
};
export type CaptureRuntime = () => RuntimeCapture;
/** Called only by the daemon's main-thread RPC handler, never by the sync worker. */
export function captureDaemonRuntime(db: DatabaseSync): RuntimeCapture {
  const head = journalHead(db);
  return {
    sourceDomain: head.sourceDomain, sourceCut: head.cut,
    context: {
      schemaVersion: 1, capturedAtMs: Date.now(), activeRequests: [...activeRequests],
      ingest: readIngestCounters(db), tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}
export const runtimeCaptureRequestSchema = z.strictObject({
  kind: z.literal("capture-runtime"), id: z.string().uuid(),
  sourceDomain: z.string(), sourceCut: z.number().int().nonnegative(),
});
export const runtimeCaptureReplySchema = z.strictObject({
  kind: z.literal("runtime-captured"), id: z.string().uuid(),
  capture: z.strictObject({
    sourceDomain: z.string(), sourceCut: z.number().int().nonnegative(), context: analysisRuntimeSchema,
  }).nullable(),
});
export function requestRuntimeCapture(
  port: MessagePort | null, request: z.infer<typeof runtimeCaptureRequestSchema>,
): Promise<RuntimeCapture | null> {
  if (port === null) return Promise.resolve(null);
  // Each request owns its listener, correlation ID and timeout.
  return new Promise(resolve => {
    const finish = (value: RuntimeCapture | null) => {
      clearTimeout(timeout);
      port.off("message", reply);
      resolve(value);
    };
    const reply = (value: unknown) => {
      const parsed = runtimeCaptureReplySchema.safeParse(value);
      if (parsed.success && parsed.data.id === request.id) finish(parsed.data.capture);
    };
    const timeout = setTimeout(() => finish(null), 5000);
    port.on("message", reply);
    port.postMessage(request);
  });
}
const jobSchema = z.strictObject({
  kind: z.literal("runtime"), body: z.string(), refs: z.array(blobReferenceSchema),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  preparedAtMs: z.number().int().optional(),
});
const receiptSchema = z.strictObject({
  sequence: z.number().int().positive(), sourceCut: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const rememberedSchema = z.strictObject({
  instanceId: z.string(), streamId: z.string(), sequence: z.number().int().positive(), fingerprint: z.string(),
  preparedAtMs: z.number().int().optional(), consentVersion: z.number().int().optional(),
});
export const runtimeStream = (instanceId: string, sourceDomain: string) =>
  `cloud-runtime:${instanceId}:${sourceDomain}`;

function paused(home: string): boolean {
  const path = join(cloudHome(home), "control.json");
  return existsSync(path) && z.object({ paused: z.boolean() })
    .parse(JSON.parse(readFileSync(path, "utf8"))).paused;
}
function authorize(consent: Consent, commit: RuntimeCommit): void {
  if (consent.mode !== "managed-content" || consent.scope.rootIds.length !== 0 ||
      commit.projectId !== `device:${commit.deviceId}` || commit.rootId !== null ||
      !contentKinds.every(kind => consent.contentKinds.includes(kind))) {
    throw new CloudSyncError("runtime_consent_required");
  }
  authorizeUpload(consent, {
    deviceId: commit.deviceId, projectId: commit.projectId, rootId: null,
    consentVersion: commit.consentVersion, fromMs: commit.range.fromMs, toMs: commit.range.toMs,
    backfill: commit.backfill, contentKinds,
  });
}

/** Called only after CDC is caught up. Capture is requested only after full consent. */
export async function runCloudRuntimeStep(
  home: string, sourcePath: string, progress: CloudProgress,
  capture: (request: z.infer<typeof runtimeCaptureRequestSchema>) => Promise<RuntimeCapture | null>,
  options: { readonly fetcher?: typeof fetch; readonly now?: () => number } = {},
): Promise<CloudProgress> {
  if (progress.phase !== "caught-up" || progress.sourceDomain === undefined ||
      progress.acknowledgedCut === undefined) return progress;
  const connection = readConnection(home);
  if (connection === null || connection.instanceId !== progress.instanceId) return progress;
  const save = (fields: Partial<CloudProgress>) => {
    const updated = { ...progress, updatedAtMs: Date.now(), ...fields };
    atomicCloudJson(home, "status.json", updated);
    return updated;
  };
  let blobs: CloudBlobs | undefined;
  try {
    if (paused(home)) return save({ phase: "paused" });
    const self = await currentCloudDevice(connection, options.fetcher);
    if (!self.ingestEnabled || !self.scopes.includes("activity:read") ||
        !self.scopes.includes("activity:ingest") || self.consent.mode !== "managed-content" ||
        !contentKinds.every(kind => self.consent.mode === "managed-content" && self.consent.contentKinds.includes(kind))) {
      return progress;
    }
    const scope = cloudScope(connection, self.consent, false);
    authorizeUpload(self.consent, { ...scope, contentKinds });
    blobs = new CloudBlobs(join(cloudHome(home), "spool.sqlite"));
    if (!blobs.acquire()) return save({ phase: "busy" });
    const streamId = runtimeStream(connection.instanceId, progress.sourceDomain);
    let batch = blobs.pending(streamId);
    if (batch === null) {
      const captured = await capture({
        kind: "capture-runtime", id: randomUUID(), sourceDomain: progress.sourceDomain,
        sourceCut: progress.acknowledgedCut,
      });
      if (captured === null) return progress;
      if (captured.sourceDomain !== progress.sourceDomain ||
          captured.sourceCut !== progress.acknowledgedCut) return save({ phase: "queued" });
      const source = openDb(sourcePath);
      try {
        const head = journalHead(source);
        if (head.sourceDomain !== captured.sourceDomain || head.cut !== captured.sourceCut) {
          return save({ phase: "queued" });
        }
      } finally { source.close(); }
      if (paused(home)) return save({ phase: "paused" });
      // Serialization occurs only in this worker, after the explicit full grant.
      const context = analysisRuntimeSchema.parse(captured.context);
      const fingerprint = sha256(JSON.stringify({
        sourceDomain: captured.sourceDomain, sourceCut: captured.sourceCut,
        activeRequests: [...context.activeRequests].sort(), ingest: context.ingest, tz: context.tz,
      }));
      const statePath = join(cloudHome(home), "runtime-state.json");
      const remembered = existsSync(statePath)
        ? rememberedSchema.parse(JSON.parse(readFileSync(statePath, "utf8"))) : null;
      if (remembered?.instanceId === connection.instanceId && remembered.streamId === streamId &&
          remembered.sequence === blobs.cursor(streamId)?.ack_sequence &&
          remembered.fingerprint === fingerprint && remembered.consentVersion === scope.consentVersion &&
          remembered.preparedAtMs !== undefined &&
          (options.now?.() ?? Date.now()) - remembered.preparedAtMs <
            Math.min(self.consent.retention.contentDays, self.consent.retention.projectionDays) *
              86_400_000 / 2) return progress;
      // Start the renewal clock before upload, not at ACK: a lost receipt may
      // leave an exact pending request retrying long after remote acceptance.
      const preparedAtMs = options.now?.() ?? Date.now();
      const bytes = Buffer.from(JSON.stringify(context));
      const common = {
        schemaVersion: 2, batchId: randomUUID(), deviceId: connection.deviceId,
        sourceDomain: captured.sourceDomain, generation: connection.generation,
        consentVersion: scope.consentVersion, projectId: scope.projectId, rootId: scope.rootId,
        range: { fromMs: scope.fromMs, toMs: scope.toMs }, backfill: scope.backfill,
      };
      const refs: BlobReference[] = [];
      const chunks: z.infer<typeof contentChunkRefSchema>[] = [];
      for (let offset = 0; offset < bytes.length; offset += MAX_CONTENT_CHUNK_BYTES) {
        const part = bytes.subarray(offset, offset + MAX_CONTENT_CHUNK_BYTES);
        const chunk = parseContentChunkUpload({
          ...common, index: chunks.length, revision: captured.sourceCut,
          plaintextHash: sha256(part), bytes: part.length, body: part.toString("base64"),
        });
        refs.push(blobs.put(Buffer.from(JSON.stringify(chunk))));
        chunks.push({ index: chunk.index, revision: chunk.revision,
          plaintextHash: chunk.plaintextHash, bytes: chunk.bytes });
      }
      // P6's transaction publishes the exact request and pins every chunk blob
      // together. An interrupted preparatory put is an unreferenced local orphan.
      batch = blobs.enqueue({
        streamId, batchId: common.batchId, sourceDomain: captured.sourceDomain,
        consent: self.consent, scope: { ...scope, contentKinds },
        journal: { from: blobs.cursor(streamId)?.ack_cut ?? 0, through: captured.sourceCut },
        blobHashes: refs.map(ref => ref.hash),
        build: sequence => {
          const commit = runtimeCommitSchema.parse({
            ...common, schemaVersion: 1, sequence, sourceCut: captured.sourceCut,
            capturedAtMs: context.capturedAtMs, chunks, totalBytes: bytes.length, contentHash: sha256(bytes),
          });
          authorize(self.consent, commit);
          return { kind: "runtime", body: JSON.stringify(commit), refs, fingerprint, preparedAtMs };
        },
      });
    }
    if (batch === null) return progress;
    const job = jobSchema.parse(JSON.parse(batch.payload));
    const commit = runtimeCommitSchema.parse(JSON.parse(job.body));
    if (commit.deviceId !== connection.deviceId || commit.generation !== connection.generation ||
        commit.sourceDomain !== progress.sourceDomain || commit.batchId !== batch.batch_id ||
        commit.sequence !== batch.sequence || commit.sourceCut !== batch.journal_through ||
        job.refs.length !== commit.chunks.length) throw new CloudSyncError("invalid_spool_job");
    authorize(self.consent, commit);
    const http = new CloudHttp(connection.origin, connection.token, options.fetcher);
    for (const [index, ref] of job.refs.entries()) {
      if (paused(home)) return save({ phase: "paused" });
      const bytes = blobs.get(ref.hash);
      if (bytes.length !== ref.bytes) throw new CloudSyncError("spool_blob_corrupt");
      const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const chunk = parseContentChunkUpload(JSON.parse(body));
      const expected = commit.chunks[index];
      if (chunk.batchId !== commit.batchId || chunk.sourceDomain !== commit.sourceDomain ||
          chunk.deviceId !== commit.deviceId || chunk.generation !== commit.generation ||
          expected?.plaintextHash !== chunk.plaintextHash || expected.bytes !== chunk.bytes ||
          expected.revision !== chunk.revision || expected.index !== chunk.index) {
        throw new CloudSyncError("spool_blob_corrupt");
      }
      blobs.renew();
      let value: unknown;
      try {
        value = await http.request("/v1/activity/chunks", { body });
      } catch (error) {
        // Retention may have retired an already accepted request after ACK loss.
        // Only the exact commit receipt below can acknowledge it; an uncommitted
        // purged batch still fails finalization and keeps its local pending job.
        if (error instanceof CloudRequestError && error.status === 409 && error.code === "content_expired") break;
        throw error;
      }
      const ack = z.strictObject({ stored: z.literal(true), chunk: contentChunkRefSchema }).parse(value);
      blobs.renew();
      if (JSON.stringify(ack.chunk) !== JSON.stringify(expected)) throw new CloudSyncError("invalid_remote_receipt");
    }
    if (paused(home)) return save({ phase: "paused" });
    blobs.renew();
    const receipt = receiptSchema.parse(await http.request("/v1/activity/context", { body: job.body }));
    blobs.renew();
    if (receipt.sequence !== commit.sequence || receipt.sourceCut !== commit.sourceCut ||
        receipt.contentHash !== commit.contentHash) throw new CloudSyncError("invalid_remote_receipt");
    blobs.acknowledge({ streamId, sequence: batch.sequence, payloadHash: batch.payload_hash });
    atomicCloudJson(home, "runtime-state.json", {
      instanceId: connection.instanceId, streamId, sequence: receipt.sequence, fingerprint: job.fingerprint,
      preparedAtMs: job.preparedAtMs ?? 0, consentVersion: commit.consentVersion,
    });
    blobs.prune();
    return progress;
  } catch (error) {
    if (error instanceof CloudRequestError) return save({
      phase: error.state === "quarantined" ? "quarantine" : error.state,
      code: error.code, retryAtMs: error.retryAtMs ?? undefined, attempts: progress.attempts + 1,
    });
    if (error instanceof z.ZodError) return save({ phase: "quarantine", code: "invalid_contract" });
    if (error instanceof CloudSyncError || error instanceof SyncError || error instanceof ActivityContractError) {
      return save({ phase: /consent/.test(error.code) ? "consent-required" : "quarantine", code: error.code });
    }
    throw error;
  } finally { blobs?.close(); }
}
