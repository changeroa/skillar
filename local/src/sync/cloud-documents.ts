import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "../store/db.js";
import { CloudSyncError } from "./cloud-blobs.js";
import type { CloudBlobs } from "./cloud-blobs.js";
import {
  ActivityContractError, MAX_CONTENT_BYTES, MAX_CONTENT_CHUNK_BYTES,
  contentDocumentSchema, parseContentChunkUpload, transformContentRows,
  MAX_SNAPSHOT_PAGES, MAX_SNAPSHOT_ROWS,
} from "./cloud-wire.js";
import type { Consent, ContentChunkUpload, ContentRow, UploadScope } from "./cloud-wire.js";
import { shape } from "./restore-rows.js";
import { mutationSchema, scalarSchema, targetTables } from "./tables.js";
import type { Mutation } from "./tables.js";

export const blobReferenceSchema = z.strictObject({
  hash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(1).max(256 * 1024),
});
export type BlobReference = z.infer<typeof blobReferenceSchema>;
export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Frozen local backup reader; explicit pressure is never a truncated snapshot. */
export function snapshotRecords(db: Db, cut: number): Mutation[] {
  const records: Mutation[] = [];
  let total = 0;
  for (const table of targetTables) {
    const { columns, keys } = shape(db, table);
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const order = table === "load_candidates" ? keys.map(quote).join(",") : "rowid";
    const length = columns.map(name => `COALESCE(length(CAST(${quote(name)} AS BLOB)),0)`).join("+");
    if (db.prepare(`SELECT 1 FROM "${table}" WHERE ${length}>? LIMIT 1`).get(MAX_CONTENT_BYTES)) {
      throw new CloudSyncError("snapshot_pressure");
    }
    const cursor = db.prepare(`SELECT *,${table === "load_candidates" ? "NULL" : "rowid"}
      AS cloud_source_order FROM "${table}" ORDER BY ${order}`).iterate();
    for (const raw of cursor) {
      const values = Object.fromEntries(columns.map(name => [name, scalarSchema.parse(raw[name])]));
      const record = mutationSchema.parse({
        table, key: JSON.stringify(keys.map(name => values[name])), revision: cut,
        operation: "upsert", sourceOrder: raw["cloud_source_order"], values,
      });
      total += Buffer.byteLength(JSON.stringify(record));
      if (total > MAX_CONTENT_BYTES || records.length >= MAX_SNAPSHOT_ROWS) {
        throw new CloudSyncError("snapshot_pressure");
      }
      records.push(record);
    }
  }
  return records;
}

/** A record outside explicit temporal coverage is not silently widened to all history. */
export async function coveredRows(
  consent: Consent, scope: UploadScope, records: readonly Mutation[],
): Promise<{ readonly rows: ContentRow[]; readonly excluded: number }> {
  const rows: ContentRow[] = [];
  let excluded = 0;
  for (const record of records) {
    try {
      const document = await transformContentRows(consent, scope, [record]);
      if (document === null) throw new CloudSyncError("local_only");
      rows.push(...contentDocumentSchema.parse(document).rows);
    } catch (error) {
      if (error instanceof ActivityContractError && error.code === "range_not_allowed") {
        excluded++;
      } else {
        throw error;
      }
    }
  }
  return { rows, excluded };
}

export function snapshotDocuments(rows: readonly ContentRow[]) {
  const pages: { schemaVersion: 2; rows: ContentRow[] }[] = [];
  let current: ContentRow[] = [];
  for (const row of rows) {
    const next = [...current, row];
    if (current.length > 0 &&
        (next.length > 100 || Buffer.byteLength(JSON.stringify({ schemaVersion: 2, rows: next })) > 256 * 1024)) {
      pages.push({ schemaVersion: 2, rows: current });
      current = [];
    }
    current.push(row);
    if (Buffer.byteLength(JSON.stringify({ schemaVersion: 2, rows: current })) > MAX_CONTENT_BYTES) {
      throw new CloudSyncError("snapshot_pressure");
    }
  }
  if (current.length > 0 || pages.length === 0) pages.push({ schemaVersion: 2, rows: current });
  if (pages.length > MAX_SNAPSHOT_PAGES) throw new CloudSyncError("snapshot_pressure");
  return pages;
}

/** Store exact HTTP request bytes, after consent transformation and before manifest commit. */
export function spoolDocumentChunks(
  blobs: CloudBlobs, document: { readonly schemaVersion: 2; readonly rows: readonly ContentRow[] },
  common: Omit<ContentChunkUpload, "index" | "revision" | "plaintextHash" | "bytes" | "body" | "deviceId" | "sourceDomain"> & {
    readonly deviceId: string; readonly sourceDomain: string;
  },
  revision: number,
) {
  const bytes = Buffer.from(JSON.stringify(document));
  if (bytes.byteLength > MAX_CONTENT_BYTES) throw new CloudSyncError("snapshot_pressure");
  const refs: BlobReference[] = [];
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += MAX_CONTENT_CHUNK_BYTES) {
    const part = bytes.subarray(offset, offset + MAX_CONTENT_CHUNK_BYTES);
    const chunk = parseContentChunkUpload({
      ...common, revision, index: chunks.length, plaintextHash: sha256(part),
      bytes: part.length, body: part.toString("base64"),
    });
    refs.push(blobs.put(Buffer.from(JSON.stringify(chunk))));
    chunks.push({
      index: chunk.index, revision: chunk.revision,
      plaintextHash: chunk.plaintextHash, bytes: chunk.bytes,
    });
  }
  return { refs, chunks, totalBytes: bytes.length, contentHash: sha256(bytes) };
}
