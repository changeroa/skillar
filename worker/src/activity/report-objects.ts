import { z } from "zod";
import { contentDigest } from "./content-db.ts";
import { readContentKey, writeContentKey } from "./content-keys.ts";
import { decryptContent, encryptContent } from "./crypto.ts";
import { authorizeReport, referenceOf, REPORT_PART_BYTES, reportWrite } from "./report-store.ts";
import { ReportError, reportIdentity } from "./report-types.ts";
import type { ReportEnv, ReportJob } from "./report-types.ts";
import type { IngestPrincipal } from "./types.ts";

const objectSchema = z.object({
  role: z.enum(["request", "result"]), part: z.number().int().nonnegative(),
  plaintext_hash: z.string(), bytes: z.number().int().positive(),
  object_key: z.string(), key_version: z.number().int().positive(),
  state: z.enum(["writing", "stored", "committed", "purging", "purged"]),
});
type StoredObject = z.infer<typeof objectSchema>;
const identity = (principal: IngestPrincipal, job: ReportJob, role: string, part: number) =>
  [...reportIdentity(principal, referenceOf(job)), role, part];
const context = (principal: IngestPrincipal, job: ReportJob, object: StoredObject) => ({
  accountId: principal.accountId, generation: principal.generation,
  objectKey: object.object_key, revision: job.input_cut, schemaVersion: 1,
});
async function readObject(
  env: ReportEnv, principal: IngestPrincipal, job: ReportJob, object: StoredObject,
) {
  if (object.state === "purging" || object.state === "purged") throw new ReportError("report_expired", 410);
  const stored = await env.ACTIVITY_RAW.get(object.object_key);
  if (stored === null) throw new ReportError("report_integrity");
  const key = await readContentKey(env.ACTIVITY, principal, env.CONTENT_KEYRING, object.key_version);
  const bytes = await decryptContent(key, context(principal, job, object), await stored.json());
  if (bytes.length !== object.bytes || await contentDigest(bytes) !== object.plaintext_hash) {
    throw new ReportError("report_integrity");
  }
  return bytes;
}
/** An intent remains discoverable if a generation closes during a late PUT. */
export async function writeReportPart(
  env: ReportEnv, principal: IngestPrincipal, job: ReportJob,
  role: "request" | "result", part: number, bytes: Uint8Array,
) {
  await authorizeReport(env, principal, job);
  if (bytes.length === 0 || bytes.length > REPORT_PART_BYTES) throw new ReportError("report_integrity");
  const hash = await contentDigest(bytes), managed = await writeContentKey(env.ACTIVITY, principal, env.CONTENT_KEYRING);
  const namespace = await contentDigest(new TextEncoder().encode(JSON.stringify([principal.deviceId, job.source_domain])));
  const key = `activity/${encodeURIComponent(principal.accountId)}/${principal.generation}/reports/${namespace}/${job.job_id}/${role}/${part}`;
  await reportWrite(() => env.ACTIVITY.prepare(`INSERT INTO report_objects
    (account_id,generation,device_id,source_domain,job_id,role,part,plaintext_hash,bytes,object_key,key_version,
      state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'writing',?,?)
    ON CONFLICT(account_id,generation,device_id,source_domain,job_id,role,part) DO NOTHING`)
    .bind(...identity(principal, job, role, part), hash, bytes.length, key, managed.version,
      job.created_at, job.expires_at).run());
  const object = objectSchema.parse(await env.ACTIVITY.prepare(`SELECT * FROM report_objects
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=? AND role=? AND part=?`)
    .bind(...identity(principal, job, role, part)).first());
  if (object.plaintext_hash !== hash || object.bytes !== bytes.length) throw new ReportError("report_conflict");
  if (object.state === "purging" || object.state === "purged") throw new ReportError("report_expired", 410);
  if (object.state === "writing") {
    const encryptionKey = object.key_version === managed.version ? managed.key :
      await readContentKey(env.ACTIVITY, principal, env.CONTENT_KEYRING, object.key_version);
    const envelope = await encryptContent(encryptionKey, context(principal, job, object), new Uint8Array(bytes));
    await env.ACTIVITY_RAW.put(object.object_key, JSON.stringify(envelope), {
      onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" },
    });
  }
  await readObject(env, principal, job, object);
  await authorizeReport(env, principal, job);
  await reportWrite(() => env.ACTIVITY.prepare(`UPDATE report_objects SET state='stored'
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=? AND role=? AND part=?
      AND state='writing' AND EXISTS(SELECT 1 FROM tenant_fences
        WHERE account_id=? AND generation=? AND state='active')`)
    .bind(...identity(principal, job, role, part), principal.accountId, principal.generation).run());
  return { index: part, bytes: bytes.length, hash };
}
export async function readReportPart(
  env: ReportEnv, principal: IngestPrincipal, job: ReportJob, role: "request" | "result", part: number,
) {
  await authorizeReport(env, principal, job);
  const raw = await env.ACTIVITY.prepare(`SELECT * FROM report_objects
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND job_id=? AND role=? AND part=?
      AND state IN ('stored','committed')`)
    .bind(...identity(principal, job, role, part)).first();
  if (raw === null) throw new ReportError("report_integrity");
  const object = objectSchema.parse(raw), bytes = await readObject(env, principal, job, object);
  await authorizeReport(env, principal, job);
  return { bytes, index: part, hash: object.plaintext_hash };
}
export async function writeReportDocument(
  env: ReportEnv, principal: IngestPrincipal, job: ReportJob, role: "request" | "result", bytes: Uint8Array,
) {
  const parts = Math.ceil(bytes.length / REPORT_PART_BYTES);
  for (let part = 0; part < parts; part++) {
    await writeReportPart(env, principal, job, role, part,
      bytes.subarray(part * REPORT_PART_BYTES, (part + 1) * REPORT_PART_BYTES));
  }
  return { parts, bytes: bytes.length, hash: await contentDigest(bytes) };
}
export async function readReportRequest(env: ReportEnv, principal: IngestPrincipal, job: ReportJob) {
  const bytes = new Uint8Array(job.request_bytes);
  let offset = 0;
  for (let part = 0; part < job.request_chunks; part++) {
    const value = await readReportPart(env, principal, job, "request", part);
    bytes.set(value.bytes, offset);
    offset += value.bytes.length;
  }
  if (offset !== bytes.length) throw new ReportError("report_integrity");
  return bytes;
}
export async function sweepReports(env: ReportEnv, now = Date.now()) {
  const rows = z.array(z.object({ object_key: z.string() })).parse((await env.ACTIVITY.prepare(
    `SELECT o.object_key FROM report_objects o LEFT JOIN tenant_fences f ON f.account_id=o.account_id
      AND f.generation=o.generation WHERE o.expires_at<=? OR f.state IS NULL OR f.state<>'active'
      ORDER BY o.purge_order,o.object_key LIMIT 100`,
  ).bind(now).all()).results);
  for (const row of rows) {
    await env.ACTIVITY.prepare(`UPDATE report_objects SET state='purging',
      purge_order=(SELECT COALESCE(max(purge_order),0)+1 FROM report_objects) WHERE object_key=?`)
      .bind(row.object_key).run();
    await env.ACTIVITY_RAW.delete(row.object_key);
    await env.ACTIVITY.prepare("UPDATE report_objects SET state='purged' WHERE object_key=?")
      .bind(row.object_key).run();
  }
  return { scanned: rows.length };
}
