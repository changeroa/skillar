import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Db } from "../store/db.js";
import { CloudSyncError } from "./cloud-blobs.js";
import type { CloudBlobs } from "./cloud-blobs.js";
import { cloudHome } from "./cloud-connection.js";
import type { CloudConnection } from "./cloud-connection.js";
import { coveredRows, snapshotRecords } from "./cloud-documents.js";
import { liveStream, stageCdcJob, stageMigrationJob } from "./cloud-jobs.js";
import { preparedPath, preparedSchema } from "./cloud-prepare.js";
import { journalHead, readJournal } from "./journal.js";
import type { Mutation } from "./tables.js";
import { MAX_SNAPSHOT_ROWS } from "./cloud-wire.js";
import type { Consent, UploadScope } from "./cloud-wire.js";

export const CLOUD_TIME_END = 8_640_000_000_000_000;

export function migrationPrefix(connection: CloudConnection, sourceDomain: string): string {
  return `cloud-migration:${connection.instanceId}:${sourceDomain}:`;
}

/** Whole-device transport requires its explicit browser scope, not an arbitrary project. */
export function cloudScope(
  connection: CloudConnection, consent: Consent, historical: boolean,
): UploadScope {
  if (consent.mode !== "managed-content") throw new CloudSyncError("content_consent_required");
  const projectId = `device:${connection.deviceId}`;
  if (consent.scope.deviceId !== connection.deviceId ||
      !consent.scope.projectIds.includes(projectId) || consent.scope.rootIds.length !== 0) {
    throw new CloudSyncError("whole_device_consent_required");
  }
  if (historical && consent.backfill === undefined) throw new CloudSyncError("backfill_consent_required");
  const history = historical ? consent.backfill : undefined;
  return {
    deviceId: connection.deviceId, projectId, rootId: null,
    consentVersion: consent.version, contentKinds: consent.contentKinds,
    fromMs: history?.range.fromMs ?? consent.grantedAtMs,
    toMs: history?.range.toMs ?? CLOUD_TIME_END,
    backfill: history === undefined ? null : {
      version: history.version, snapshotId: history.snapshotId, journalCut: history.journalCut,
    },
  };
}

export async function stageBaseline(
  home: string, source: Db, blobs: CloudBlobs, connection: CloudConnection,
  consent: Consent, purpose: "initial" | "backfill",
) {
  const head = journalHead(source);
  const historical = consent.mode === "managed-content" && consent.backfill !== undefined;
  const scope = cloudScope(connection, consent, historical);
  let snapshotId: string = randomUUID();
  let cut = head.cut;
  let records: readonly Mutation[] = [];
  if (historical) {
    const prepared = preparedSchema.parse(JSON.parse(
      readFileSync(join(cloudHome(home), "prepared.json"), "utf8")));
    if (prepared.instanceId !== connection.instanceId || prepared.deviceId !== connection.deviceId ||
        prepared.generation !== connection.generation || prepared.sourceDomain !== head.sourceDomain ||
        prepared.snapshotId !== scope.backfill?.snapshotId || prepared.cut !== scope.backfill.journalCut ||
        prepared.expiresAtMs <= Date.now()) throw new CloudSyncError("prepared_snapshot_mismatch");
    snapshotId = prepared.snapshotId;
    cut = prepared.cut;
    const frozen = new DatabaseSync(preparedPath(home, snapshotId), { readOnly: true });
    try {
      const frozenHead = journalHead(frozen);
      if (frozenHead.cut !== cut || frozenHead.sourceDomain !== head.sourceDomain) {
        throw new CloudSyncError("prepared_snapshot_mismatch");
      }
      records = snapshotRecords(frozen, cut);
    } finally {
      frozen.close();
    }
  } else if (purpose === "backfill") {
    throw new CloudSyncError("backfill_consent_required");
  }
  const streamId = `${migrationPrefix(connection, head.sourceDomain)}${snapshotId}`;
  if ((blobs.cursor(streamId)?.ack_sequence ?? 0) > 0) return null;
  const transformed = await coveredRows(consent, scope, records);
  return stageMigrationJob(blobs, {
    streamId,
    reference: {
      deviceId: connection.deviceId, generation: connection.generation,
      sourceDomain: head.sourceDomain, snapshotId, cut, purpose,
    },
    consent, scope, rows: transformed.rows, excluded: transformed.excluded,
  });
}

export async function stageLive(
  source: Db, blobs: CloudBlobs, connection: CloudConnection, consent: Consent,
) {
  const head = journalHead(source), streamId = liveStream(connection.instanceId, head.sourceDomain);
  const cursor = blobs.cursor(streamId);
  if (cursor === null) throw new CloudSyncError("baseline_required");
  if (head.cut < cursor.ack_cut) throw new CloudSyncError("source_history_rewound");
  if (head.cut === cursor.ack_cut) return null;
  const rows: Mutation[] = [];
  let after = cursor.ack_cut;
  for (;;) {
    const page = readJournal(source, { after, through: head.cut });
    if (page.length === 0) break;
    rows.push(...page);
    if (rows.length > MAX_SNAPSHOT_ROWS) throw new CloudSyncError("journal_pressure");
    after = page[page.length - 1]!.revision;
  }
  // A grant that covers history AND future can carry both in the same fixed cut.
  const historical = consent.mode === "managed-content" && consent.backfill !== undefined &&
    consent.backfill.range.toMs === CLOUD_TIME_END;
  const scope = cloudScope(connection, consent, historical);
  const transformed = await coveredRows(consent, scope, rows);
  return stageCdcJob(blobs, {
    streamId, deviceId: connection.deviceId, sourceDomain: head.sourceDomain,
    generation: connection.generation, consent, scope, after: cursor.ack_cut,
    cut: head.cut, rows: transformed.rows, excluded: transformed.excluded,
  });
}
