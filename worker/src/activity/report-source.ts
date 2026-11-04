import { z } from "zod";
import { consentSchema } from "../../../shared/activity-consent.ts";
import { contentKinds } from "../../../shared/activity-schema.ts";
import type { ReportRequest, SourceRevision } from "../../../shared/activity-query.ts";
import { contentTables } from "../../../shared/activity-content.ts";
import type { ContentRow } from "../../../shared/activity-content.ts";
import { migrationBeginSchema, summarizeSnapshot } from "../../../shared/activity-sync.ts";
import { exportContent } from "./export-service.ts";
import { exportMigration } from "./migrations.ts";
import { ReportError } from "./report-types.ts";
import type { ReportEnv } from "./report-types.ts";
import type { IngestPrincipal } from "./types.ts";
import { sourceBatchExpiry } from "./content-retention.ts";

const key = (row: ContentRow) => `${row.table}\0${row.key}`;
const MIN_TIME = -8_640_000_000_000_000, MAX_TIME = 8_640_000_000_000_000;
export async function inputBatchExpiry(
  env: ReportEnv, principal: IngestPrincipal, sourceDomain: string, batchId: string,
  consentVersion: number, full: boolean,
) {
  const saved = await env.ACCOUNTS.prepare(`SELECT consent_json FROM device_consents
      WHERE account_id=? AND device_id=? AND generation=? AND version=?`)
      .bind(principal.accountId, principal.deviceId, principal.generation, consentVersion).first();
  if (saved === null) throw new ReportError("source_gap");
  const grant = consentSchema.parse(JSON.parse(z.object({ consent_json: z.string() }).parse(saved).consent_json));
  if (grant.mode !== "managed-content" || (full && !contentKinds.every(kind => grant.contentKinds.includes(kind)))) {
    throw new ReportError("source_gap");
  }
  const expires = await sourceBatchExpiry(env, {
    account_id: principal.accountId, generation: principal.generation,
    device_id: principal.deviceId, source_domain: sourceDomain, batch_id: batchId,
  }, consentVersion);
  if (expires <= Date.now()) throw new ReportError("report_expired", 410);
  return expires;
}

/** One source namespace and one fixed accepted cut; never joins equal IDs across devices. */
export async function loadFactRows(
  env: ReportEnv, principal: IngestPrincipal, request: ReportRequest, revision: SourceRevision,
) {
  const raw = await env.ACTIVITY.prepare(`SELECT begin_json FROM migration_runs
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND state='complete' AND cut<=?
      AND json_extract(begin_json,'$.projectId')=? AND json_extract(begin_json,'$.rootId') IS ?
    ORDER BY cut DESC,json_extract(begin_json,'$.counts.recording_clock') DESC,snapshot_id LIMIT 1`)
    .bind(principal.accountId, principal.generation, principal.deviceId, request.sourceDomain,
      revision.journalThrough, request.projectId, request.rootId).first();
  if (raw === null) throw new ReportError("source_missing", 404);
  const begin = migrationBeginSchema.parse(JSON.parse(z.object({ begin_json: z.string() }).parse(raw).begin_json));
  const reference = {
    deviceId: request.deviceId, sourceDomain: request.sourceDomain, generation: request.generation,
    snapshotId: begin.snapshotId,
  };
  const status = await exportMigration(env, principal, reference);
  if (!status.accepted || status.migration.snapshotHash !== begin.snapshotHash) throw new ReportError("source_gap");
  const rows: ContentRow[] = [];
  let expiresAt = MAX_TIME;
  for (let page = 0; page < begin.pageCount; page++) {
    const declared = status.stagedPages[page];
    if (declared === undefined) throw new ReportError("source_gap");
    expiresAt = Math.min(expiresAt, await inputBatchExpiry(env, principal, request.sourceDomain,
      declared.batchId, begin.consentVersion, Object.values(declared.counts).some(count => count > 0)));
    const exported = await exportMigration(env, principal, { ...reference, page });
    if (exported.document === null || exported.migration.snapshotHash !== begin.snapshotHash) {
      throw new ReportError("source_gap");
    }
    rows.push(...exported.document.rows);
  }
  const summary = await summarizeSnapshot(rows);
  if (summary.snapshotHash !== begin.snapshotHash ||
      contentTables.some(table => summary.counts[table] !== begin.counts[table])) {
    throw new ReportError("report_integrity");
  }
  const facts = new Map(rows.map(row => [key(row), row]));
  const anchor = await env.ACTIVITY.prepare(`SELECT COALESCE(max(sequence),0) AS sequence FROM ingest_receipts
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
      AND state='projected' AND projected_through<=? AND sequence<=?`)
    .bind(principal.accountId, principal.generation, principal.deviceId, request.sourceDomain,
      begin.cut, revision.sequence).first();
  let sequence = z.object({ sequence: z.number().int() }).parse(anchor).sequence, cut = begin.cut;
  for (;;) {
    const metadata = z.array(z.object({ batch_id: z.string(), metadata_json: z.string() })).parse(
      (await env.ACTIVITY.prepare(`SELECT batch_id,metadata_json FROM ingest_receipts
        WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
          AND sequence>? AND sequence<=? ORDER BY sequence LIMIT 4`)
        .bind(principal.accountId, principal.generation, principal.deviceId, request.sourceDomain,
          sequence, revision.sequence).all()).results);
    for (const row of metadata) {
      const grant = z.object({ consentVersion: z.number().int() }).parse(JSON.parse(row.metadata_json));
      expiresAt = Math.min(expiresAt, await inputBatchExpiry(env, principal, request.sourceDomain,
        row.batch_id, grant.consentVersion, true));
    }
    const page = await exportContent(env, principal, {
      deviceId: request.deviceId, sourceDomain: request.sourceDomain, generation: request.generation,
      consentVersion: request.consentVersion, projectId: request.projectId, rootId: request.rootId,
      range: request.range, backfill: request.backfill,
      afterSequence: sequence, throughSequence: revision.sequence, limit: 4,
    });
    if (page.start === null || page.start.sequence !== sequence || page.start.journalThrough > cut) {
      throw new ReportError("source_gap");
    }
    let previous = page.start.journalThrough;
    for (const { batch, document } of page.batches) {
      if (batch.sequence !== sequence + 1 || batch.journal.from !== previous) throw new ReportError("source_gap");
      sequence = batch.sequence;
      previous = batch.journal.through;
      if (previous <= cut) continue;
      // A later full read grant cannot recreate columns or original keys omitted
      // by an earlier selected-field upload. Require a new full baseline instead.
      for (const row of document.rows) {
        if (row.revision <= cut) continue;
        if (row.operation === "delete") facts.delete(key(row));
        else facts.set(key(row), row);
      }
      cut = previous;
    }
    if (page.cursor?.sequence !== sequence || page.cursor.journalThrough !== previous ||
        (page.hasMore && page.batches.length === 0)) throw new ReportError("source_gap");
    if (!page.hasMore) break;
  }
  if (sequence !== revision.sequence || cut !== revision.journalThrough) throw new ReportError("source_gap");
  return {
    rows: [...facts.values()],
    expiresAt,
    coverage: {
      complete: begin.backfill !== null && begin.range.fromMs === MIN_TIME && begin.range.toMs === MAX_TIME,
      fromMs: begin.range.fromMs, toMs: begin.range.toMs,
    },
  };
}
