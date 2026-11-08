import type { PrivatePackCreate, PrivatePackUpdate } from "../../../shared/private-packs.ts";
import { privatePackUri, privatePackReceiptSchema } from "../../../shared/private-packs.ts";
import { contentDigest } from "./content-db.ts";
import { writeContentKey, readContentKey } from "./content-keys.ts";
import { encryptContent } from "./crypto.ts";
import { packBytes, PrivatePackError } from "./private-packs-store.ts";
import type { PackJob, PrivatePackStore } from "./private-packs-store.ts";

export async function packWriteStatus(store: PrivatePackStore, requestId: string) {
  await store.live();
  const job = await store.job(requestId);
  if (job === null) throw new PrivatePackError("not_found", 404);
  let head = await store.head(job.name);
  if (head?.tombstoned) throw new PrivatePackError("pack_tombstoned", 410);
  let visible = false;
  if (job.state === "published") {
    const definition = await store.definition(await store.version(job.name, job.digest));
    await store.members(definition);
    head = await store.head(job.name);
    if (head?.tombstoned) throw new PrivatePackError("pack_tombstoned", 410);
    visible = head?.digest === job.digest;
  }
  await store.live();
  return privatePackReceiptSchema.parse({
    request_id: job.request_id, uri: privatePackUri(job.name), digest: job.digest,
    status: job.state, revision: job.revision, unchanged: job.unchanged === 1,
    content_durable: job.content_ready === 1, searchable: visible,
    current_digest: head?.digest ?? null, error: job.error,
  });
}

async function commitPack(store: PrivatePackStore, job: PackJob) {
  const db = store.env.ACTIVITY, identity = store.identity();
  const head = await store.head(job.name);
  if (head?.tombstoned) throw new PrivatePackError("pack_tombstoned", 410);
  const matches = job.operation === "create" ? head === null : head?.digest === job.expected_digest;
  if (!matches) throw new PrivatePackError("head_conflict");
  const unchanged = head?.digest === job.digest;
  const revision = unchanged ? head.revision : (head?.revision ?? 0) + 1;
  const activeJob = `EXISTS(SELECT 1 FROM private_pack_jobs WHERE account_id=? AND generation=?
    AND request_id=? AND state='accepted' AND content_ready=1)`;
  // Head, immutable version and searchable job state are one D1 transaction.
  const mutation = job.operation === "create" ?
    db.prepare(`INSERT INTO private_pack_heads(account_id,generation,name,digest,revision,request_id,created_at)
      SELECT ?,?,?,?,1,?,? WHERE ${activeJob}
      ON CONFLICT(account_id,generation,name) DO NOTHING RETURNING revision`)
      .bind(...identity, job.name, job.digest, job.request_id, job.created_at, ...identity, job.request_id) :
    db.prepare(`UPDATE private_pack_heads SET digest=?,revision=?,request_id=?
      WHERE account_id=? AND generation=? AND name=? AND digest=? AND revision=? AND tombstoned=0
      AND ${activeJob} RETURNING revision`)
      .bind(job.digest, revision, job.request_id, ...identity, job.name, job.expected_digest,
        head?.revision ?? 0, ...identity, job.request_id);
  const winner = `EXISTS(SELECT 1 FROM private_pack_heads WHERE account_id=? AND generation=?
    AND name=? AND request_id=? AND tombstoned=0)`;
  const result = await db.batch([
    mutation,
    db.prepare(`INSERT INTO private_pack_versions
      (account_id,generation,name,digest,object_key,key_version,created_at,created_by)
      SELECT ?,?,?,?,?,?,?,? WHERE ${winner}
      ON CONFLICT(account_id,generation,name,digest) DO NOTHING`)
      .bind(...identity, job.name, job.digest, job.object_key, job.key_version, job.created_at,
        store.principal.accountId, ...identity, job.name, job.request_id),
    db.prepare(`UPDATE private_pack_jobs SET state='published',revision=?,unchanged=?
      WHERE account_id=? AND generation=? AND request_id=? AND state='accepted' AND ${winner}`)
      .bind(revision, unchanged ? 1 : 0, ...identity, job.request_id, ...identity, job.name, job.request_id),
  ]);
  if (result[0]?.results.length !== 1 && (await store.job(job.request_id))?.state !== "published") {
    throw new PrivatePackError("head_conflict");
  }
}

export async function writePrivatePack(store: PrivatePackStore, value: PrivatePackCreate | PrivatePackUpdate) {
  await store.live();
  const operation = "expected_digest" in value ? "update" : "create";
  const expected = "expected_digest" in value ? value.expected_digest : null;
  const requestHash = await contentDigest(packBytes({ operation, ...value }));
  const bytes = packBytes(value.definition), digest = await contentDigest(bytes);
  let job = await store.job(value.request_id);
  if (job !== null && job.request_hash !== requestHash) throw new PrivatePackError("request_conflict");
  if (job === null) {
    await store.members(value.definition);
    const key = await writeContentKey(store.env.ACTIVITY, store.principal, store.env.CONTENT_KEYRING);
    const objectKey = `activity/${encodeURIComponent(store.principal.accountId)}/${store.principal.generation}` +
      `/private-packs/${value.request_id}/${digest}`;
    await store.env.ACTIVITY.prepare(`INSERT INTO private_pack_jobs
      (account_id,generation,request_id,request_hash,name,digest,expected_digest,operation,
        object_key,key_version,state,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'accepted',?)
      ON CONFLICT(account_id,generation,request_id) DO NOTHING`)
      .bind(...store.identity(), value.request_id, requestHash, value.definition.name, digest,
        expected, operation, objectKey, key.version, Date.now()).run();
    job = await store.job(value.request_id);
    if (job === null) throw new PrivatePackError("job_unavailable", 503);
    if (job.request_hash !== requestHash) throw new PrivatePackError("request_conflict");
  }
  if (job.state !== "accepted") return packWriteStatus(store, value.request_id);
  try {
    const head = await store.head(job.name);
    if (head?.tombstoned) throw new PrivatePackError("pack_tombstoned", 410);
    if (operation === "create" ? head !== null : head?.digest !== expected) {
      // Another delivery of this request may have completed while we read its job.
      if ((await store.job(job.request_id))?.state === "published") return packWriteStatus(store, job.request_id);
      throw new PrivatePackError("head_conflict");
    }
    await store.members(value.definition);
    if (job.content_ready === 0) {
      const key = await readContentKey(store.env.ACTIVITY, store.principal, store.env.CONTENT_KEYRING, job.key_version);
      const envelope = await encryptContent(key, {
        accountId: store.principal.accountId, generation: store.principal.generation,
        objectKey: job.object_key, revision: 0, schemaVersion: 1,
      }, bytes);
      await store.live();
      await store.env.ACTIVITY_RAW.put(job.object_key, JSON.stringify(envelope), {
        onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" },
      });
    }
    await store.definition(job);
    await store.members(value.definition);
    await store.env.ACTIVITY.prepare(`UPDATE private_pack_jobs SET content_ready=1
      WHERE account_id=? AND generation=? AND request_id=? AND state='accepted'`)
      .bind(...store.identity(), job.request_id).run();
    await store.live();
    await commitPack(store, job);
  } catch (error) {
    if (error instanceof PrivatePackError && error.status !== 503) {
      await store.env.ACTIVITY.prepare(`UPDATE private_pack_jobs SET state='failed',error=?
        WHERE account_id=? AND generation=? AND request_id=? AND state='accepted'`)
        .bind(error.code, ...store.identity(), job.request_id).run();
    } else {
      // Storage/transaction failures leave the durable intent retryable with the exact request.
      throw error;
    }
  }
  return packWriteStatus(store, value.request_id);
}
